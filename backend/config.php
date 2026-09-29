<?php
// ============================================================
// backend/config.php
// Runtime configuration is read from environment variables first.
// Local XAMPP defaults are kept only as development fallbacks.
// ============================================================

function envValue(string $key, ?string $default = null): string {
    $value = getenv($key);
    return ($value === false || $value === '') ? (string)$default : (string)$value;
}

define('APP_ENV', strtolower(envValue('GREENFUEL_ENV', envValue('APP_ENV', 'local'))));
define('DB_HOST', envValue('GREENFUEL_DB_HOST', envValue('DB_HOST', 'localhost')));
define('DB_NAME', envValue('GREENFUEL_DB_NAME', envValue('DB_NAME', 'greenfuel_fixed')));
define('DB_USER', envValue('GREENFUEL_DB_USER', envValue('DB_USER', 'root')));
define('DB_PASS', envValue('GREENFUEL_DB_PASS', envValue('DB_PASS', '')));
define('DB_CHARSET', envValue('GREENFUEL_DB_CHARSET', 'utf8mb4'));

function isProduction(): bool {
    return in_array(APP_ENV, ['prod', 'production'], true);
}

function requestIsHttps(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (string)($_SERVER['SERVER_PORT'] ?? '') === '443'
        || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

function requestOrigin(): string {
    $scheme = requestIsHttps() ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme.'://'.$host;
}

// ---- Security headers / CORS ----
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self' data: blob:; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
if (requestIsHttps()) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $allowedOrigins = array_filter(array_map('trim', explode(',', envValue('GREENFUEL_ALLOWED_ORIGINS', ''))));
    $allowedOrigins[] = requestOrigin();
    $originHost = strtolower((string)(parse_url($origin, PHP_URL_HOST) ?? ''));
    $isLocalOrigin = in_array($originHost, ['localhost', '127.0.0.1'], true);
    if (in_array($origin, $allowedOrigins, true) || (!isProduction() && $isLocalOrigin)) {
        header('Access-Control-Allow-Origin: '.$origin);
        header('Access-Control-Allow-Credentials: true');
        header('Vary: Origin');
    }
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ---- PDO singleton ----
function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        if (isProduction() && (DB_USER === 'root' || DB_PASS === '')) {
            error_log('GreenFuel refused insecure production database credentials.');
            jsonError('Database is not securely configured. Please contact the system administrator.', 500);
        }
        $dsn = "mysql:host=".DB_HOST.";dbname=".DB_NAME.";charset=".DB_CHARSET;
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            error_log('GreenFuel DB connection failed: '.$e->getMessage());
            jsonError('Database connection failed. Please contact the system administrator.', 500);
        }
    }
    return $pdo;
}

// ---- Session ----
function startSession(): void {
    if (session_status() === PHP_SESSION_NONE) {
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_name('greenfuel_sess');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => requestIsHttps(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
        if (empty($_SESSION['_csrf_token'])) {
            $_SESSION['_csrf_token'] = bin2hex(random_bytes(32));
        }
    }
}

function csrfToken(): string {
    startSession();
    if (empty($_SESSION['_csrf_token'])) {
        $_SESSION['_csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['_csrf_token'];
}

function requireCsrf(): void {
    if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD', 'OPTIONS'], true)) return;
    startSession();
    $header = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($header) || $header === '' || !hash_equals($_SESSION['_csrf_token'] ?? '', $header)) {
        jsonError('Security token expired. Refresh the page and try again.', 419);
    }
}

function rateLimit(string $key, int $limit, int $seconds): void {
    startSession();
    $now = time();
    $_SESSION['_rate_limits'][$key] = array_values(array_filter(
        $_SESSION['_rate_limits'][$key] ?? [],
        fn($timestamp) => is_int($timestamp) && ($now - $timestamp) < $seconds
    ));
    if (count($_SESSION['_rate_limits'][$key]) >= $limit) {
        jsonError('Too many attempts. Please wait a few minutes and try again.', 429);
    }
    $_SESSION['_rate_limits'][$key][] = $now;
}

function currentUser(): ?array {
    startSession();
    return $_SESSION['user'] ?? null;
}

function requireAuth(): array {
    $u = currentUser();
    if (!$u) jsonError('Not authenticated.', 401);
    try {
        getDB()->prepare('UPDATE users SET last_seen_at=NOW() WHERE id=?')->execute([$u['id']]);
    } catch (Throwable $e) {
        // Older local databases may not have presence columns until auth schema
        // helpers run; auth.php will add them automatically.
    }
    return $u;
}

function requireRole(string ...$roles): array {
    $u = requireAuth();
    if (!in_array($u['role'], $roles, true))
        jsonError('Access denied. Required: '.implode(' or ', $roles), 403);
    return $u;
}

function dbTableExists(PDO $db, string $table): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?'
    );
    $stmt->execute([DB_NAME, $table]);
    return (int)$stmt->fetchColumn() > 0;
}

function assignedBranchIds(PDO $db, array $user): array {
    if (($user['role'] ?? '') === 'owner') {
        $rows = $db->query('SELECT id FROM branches ORDER BY id')->fetchAll();
        return array_values(array_map(fn($r) => $r['id'], $rows));
    }
    $ids = [];
    if (dbTableExists($db, 'user_branches')) {
        $stmt = $db->prepare(
            'SELECT branch_id FROM user_branches WHERE user_id=? ORDER BY is_primary DESC, branch_id'
        );
        $stmt->execute([(int)($user['id'] ?? 0)]);
        $ids = array_values(array_filter(array_map(fn($r) => $r['branch_id'], $stmt->fetchAll())));
    }
    if (!$ids && !empty($user['branch_id'])) $ids = [$user['branch_id']];
    return array_values(array_unique($ids));
}

function canAccessBranch(PDO $db, array $user, ?string $branchId): bool {
    if (!$branchId) return false;
    if (($user['role'] ?? '') === 'owner') return true;
    return in_array($branchId, assignedBranchIds($db, $user), true);
}

function requireBranchAccess(PDO $db, array $user, ?string $branchId): string {
    $branchId = trim((string)$branchId);
    if ($branchId === '') jsonError('branch_id is required.');
    if (!canAccessBranch($db, $user, $branchId)) jsonError('Access denied for this branch.', 403);
    return $branchId;
}

function activeBranchId(PDO $db, array $user, ?string $requested = null): string {
    if (($user['role'] ?? '') === 'owner') {
        return requireBranchAccess($db, $user, $requested);
    }
    $branchId = $requested ?: ($user['branch_id'] ?? null);
    return requireBranchAccess($db, $user, $branchId);
}

function passwordMeetsPolicy(string $password): bool {
    return strlen($password) >= 8;
}

function storedPasswordIsHash(string $stored): bool {
    return (password_get_info($stored)['algo'] ?? 0) !== 0;
}

function auditLog(PDO $db, array $user, string $action, ?string $entityType = null, ?string $entityId = null, array $details = []): void {
    try {
        if (!dbTableExists($db, 'audit_logs')) return;
        $stmt = $db->prepare(
            'INSERT INTO audit_logs
               (actor_id, actor_role, action, entity_type, entity_id, details_json, ip_address, created_at)
             VALUES (?,?,?,?,?,?,?,NOW())'
        );
        $stmt->execute([
            $user['id'] ?? null,
            $user['role'] ?? null,
            substr($action, 0, 80),
            $entityType ? substr($entityType, 0, 80) : null,
            $entityId ? substr($entityId, 0, 120) : null,
            $details ? json_encode($details, JSON_UNESCAPED_UNICODE) : null,
            substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45) ?: null,
        ]);
    } catch (Throwable $e) {
        error_log('GreenFuel audit log failed: '.$e->getMessage());
    }
}

// ---- Response ----
function jsonOut(mixed $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function jsonError(string $msg, int $status = 400): never {
    jsonOut(['success' => false, 'error' => $msg], $status);
}

function jsonSuccess(mixed $data = null, string $msg = 'OK'): never {
    jsonOut(['success' => true, 'message' => $msg, 'data' => $data]);
}

function getBody(): array {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}
