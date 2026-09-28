<?php
// ============================================================
// backend/config.php
// Edit these values to match your XAMPP / hosting setup
// ============================================================

define('DB_HOST',    'localhost');
define('DB_NAME',    'greenfuel_fixed');
define('DB_USER',    'root');   // change in production
define('DB_PASS',    '');       // change in production
define('DB_CHARSET', 'utf8mb4');

// ---- PDO singleton ----
function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=".DB_HOST.";dbname=".DB_NAME.";charset=".DB_CHARSET;
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            jsonError('DB connection failed: ' . $e->getMessage(), 500);
        }
    }
    return $pdo;
}

// ---- Session ----
function startSession(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_name('greenfuel_sess');
        session_start();
    }
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
    if (!in_array($u['role'], $roles))
        jsonError('Access denied. Required: '.implode(' or ', $roles), 403);
    return $u;
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

// ---- CORS (allows frontend to call API during local dev) ----
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
