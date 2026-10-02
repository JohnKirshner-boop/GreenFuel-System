<?php
// backend/routes/auth.php
// POST ?action=login   { email, password }
// POST ?action=logout
// GET  ?action=me

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../account_helpers.php';
startSession();

$action = $_GET['action'] ?? '';
$db = getDB();
gfEnsureAccountSchema($db);

function authTheme(string $theme): string {
    return in_array($theme, ['light', 'dark'], true) ? $theme : 'light';
}

function authValidProfileImage(?string $image): ?string {
    $image = trim((string)$image);
    if ($image === '') return null;
    if (strlen($image) > 1600000) jsonError('Profile picture must be 1 MB or smaller.');
    if (!preg_match('/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/', $image)) {
        jsonError('Upload a valid PNG, JPG, WEBP, or GIF profile picture.');
    }
    [$meta, $encoded] = explode(',', $image, 2);
    $decoded = base64_decode($encoded, true);
    if ($decoded === false || strlen($decoded) > 1100000) {
        jsonError('Profile picture must be a valid image file under 1 MB.');
    }
    return $image;
}

function authEnsurePasswordResetSchema(PDO $db): void {
    gfEnsurePasswordResetSchema($db);
}

function authPasswordResetUrl(string $token): string {
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (string)($_SERVER['SERVER_PORT'] ?? '') === '443';
    $scheme = $isHttps ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/greenfuel-project/backend/routes/auth.php');
    $frontend = preg_replace('#/backend/routes/auth\.php$#', '/frontend/index.html', $script);
    if (!$frontend || $frontend === $script) $frontend = '/frontend/index.html';
    return $scheme.'://'.$host.$frontend.'?reset_token='.rawurlencode($token);
}

function authIsLocalHost(): bool {
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    return strpos($host, 'localhost') !== false || strpos($host, '127.0.0.1') !== false;
}

function authSendPasswordResetEmail(string $email, string $name, string $url): bool {
    $subject = 'GreenFuel password reset link';
    $body = "Hello {$name},\n\n"
          . "We received a request to reset your GreenFuel password.\n\n"
          . "Open this link to create a new password:\n{$url}\n\n"
          . "This link expires in 1 hour. If you did not request this, you can ignore this email.\n\n"
          . "GreenFuel Management System";
    return gfSendSystemEmail($email, $name, $subject, $body);
}

authEnsurePasswordResetSchema($db);

switch ($action) {

    case 'login':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        rateLimit('login', 8, 300);
        $b        = getBody();
        $email    = strtolower(trim($b['email'] ?? ''));
        $password = trim($b['password']  ?? '');
        if (!$email || !$password) jsonError('Email and password are required.');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError('Enter a valid email address.');

        $stmt = $db->prepare(
            'SELECT u.*, b.name AS branch_name, b.location AS branch_location
             FROM users u
             LEFT JOIN branches b ON b.id = u.branch_id
             WHERE u.email = ?
             LIMIT 1'
        );
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        if ($user) {
            $accountStatus = $user['account_status'] ?? 'active';
            if ($accountStatus === 'pending') {
                jsonError('This account is pending activation. Please check your activation email or contact the administrator.', 403);
            }
            if ($accountStatus === 'deactivated') {
                jsonError('This account is deactivated. Please contact the administrator.', 403);
            }
        }

        $ok = $user && storedPasswordIsHash((string)$user['password']) && password_verify($password, $user['password']);
        if ($user && !storedPasswordIsHash((string)$user['password'])) {
            jsonError('This account still uses an old insecure password. Ask the administrator to run the password migration or use forgot password.', 403);
        }

        if (!$ok) jsonError('Invalid email or password.', 401);
        unset($_SESSION['_rate_limits']['login']);
        session_regenerate_id(true);

        if ($user['role'] !== 'owner') {
            $assignedBranches = $user['role'] === 'manager'
                ? gfAssignedBranchIds($db, (int)$user['id'])
                : array_values(array_filter([$user['branch_id'] ?? null]));
            if (!$assignedBranches && !empty($user['branch_id'])) $assignedBranches = [$user['branch_id']];
            if (!$assignedBranches) jsonError('No branch is assigned to this account. Ask the owner to assign one.', 403);
            $branchId = !empty($user['branch_id']) && in_array($user['branch_id'], $assignedBranches, true)
                ? $user['branch_id']
                : $assignedBranches[0];
            $bStmt = $db->prepare('SELECT id, name, location FROM branches WHERE id = ? LIMIT 1');
            $bStmt->execute([$branchId]);
            $branch = $bStmt->fetch();
            if (!$branch) jsonError('Invalid branch selected.', 400);
            $user['branch_id'] = $branch['id'];
            $user['branch_name'] = $branch['name'];
            $user['branch_location'] = $branch['location'];
        } else {
            $user['branch_id'] = null;
            $user['branch_name'] = null;
            $user['branch_location'] = null;
        }

        $db->prepare('UPDATE users SET last_login_at=NOW(), last_seen_at=NOW() WHERE id=?')
           ->execute([(int)$user['id']]);

        $_SESSION['user'] = [
            'id'              => (int)$user['id'],
            'username'        => $user['username'],
            'email'           => $user['email'],
            'name'            => $user['name'],
            'role'            => $user['role'],
            'branch_id'       => $user['branch_id'],
            'branch_name'     => $user['branch_name'] ?? null,
            'branch_location' => $user['branch_location'] ?? null,
            'profile_image'   => $user['profile_image'] ?? null,
            'theme_preference' => authTheme($user['theme_preference'] ?? 'light'),
            'assigned_branches' => $user['role'] === 'manager' ? gfAssignedBranchIds($db, (int)$user['id']) : [],
        ];
        $_SESSION['user']['csrf_token'] = csrfToken();
        auditLog($db, $_SESSION['user'], 'login', 'user', (string)$user['id']);
        jsonSuccess($_SESSION['user'], 'Login successful.');

    case 'request_password_reset':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        rateLimit('password_reset_request', 4, 900);
        $b = getBody();
        $email = strtolower(trim($b['email'] ?? ''));

        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError('Enter a valid account email.');

        $stmt = $db->prepare('SELECT id, name, email, role, account_status FROM users WHERE email=? LIMIT 1');
        $stmt->execute([$email]);
        $target = $stmt->fetch();
        if (!$target || ($target['account_status'] ?? 'active') !== 'active') {
            jsonSuccess(['mail_sent' => true], 'If that email is registered, a reset link has been sent.');
        }
        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);
        $expiresAt = date('Y-m-d H:i:s', time() + 3600);
        $resetUrl = authPasswordResetUrl($token);

        $db->prepare('UPDATE password_resets SET used_at=NOW() WHERE user_id=? AND used_at IS NULL')
           ->execute([(int)$target['id']]);
        $db->prepare(
            'INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
             VALUES (?, ?, ?, ?)'
        )->execute([
            (int)$target['id'],
            $tokenHash,
            $expiresAt,
            substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45) ?: null,
        ]);

        $sent = authSendPasswordResetEmail($target['email'], $target['name'], $resetUrl);
        $data = [
            'mail_sent' => $sent,
            'expires_at' => $expiresAt,
        ];
        if (!$sent && authIsLocalHost()) $data['dev_reset_link'] = $resetUrl;
        jsonSuccess(
            $data,
            $sent
                ? 'Password reset link sent. Check your email.'
                : 'Reset link created, but this local server could not send email.'
        );

    case 'reset_password':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        rateLimit('password_reset_submit', 6, 900);
        $b = getBody();
        $token = trim((string)($b['token'] ?? ''));
        $newPassword = (string)($b['password'] ?? '');

        if (!$token || strlen($token) < 32) jsonError('Reset link is invalid or expired.');
        if (!passwordMeetsPolicy($newPassword)) jsonError('New password must be at least 8 characters.');

        $stmt = $db->prepare(
            'SELECT pr.id AS reset_id, u.id AS user_id, u.role, u.account_status
             FROM password_resets pr
             INNER JOIN users u ON u.id = pr.user_id
             WHERE pr.token_hash=? AND pr.used_at IS NULL AND pr.expires_at > NOW()
             LIMIT 1'
        );
        $stmt->execute([hash('sha256', $token)]);
        $reset = $stmt->fetch();
        if (!$reset) jsonError('Reset link is invalid or expired.');
        if (($reset['account_status'] ?? 'active') === 'deactivated') {
            jsonError('This account is deactivated. Please contact the administrator.', 403);
        }
        $db->beginTransaction();
        try {
            $db->prepare("UPDATE users SET password=?, account_status='active', activated_at=COALESCE(activated_at, NOW()) WHERE id=?")
               ->execute([password_hash($newPassword, PASSWORD_DEFAULT), (int)$reset['user_id']]);
            $db->prepare('UPDATE password_resets SET used_at=NOW() WHERE id=?')
               ->execute([(int)$reset['reset_id']]);
            auditLog($db, ['id' => (int)$reset['user_id'], 'role' => $reset['role']], 'password_reset', 'user', (string)$reset['user_id']);
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }
        jsonSuccess(null, 'Password updated. You can now sign in with the new password.');

    case 'update_profile':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $u = requireAuth();
        requireCsrf();
        $b = getBody();
        $name = substr(trim($b['name'] ?? $u['name'] ?? ''), 0, 120);
        $theme = authTheme(trim($b['theme_preference'] ?? $u['theme_preference'] ?? 'light'));
        $profileImage = array_key_exists('profile_image', $b)
            ? authValidProfileImage($b['profile_image'])
            : ($u['profile_image'] ?? null);

        if (!$name) jsonError('Display name is required.');

        $stmt = $db->prepare('UPDATE users SET name=?, profile_image=?, theme_preference=? WHERE id=?');
        $stmt->execute([$name, $profileImage, $theme, $u['id']]);

        $_SESSION['user']['name'] = $name;
        $_SESSION['user']['profile_image'] = $profileImage;
        $_SESSION['user']['theme_preference'] = $theme;
        $_SESSION['user']['csrf_token'] = csrfToken();
        auditLog($db, $u, 'profile_update', 'user', (string)$u['id']);
        jsonSuccess($_SESSION['user'], 'Account settings updated.');

    case 'update_theme':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $u = requireAuth();
        requireCsrf();
        $b = getBody();
        $theme = authTheme(trim($b['theme_preference'] ?? 'light'));

        $stmt = $db->prepare('UPDATE users SET theme_preference=? WHERE id=?');
        $stmt->execute([$theme, $u['id']]);

        $_SESSION['user']['theme_preference'] = $theme;
        $_SESSION['user']['csrf_token'] = csrfToken();
        jsonSuccess($_SESSION['user'], 'Display mode updated.');

    case 'change_password':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $u = requireAuth();
        requireCsrf();
        if (($u['role'] ?? '') === 'owner') jsonError('Owner password changes are handled through password reset only.', 403);
        $b = getBody();
        $currentPassword = (string)($b['current_password'] ?? '');
        $newPassword = (string)($b['new_password'] ?? '');
        if (!$currentPassword || !$newPassword) jsonError('Current and new password are required.');
        if (!passwordMeetsPolicy($newPassword)) jsonError('New password must be at least 8 characters.');

        $stmt = $db->prepare('SELECT password FROM users WHERE id=? LIMIT 1');
        $stmt->execute([$u['id']]);
        $stored = (string)($stmt->fetchColumn() ?: '');
        if (!storedPasswordIsHash($stored)) {
            jsonError('This account still uses an old insecure password. Use forgot password to set a new one.', 403);
        }
        $ok = password_verify($currentPassword, $stored);
        if (!$ok) jsonError('Current password is incorrect.', 403);

        $update = $db->prepare('UPDATE users SET password=? WHERE id=?');
        $update->execute([password_hash($newPassword, PASSWORD_DEFAULT), $u['id']]);
        auditLog($db, $u, 'password_change', 'user', (string)$u['id']);
        jsonSuccess(null, 'Password changed successfully.');

    case 'logout':
        if ($_SERVER['REQUEST_METHOD'] === 'POST') requireCsrf();
        $u = currentUser();
        if ($u) {
            try {
                $db->prepare('UPDATE users SET last_seen_at=DATE_SUB(NOW(), INTERVAL 31 MINUTE) WHERE id=?')
                   ->execute([$u['id']]);
            } catch (Throwable $e) {}
        }
        session_destroy();
        jsonSuccess(null, 'Logged out.');

    case 'me':
        $u = currentUser();
        if (!$u) jsonError('Not authenticated.', 401);
        $db->prepare('UPDATE users SET last_seen_at=NOW() WHERE id=?')->execute([$u['id']]);
        $stmt = $db->prepare('SELECT username, email, name, role, profile_image, theme_preference FROM users WHERE id=? LIMIT 1');
        $stmt->execute([$u['id']]);
        $fresh = $stmt->fetch();
        if ($fresh) {
            $_SESSION['user']['username'] = $fresh['username'];
            $_SESSION['user']['email'] = $fresh['email'];
            $_SESSION['user']['name'] = $fresh['name'];
            $_SESSION['user']['role'] = $fresh['role'];
            $_SESSION['user']['profile_image'] = $fresh['profile_image'] ?? null;
            $_SESSION['user']['theme_preference'] = authTheme($fresh['theme_preference'] ?? 'light');
            $_SESSION['user']['csrf_token'] = csrfToken();
            $u = $_SESSION['user'];
        }
        $u['csrf_token'] = csrfToken();
        jsonSuccess($u);

    default:
        jsonError('Unknown action.', 404);
}
