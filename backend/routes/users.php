<?php
// backend/routes/users.php
// User and role assignment management.

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../account_helpers.php';
$user = requireAuth();
$action = $_GET['action'] ?? 'list';
$db = getDB();
gfEnsureAccountSchema($db);
gfEnsurePasswordResetSchema($db);

if (!in_array($user['role'] ?? '', ['owner', 'manager'], true)) {
    jsonError('Only owners and managers can manage staff accounts.', 403);
}

function roleBranch(PDO $db, ?string $branchId): ?array {
    if (!$branchId) return null;
    $stmt = $db->prepare('SELECT id, name, location FROM branches WHERE id=? LIMIT 1');
    $stmt->execute([$branchId]);
    $branch = $stmt->fetch();
    return $branch ?: null;
}

function currentManagerBranches(PDO $db, array $user): array {
    if (($user['role'] ?? '') !== 'manager') return [];
    $branchIds = gfAssignedBranchIds($db, (int)$user['id']);
    if (!$branchIds && !empty($user['branch_id'])) $branchIds = [$user['branch_id']];
    return gfNormalizeBranchIds($branchIds);
}

function managedTargetUser(PDO $db, array $actor, int $id): array {
    if ($id <= 0) jsonError('User id is required.');
    $stmt = $db->prepare('SELECT id, name, email, role, branch_id, account_status FROM users WHERE id=? LIMIT 1');
    $stmt->execute([$id]);
    $target = $stmt->fetch();
    if (!$target) jsonError('User not found.', 404);

    if (($actor['role'] ?? '') === 'manager') {
        if ($target['role'] !== 'cashier') {
            jsonError('Managers can only manage cashier accounts.', 403);
        }
        $managerBranches = currentManagerBranches($db, $actor);
        if (!in_array((string)$target['branch_id'], $managerBranches, true)) {
            jsonError('This cashier is outside your assigned branch access.', 403);
        }
    }
    return $target;
}

switch ($action) {
    case 'list': {
        $params = [];
        $where = '';
        if (($user['role'] ?? '') === 'manager') {
            $managerBranches = currentManagerBranches($db, $user);
            if (!$managerBranches) jsonSuccess([]);
            $where = "WHERE u.role='cashier' AND u.branch_id IN (" . implode(',', array_fill(0, count($managerBranches), '?')) . ')';
            $params = $managerBranches;
        }
        $stmt = $db->prepare(
            "SELECT u.id, u.username, u.email, u.name, u.role, u.account_status, u.branch_id,
                    u.created_at, u.activated_at, u.last_login_at,
                    b.name AS branch_name, b.location AS branch_location
             FROM users u
             LEFT JOIN branches b ON b.id = u.branch_id
             $where
             ORDER BY FIELD(u.role, 'owner','manager','cashier'), u.name"
        );
        $stmt->execute($params);
        $users = $stmt->fetchAll();

        $branchRows = $db->query(
            "SELECT ub.user_id, ub.branch_id, ub.is_primary, b.name, b.location
               FROM user_branches ub
               LEFT JOIN branches b ON b.id = ub.branch_id
              ORDER BY ub.is_primary DESC, b.name"
        )->fetchAll();
        $byUser = [];
        foreach ($branchRows as $row) {
            $uid = (int)$row['user_id'];
            if (!isset($byUser[$uid])) $byUser[$uid] = [];
            $byUser[$uid][] = [
                'id' => $row['branch_id'],
                'name' => $row['name'],
                'location' => $row['location'],
                'is_primary' => (int)$row['is_primary'],
            ];
        }

        foreach ($users as &$u) {
            $assigned = $byUser[(int)$u['id']] ?? [];
            if (!$assigned && $u['branch_id']) {
                $assigned[] = [
                    'id' => $u['branch_id'],
                    'name' => $u['branch_name'],
                    'location' => $u['branch_location'],
                    'is_primary' => 1,
                ];
            }
            $u['branch_ids'] = array_values(array_map(fn($b) => $b['id'], $assigned));
            $u['branch_labels'] = array_values(array_map(
                fn($b) => trim(($b['name'] ?? $b['id']) . (!empty($b['location']) ? ' - ' . $b['location'] : '')),
                $assigned
            ));
            if ($u['role'] === 'manager' && $assigned) {
                $u['branch_name'] = implode(', ', array_map(fn($b) => $b['name'] ?: $b['id'], $assigned));
                $u['branch_location'] = count($assigned) . ' assigned branch' . (count($assigned) === 1 ? '' : 'es');
            }
        }
        unset($u);
        jsonSuccess($users);
    }

    case 'save': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b = getBody();
        $id = (int)($b['id'] ?? 0);
        $name = trim($b['name'] ?? '');
        $email = strtolower(trim($b['email'] ?? ($b['username'] ?? '')));
        $username = substr($email, 0, 50);
        $role = trim($b['role'] ?? '');
        $branchId = trim($b['branch_id'] ?? '');
        $branchIds = $b['branch_ids'] ?? [];
        if (!is_array($branchIds)) $branchIds = [$branchId];

        if (!$name) jsonError('Full name is required.');
        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError('A valid email is required.');
        if (!in_array($role, ['owner', 'manager', 'cashier'], true)) jsonError('Choose a valid role.');

        $managerBranches = currentManagerBranches($db, $user);
        if (($user['role'] ?? '') === 'manager') {
            if ($role !== 'cashier') jsonError('Managers can only create cashier accounts.', 403);
            if (!$managerBranches) jsonError('No branch is assigned to this manager.', 403);
            if (!in_array($branchId, $managerBranches, true)) {
                jsonError('Managers can only assign cashiers to their assigned branches.', 403);
            }
            $branchIds = [$branchId];
        }

        if ($role === 'owner') {
            $branchId = null;
            $branchIds = [];
        } elseif ($role === 'manager') {
            $valid = gfValidBranches($db, $branchIds);
            if (!$valid) jsonError('Assign at least one valid branch to this manager.');
            $branchIds = array_values(array_filter(gfNormalizeBranchIds($branchIds), fn($id) => isset($valid[$id])));
            if (!$branchIds) jsonError('Assign at least one valid branch to this manager.');
            $branchId = $branchIds[0];
        } else {
            $branch = roleBranch($db, $branchId);
            if (!$branch) jsonError('Cashiers must be assigned to a valid branch.');
            $branchIds = [$branchId];
        }

        if ($id > 0) {
            $check = $db->prepare('SELECT id, role FROM users WHERE id=? LIMIT 1');
            $check->execute([$id]);
            $existing = $check->fetch();
            if (!$existing) jsonError('User not found.', 404);
            if (($user['role'] ?? '') === 'manager') {
                if ($existing['role'] !== 'cashier') {
                    jsonError('Managers can only update cashier accounts.', 403);
                }
                $access = $db->prepare('SELECT branch_id FROM users WHERE id=? LIMIT 1');
                $access->execute([$id]);
                $existingBranch = (string)$access->fetchColumn();
                if (!in_array($existingBranch, $managerBranches, true)) {
                    jsonError('This cashier is outside your assigned branch access.', 403);
                }
            }
            if ($existing['role'] === 'owner' && $role !== 'owner') {
                $owners = $db->prepare("SELECT COUNT(*) FROM users WHERE role='owner' AND id<>?");
                $owners->execute([$id]);
                if ((int)$owners->fetchColumn() < 1) {
                    jsonError('At least one owner account must remain.');
                }
            }

            $dupe = $db->prepare('SELECT id FROM users WHERE email=? AND id<>? LIMIT 1');
            $dupe->execute([$email, $id]);
            if ($dupe->fetch()) jsonError('Email is already used by another account.');

            $stmt = $db->prepare(
                'UPDATE users SET username=?, email=?, name=?, role=?, branch_id=? WHERE id=?'
            );
            $stmt->execute([$username, $email, $name, $role, $branchId, $id]);
            gfSyncUserBranches($db, $id, $branchIds, $branchId);
            auditLog($db, $user, 'user_update', 'user', (string)$id, ['role' => $role, 'branch_ids' => $branchIds]);
            jsonSuccess(['id' => $id], 'User assignment updated.');
        }

        if ($role === 'owner') jsonError('Owner accounts are managed outside this screen.');
        $temporaryPasswordHash = password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT);
        $stmt = $db->prepare(
            "INSERT INTO users (username, email, password, name, role, account_status, branch_id)
             VALUES (?,?,?,?,?,'pending',?)"
        );
        try {
            $stmt->execute([$username, $email, $temporaryPasswordHash, $name, $role, $branchId]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') jsonError('Email is already used by another account.');
            throw $e;
        }
        $newId = (int)$db->lastInsertId();
        gfSyncUserBranches($db, $newId, $branchIds, $branchId);
        auditLog($db, $user, 'user_create_pending', 'user', (string)$newId, ['role' => $role, 'branch_ids' => $branchIds]);
        jsonSuccess(['id' => $newId, 'account_status' => 'pending'], 'Account created as pending. Activate it to send a password setup link.');
    }

    case 'activate': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b = getBody();
        $id = (int)($b['id'] ?? 0);
        $target = managedTargetUser($db, $user, $id);
        if ($target['role'] === 'owner') jsonError('Owner accounts are managed outside this screen.');
        if (empty($target['email']) || !filter_var($target['email'], FILTER_VALIDATE_EMAIL)) {
            jsonError('This account needs a valid email before activation.');
        }

        $wasActive = ($target['account_status'] ?? 'active') === 'active';
        $mailMode = $wasActive ? 'reset' : 'activate';
        $db->beginTransaction();
        try {
            $db->prepare("UPDATE users SET account_status='active', activated_at=COALESCE(activated_at, NOW()), activated_by=COALESCE(activated_by, ?) WHERE id=?")
               ->execute([(int)$user['id'], $id]);
            $link = gfCreatePasswordSetupLink($db, $id);
            auditLog($db, $user, $wasActive ? 'user_password_setup_link' : 'user_activate', 'user', (string)$id, ['email' => $target['email']]);
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }

        $sent = gfSendPasswordSetupEmail($target['email'], $target['name'], $link['url'], $mailMode);
        $data = [
            'id' => $id,
            'account_status' => 'active',
            'mail_sent' => $sent,
            'expires_at' => $link['expires_at'],
            'link_mode' => $mailMode,
        ];
        if (!$sent && gfIsLocalHost()) {
            $data[$wasActive ? 'dev_reset_link' : 'dev_activation_link'] = $link['url'];
        }
        jsonSuccess(
            $data,
            $wasActive
                ? ($sent ? 'Password reset link sent to the user email.' : 'Password reset link created, but this server could not send email.')
                : ($sent ? 'Account activated. Password setup link sent to the user email.' : 'Account activated, but this server could not send email.')
        );
    }

    case 'deactivate': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b = getBody();
        $id = (int)($b['id'] ?? 0);
        $target = managedTargetUser($db, $user, $id);
        if ($target['role'] === 'owner') jsonError('Owner accounts cannot be deactivated here.');

        $db->prepare("UPDATE users SET account_status='deactivated' WHERE id=?")->execute([$id]);
        $db->prepare('UPDATE password_resets SET used_at=NOW() WHERE user_id=? AND used_at IS NULL')->execute([$id]);
        auditLog($db, $user, 'user_deactivate', 'user', (string)$id, ['email' => $target['email']]);
        jsonSuccess(['id' => $id, 'account_status' => 'deactivated'], 'Account deactivated.');
    }

    default:
        jsonError('Unknown action.', 404);
}
