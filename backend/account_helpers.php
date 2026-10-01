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
    gfEnsurePasswordResetSchema($db);
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
    $headers = "From: GreenFuel <no-reply@greenfuel.local>\r\n"
             . "Content-Type: text/plain; charset=UTF-8\r\n";
    return @mail($email, $subject, $body, $headers);
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
