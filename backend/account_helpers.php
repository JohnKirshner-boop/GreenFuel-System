<?php
// Shared account schema and branch-assignment helpers.

function gfColumnExists(PDO $db, string $table, string $column): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*)
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?'
    );
    $stmt->execute([DB_NAME, $table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function gfIndexExists(PDO $db, string $table, string $index): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*)
           FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?'
    );
    $stmt->execute([DB_NAME, $table, $index]);
    return (int)$stmt->fetchColumn() > 0;
}

function gfUseDemoEmailIfAvailable(PDO $db, string $email, string $where): void {
    $check = $db->prepare('SELECT id FROM users WHERE email=? LIMIT 1');
    $check->execute([$email]);
    if ($check->fetch()) return;
    $db->exec('UPDATE users SET email=' . $db->quote($email) . " WHERE $where LIMIT 1");
}

function gfEnsureAccountSchema(PDO $db): void {
    if (!gfColumnExists($db, 'users', 'email')) {
        $db->exec('ALTER TABLE users ADD COLUMN email VARCHAR(120) NULL AFTER username');
    }
    if (!gfColumnExists($db, 'users', 'profile_image')) {
        $db->exec('ALTER TABLE users ADD COLUMN profile_image LONGTEXT NULL AFTER branch_id');
    }
    if (!gfColumnExists($db, 'users', 'theme_preference')) {
        $db->exec("ALTER TABLE users ADD COLUMN theme_preference VARCHAR(20) NOT NULL DEFAULT 'light' AFTER profile_image");
    }
    if (!gfColumnExists($db, 'users', 'last_login_at')) {
        $db->exec('ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL AFTER theme_preference');
    }
    if (!gfColumnExists($db, 'users', 'last_seen_at')) {
        $db->exec('ALTER TABLE users ADD COLUMN last_seen_at DATETIME NULL AFTER last_login_at');
    }
    if (!gfColumnExists($db, 'users', 'account_status')) {
        $db->exec("ALTER TABLE users ADD COLUMN account_status ENUM('pending','active','deactivated') NOT NULL DEFAULT 'active' AFTER role");
    }
    if (!gfColumnExists($db, 'users', 'activated_at')) {
        $db->exec('ALTER TABLE users ADD COLUMN activated_at DATETIME NULL AFTER last_seen_at');
    }
    if (!gfColumnExists($db, 'users', 'activated_by')) {
        $db->exec('ALTER TABLE users ADD COLUMN activated_by INT NULL AFTER activated_at');
    }

    $db->exec(
        "UPDATE users
            SET email = CONCAT(LOWER(REPLACE(username, ' ', '')), '@greenfuel.local')
          WHERE email IS NULL OR email = ''"
    );

    $db->exec(
        "UPDATE users
            SET account_status='active'
          WHERE account_status IS NULL OR account_status = ''"
    );

    gfUseDemoEmailIfAvailable($db, 'owner@greenfuel.local', "role='owner' AND (username='admin' OR email='admin@greenfuel.local')");
    gfUseDemoEmailIfAvailable($db, 'manager1@greenfuel.local', "role='manager' AND (username IN ('manager1','manag') OR name LIKE 'Maria%')");
    gfUseDemoEmailIfAvailable($db, 'manager2@greenfuel.local', "role='manager' AND (username='manager2' OR name LIKE 'Juan%')");
    gfUseDemoEmailIfAvailable($db, 'cashier1@greenfuel.local', "role='cashier' AND (username='cashier1' OR name LIKE 'Ana%')");
    gfUseDemoEmailIfAvailable($db, 'cashier2@greenfuel.local', "role='cashier' AND (username='cashier2' OR name LIKE 'Pedro%')");

    if (!gfIndexExists($db, 'users', 'uq_users_email')) {
        try {
            $db->exec('ALTER TABLE users ADD UNIQUE KEY uq_users_email (email)');
        } catch (PDOException $e) {
            // Existing duplicate legacy data should not block the app; explicit
            // duplicate checks still run in users.php before saving.
        }
    }

    $db->exec(
        "CREATE TABLE IF NOT EXISTS user_branches (
          user_id    INT         NOT NULL,
          branch_id  VARCHAR(10) NOT NULL,
          is_primary TINYINT(1)  NOT NULL DEFAULT 0,
          created_at DATETIME    DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, branch_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
        )"
    );

    $db->exec(
        "INSERT IGNORE INTO user_branches (user_id, branch_id, is_primary)
         SELECT id, branch_id, 1
           FROM users
          WHERE role IN ('manager','cashier')
            AND branch_id IS NOT NULL
            AND branch_id <> ''"
    );
}

function gfEnsurePasswordResetSchema(PDO $db): void {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS password_resets (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          token_hash CHAR(64) NOT NULL,
          expires_at DATETIME NOT NULL,
          used_at DATETIME NULL,
          requested_ip VARCHAR(45) NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_password_resets_token (token_hash),
          KEY idx_password_resets_user (user_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )"
    );

    if (!gfColumnExists($db, 'password_resets', 'user_id')) {
        $db->exec('ALTER TABLE password_resets ADD COLUMN user_id INT NOT NULL AFTER id');
    }
    if (!gfColumnExists($db, 'password_resets', 'token_hash')) {
        $db->exec('ALTER TABLE password_resets ADD COLUMN token_hash CHAR(64) NOT NULL AFTER user_id');
    }
    if (!gfColumnExists($db, 'password_resets', 'expires_at')) {
        $db->exec('ALTER TABLE password_resets ADD COLUMN expires_at DATETIME NOT NULL AFTER token_hash');
    }
    if (!gfColumnExists($db, 'password_resets', 'used_at')) {
        $db->exec('ALTER TABLE password_resets ADD COLUMN used_at DATETIME NULL AFTER expires_at');
    }
    if (!gfColumnExists($db, 'password_resets', 'requested_ip')) {
        $db->exec('ALTER TABLE password_resets ADD COLUMN requested_ip VARCHAR(45) NULL AFTER used_at');
    }
    if (!gfColumnExists($db, 'password_resets', 'created_at')) {
        $db->exec('ALTER TABLE password_resets ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER requested_ip');
    }
    if (!gfIndexExists($db, 'password_resets', 'uq_password_resets_token')) {
        try {
            $db->exec('ALTER TABLE password_resets ADD UNIQUE KEY uq_password_resets_token (token_hash)');
        } catch (PDOException $e) {
            error_log('GreenFuel password reset token index repair skipped: '.$e->getMessage());
        }
    }
    if (!gfIndexExists($db, 'password_resets', 'idx_password_resets_user')) {
        try {
            $db->exec('ALTER TABLE password_resets ADD KEY idx_password_resets_user (user_id)');
        } catch (PDOException $e) {
            error_log('GreenFuel password reset user index repair skipped: '.$e->getMessage());
        }
    }
}

function gfPasswordSetupUrl(string $token): string {
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (string)($_SERVER['SERVER_PORT'] ?? '') === '443'
        || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    $scheme = $isHttps ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $script = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/greenfuel-project/backend/routes/users.php');
    $frontend = preg_replace('#/backend/routes/(users|auth)\.php$#', '/frontend/index.html', $script);
    if (!$frontend || $frontend === $script) $frontend = '/frontend/index.html';
    return $scheme.'://'.$host.$frontend.'?reset_token='.rawurlencode($token);
}

function gfIsLocalHost(): bool {
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    return strpos($host, 'localhost') !== false || strpos($host, '127.0.0.1') !== false;
}

function gfCreatePasswordSetupLink(PDO $db, int $userId): array {
    if (!$db->inTransaction()) {
        gfEnsurePasswordResetSchema($db);
    }
    $token = bin2hex(random_bytes(32));
    $tokenHash = hash('sha256', $token);
    $expiresAt = date('Y-m-d H:i:s', time() + 3600);
    $db->prepare('UPDATE password_resets SET used_at=NOW() WHERE user_id=? AND used_at IS NULL')
       ->execute([$userId]);
    $db->prepare(
        'INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
         VALUES (?, ?, ?, ?)'
    )->execute([
        $userId,
        $tokenHash,
        $expiresAt,
        substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45) ?: null,
    ]);
    return [
        'url' => gfPasswordSetupUrl($token),
        'expires_at' => $expiresAt,
    ];
}

function gfMailCleanHeader(string $value): string {
    return trim(str_replace(["\r", "\n"], '', $value));
}

function gfMailAddress(string $email, string $name = ''): string {
    $email = gfMailCleanHeader($email);
    $name = gfMailCleanHeader($name);
    return $name !== '' ? '"' . addcslashes($name, '"\\') . "\" <{$email}>" : $email;
}

function gfSmtpRead($socket): array {
    $response = '';
    while (($line = fgets($socket, 515)) !== false) {
        $response .= $line;
        if (strlen($line) >= 4 && $line[3] === ' ') break;
    }
    if ($response === '') {
        throw new RuntimeException('No response from SMTP server.');
    }
    return [(int)substr($response, 0, 3), trim($response)];
}

function gfSmtpCommand($socket, ?string $command, array $expectedCodes, string $label): void {
    if ($command !== null) {
        fwrite($socket, $command . "\r\n");
    }
    [$code, $response] = gfSmtpRead($socket);
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException($label . ' failed: ' . $response);
    }
}

function gfSmtpSendEmail(string $toEmail, string $toName, string $subject, string $body): bool {
    $host = envValue('GREENFUEL_MAIL_HOST', '');
    $port = (int)envValue('GREENFUEL_MAIL_PORT', '587');
    $username = envValue('GREENFUEL_MAIL_USERNAME', '');
    $password = envValue('GREENFUEL_MAIL_PASSWORD', '');
    $secure = strtolower(envValue('GREENFUEL_MAIL_SECURE', $port === 465 ? 'ssl' : 'tls'));
    $fromEmail = envValue('GREENFUEL_MAIL_FROM', $username ?: 'no-reply@greenfuel.local');
    $fromName = envValue('GREENFUEL_MAIL_FROM_NAME', 'GreenFuel');

    if (!$host || !$username || !$password || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
        error_log('GreenFuel SMTP is not fully configured.');
        return false;
    }

    $remote = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
    $socket = @stream_socket_client($remote, $errno, $errstr, 20, STREAM_CLIENT_CONNECT);
    if (!$socket) {
        error_log("GreenFuel SMTP connection failed: {$errstr} ({$errno})");
        return false;
    }

    try {
        stream_set_timeout($socket, 20);
        gfSmtpCommand($socket, null, [220], 'SMTP greeting');
        $ehloHost = $_SERVER['SERVER_NAME'] ?? (parse_url(requestOrigin(), PHP_URL_HOST) ?: 'greenfuel.local');
        gfSmtpCommand($socket, 'EHLO ' . $ehloHost, [250], 'SMTP EHLO');

        if ($secure === 'tls') {
            gfSmtpCommand($socket, 'STARTTLS', [220], 'SMTP STARTTLS');
            if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new RuntimeException('Could not enable SMTP TLS encryption.');
            }
            gfSmtpCommand($socket, 'EHLO ' . $ehloHost, [250], 'SMTP EHLO after STARTTLS');
        }

        gfSmtpCommand($socket, 'AUTH LOGIN', [334], 'SMTP auth start');
        gfSmtpCommand($socket, base64_encode($username), [334], 'SMTP username');
        gfSmtpCommand($socket, base64_encode($password), [235], 'SMTP password');

        gfSmtpCommand($socket, 'MAIL FROM:<' . gfMailCleanHeader($fromEmail) . '>', [250], 'SMTP sender');
        gfSmtpCommand($socket, 'RCPT TO:<' . gfMailCleanHeader($toEmail) . '>', [250, 251], 'SMTP recipient');
        gfSmtpCommand($socket, 'DATA', [354], 'SMTP data');

        $safeSubject = gfMailCleanHeader($subject);
        $headers = [
            'Date: ' . date('r'),
            'From: ' . gfMailCleanHeader($fromEmail),
            'To: ' . gfMailCleanHeader($toEmail),
            'Subject: ' . $safeSubject,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=US-ASCII',
            'Content-Transfer-Encoding: 7bit',
        ];
        $message = implode("\r\n", $headers) . "\r\n\r\n" . str_replace(["\r\n", "\r"], "\n", $body);
        $message = str_replace("\n", "\r\n", $message);
        $message = preg_replace('/^\./m', '..', $message);
        fwrite($socket, $message . "\r\n.\r\n");
        gfSmtpCommand($socket, null, [250], 'SMTP send');
        gfSmtpCommand($socket, 'QUIT', [221, 250], 'SMTP quit');
        fclose($socket);
        return true;
    } catch (Throwable $e) {
        error_log('GreenFuel SMTP send failed: ' . $e->getMessage());
        if (is_resource($socket)) {
            @fwrite($socket, "QUIT\r\n");
            @fclose($socket);
        }
        return false;
    }
}

function gfBrevoApiSendEmail(string $toEmail, string $toName, string $subject, string $body): bool {
    $apiKey = envValue('GREENFUEL_BREVO_API_KEY', envValue('BREVO_API_KEY', ''));
    $fromEmail = envValue('GREENFUEL_MAIL_FROM', 'no-reply@greenfuel.local');
    $fromName = envValue('GREENFUEL_MAIL_FROM_NAME', 'GreenFuel');

    if (!$apiKey || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL) || !filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        error_log('GreenFuel Brevo API is not fully configured.');
        return false;
    }

    $payload = [
        'sender' => [
            'email' => gfMailCleanHeader($fromEmail),
            'name' => gfMailCleanHeader($fromName),
        ],
        'to' => [[
            'email' => gfMailCleanHeader($toEmail),
            'name' => gfMailCleanHeader($toName) ?: gfMailCleanHeader($toEmail),
        ]],
        'subject' => gfMailCleanHeader($subject),
        'textContent' => str_replace(["\r\n", "\r"], "\n", $body),
    ];

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => implode("\r\n", [
                'Accept: application/json',
                'Content-Type: application/json',
                'api-key: ' . gfMailCleanHeader($apiKey),
            ]),
            'content' => json_encode($payload, JSON_UNESCAPED_SLASHES),
            'ignore_errors' => true,
            'timeout' => 20,
        ],
    ]);

    $response = @file_get_contents('https://api.brevo.com/v3/smtp/email', false, $context);
    $statusLine = $http_response_header[0] ?? '';
    $statusCode = preg_match('/\s(\d{3})\s/', $statusLine, $m) ? (int)$m[1] : 0;
    if (in_array($statusCode, [200, 201, 202], true)) {
        return true;
    }

    $details = is_string($response) && $response !== '' ? substr($response, 0, 300) : $statusLine;
    error_log('GreenFuel Brevo API send failed: HTTP ' . $statusCode . ' ' . $details);
    return false;
}

function gfSendSystemEmail(string $email, string $name, string $subject, string $body): bool {
    $driver = strtolower(envValue('GREENFUEL_MAIL_DRIVER', 'mail'));
    if ($driver === 'brevo_api') {
        return gfBrevoApiSendEmail($email, $name, $subject, $body);
    }
    if ($driver === 'smtp') {
        return gfSmtpSendEmail($email, $name, $subject, $body);
    }

    $fromEmail = envValue('GREENFUEL_MAIL_FROM', 'no-reply@greenfuel.local');
    $fromName = envValue('GREENFUEL_MAIL_FROM_NAME', 'GreenFuel');
    $headers = 'From: ' . gfMailAddress($fromEmail, $fromName) . "\r\n"
             . "Content-Type: text/plain; charset=UTF-8\r\n";
    return @mail($email, gfMailCleanHeader($subject), $body, $headers);
}

function gfSendPasswordSetupEmail(string $email, string $name, string $url, string $mode = 'activate'): bool {
    $isActivation = $mode === 'activate';
    $subject = $isActivation ? 'GreenFuel account activation link' : 'GreenFuel password reset link';
    $intro = $isActivation
        ? 'Your GreenFuel account has been activated.'
        : 'A GreenFuel password setup/reset link was requested for your account.';
    $body = "Hello {$name},\n\n"
          . "{$intro}\n\n"
          . "Open this link to create your own password:\n{$url}\n\n"
          . "This link expires in 1 hour. If you did not expect this email, please contact your administrator.\n\n"
          . "GreenFuel Management System";
    return gfSendSystemEmail($email, $name, $subject, $body);
}

function gfNormalizeBranchIds(array $branchIds): array {
    $clean = [];
    foreach ($branchIds as $id) {
        $id = trim((string)$id);
        if ($id !== '' && !in_array($id, $clean, true)) $clean[] = $id;
    }
    return $clean;
}

function gfValidBranches(PDO $db, array $branchIds): array {
    $branchIds = gfNormalizeBranchIds($branchIds);
    if (!$branchIds) return [];
    $placeholders = implode(',', array_fill(0, count($branchIds), '?'));
    $stmt = $db->prepare("SELECT id, name, location FROM branches WHERE id IN ($placeholders)");
    $stmt->execute($branchIds);
    $rows = $stmt->fetchAll();
    $byId = [];
    foreach ($rows as $row) $byId[$row['id']] = $row;
    return $byId;
}

function gfAssignedBranchIds(PDO $db, int $userId): array {
    $stmt = $db->prepare(
        'SELECT branch_id
           FROM user_branches
          WHERE user_id=?
          ORDER BY is_primary DESC, branch_id ASC'
    );
    $stmt->execute([$userId]);
    return array_values(array_filter(array_map(fn($r) => $r['branch_id'], $stmt->fetchAll())));
}

function gfSyncUserBranches(PDO $db, int $userId, array $branchIds, ?string $primaryBranchId = null): void {
    $branchIds = gfNormalizeBranchIds($branchIds);
    $primaryBranchId = $primaryBranchId ?: ($branchIds[0] ?? null);
    $db->prepare('DELETE FROM user_branches WHERE user_id=?')->execute([$userId]);
    if (!$branchIds) return;

    $stmt = $db->prepare(
        'INSERT INTO user_branches (user_id, branch_id, is_primary)
         VALUES (?,?,?)'
    );
    foreach ($branchIds as $branchId) {
        $stmt->execute([$userId, $branchId, $branchId === $primaryBranchId ? 1 : 0]);
    }
}
