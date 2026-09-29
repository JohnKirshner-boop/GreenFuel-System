<?php
// backend/routes/branches.php
// GET  ?action=list
// GET  ?action=fuels
// POST ?action=create  { id, name, location }   (owner only)

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../account_helpers.php';
$user   = requireAuth();
$action = $_GET['action'] ?? 'list';
$db     = getDB();

function ensureFuelPricingSupport(PDO $db): void {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_branch_prices (
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          price DECIMAL(8,2) NOT NULL,
          approved_request_id INT NULL,
          approved_by INT NULL,
          approved_at DATETIME NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (branch_id, fuel_type),
          FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
          FOREIGN KEY (fuel_type) REFERENCES fuel_types(id) ON DELETE CASCADE,
          FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_price_requests (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          base_price DECIMAL(8,2) NOT NULL,
          current_branch_price DECIMAL(8,2) NULL,
          requested_price DECIMAL(8,2) NOT NULL,
          reason TEXT NULL,
          status ENUM('pending','approved','rejected') DEFAULT 'pending',
          requested_by INT NULL,
          requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_by INT NULL,
          reviewed_at DATETIME NULL,
          review_note TEXT NULL,
          FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
          FOREIGN KEY (fuel_type) REFERENCES fuel_types(id) ON DELETE CASCADE,
          FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        )"
    );
}

gfEnsureAccountSchema($db);
ensureFuelPricingSupport($db);

switch ($action) {

    case 'list': {
        $branchIds = assignedBranchIds($db, $user);
        $whereSql = '';
        $params = [];
        if (($user['role'] ?? '') !== 'owner') {
            if (!$branchIds) jsonSuccess([]);
            $whereSql = 'WHERE b.id IN ('.implode(',', array_fill(0, count($branchIds), '?')).')';
            $params = $branchIds;
        }
        $stmt = $db->prepare(
            'SELECT b.*,
                    COUNT(t.id)                       AS tx_count,
                    COALESCE(SUM(t.total_amount), 0)  AS revenue,
                    COALESCE(SUM(t.liters), 0)        AS liters
             FROM branches b
             LEFT JOIN transactions t ON t.branch_id = b.id AND t.status != \'void\'
             '.$whereSql.'
             GROUP BY b.id
             ORDER BY revenue DESC'
        );
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        $managerParams = [];
        $managerFilter = '';
        if (($user['role'] ?? '') !== 'owner') {
            $managerFilter = ' AND ub.branch_id IN ('.implode(',', array_fill(0, count($branchIds), '?')).')';
            $managerParams = $branchIds;
        }
        $managerStmt = $db->prepare(
            "SELECT ub.branch_id,
                    u.id,
                    u.name,
                    u.email,
                    u.last_seen_at,
                    CASE
                      WHEN u.last_seen_at IS NULL THEN 'offline'
                      WHEN u.last_seen_at >= (NOW() - INTERVAL 5 MINUTE) THEN 'active'
                      WHEN u.last_seen_at >= (NOW() - INTERVAL 30 MINUTE) THEN 'away'
                      ELSE 'offline'
                    END AS presence_status
             FROM user_branches ub
             INNER JOIN users u ON u.id = ub.user_id
             WHERE u.role = 'manager'
             ".$managerFilter."
             ORDER BY ub.is_primary DESC, u.name ASC"
        );
        $managerStmt->execute($managerParams);
        $managerRows = $managerStmt->fetchAll();
        $managersByBranch = [];
        foreach ($managerRows as $manager) {
            $managersByBranch[$manager['branch_id']][] = [
                'id' => (int)$manager['id'],
                'name' => $manager['name'],
                'email' => ($user['role'] ?? '') === 'owner' ? $manager['email'] : null,
                'last_seen_at' => $manager['last_seen_at'],
                'presence_status' => $manager['presence_status'],
            ];
        }

        foreach ($rows as &$row) {
            $managers = $managersByBranch[$row['id']] ?? [];
            $statuses = array_column($managers, 'presence_status');
            $row['managers'] = $managers;
            $row['manager_status'] = in_array('active', $statuses, true)
                ? 'active'
                : (in_array('away', $statuses, true) ? 'away' : ($managers ? 'offline' : 'unassigned'));
        }
        jsonSuccess($rows);
    }

    case 'fuels': {
        $branchId = $_GET['branch_id'] ?? (($user['role'] === 'owner') ? null : ($user['branch_id'] ?? null));
        if ($branchId) $branchId = requireBranchAccess($db, $user, $branchId);
        if ($branchId) {
            $stmt = $db->prepare(
                'SELECT f.id, f.name, f.color,
                        f.price AS base_price,
                        bp.price AS branch_price,
                        COALESCE(bp.price, f.price) AS price,
                        bp.approved_at AS branch_price_approved_at
                 FROM fuel_types f
                 LEFT JOIN fuel_branch_prices bp
                   ON bp.fuel_type = f.id AND bp.branch_id = ?
                 ORDER BY f.name'
            );
            $stmt->execute([$branchId]);
            jsonSuccess($stmt->fetchAll());
        }
        jsonSuccess($db->query(
            'SELECT id, name, color, price AS base_price, NULL AS branch_price, price
             FROM fuel_types
             ORDER BY name'
        )->fetchAll());
    }

    case 'update_price': {
        requireRole('owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b     = getBody();
        $id    = trim($b['id']    ?? '');
        $price = (float)($b['price'] ?? 0);
        if (!$id || $price <= 0) jsonError('fuel id and price required.');
        $stmt = $db->prepare('SELECT id FROM fuel_types WHERE id=? LIMIT 1');
        $stmt->execute([$id]);
        if (!$stmt->fetch()) jsonError('Fuel type not found.', 404);

        $db->beginTransaction();
        try {
            $db->prepare('UPDATE fuel_types SET price=? WHERE id=?')->execute([$price, $id]);
            $db->prepare('UPDATE fuel_branch_prices SET price=? WHERE fuel_type=? AND price > ?')->execute([$price, $id, $price]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        auditLog($db, $user, 'fuel_ceiling_update', 'fuel_type', $id, ['price' => $price]);
        jsonSuccess(null, 'Owner ceiling price updated.');
    }

    case 'request_price': {
        requireRole('cashier');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b = getBody();
        $branchId = requireBranchAccess($db, $user, $user['branch_id'] ?? '');
        $fuelType = trim($b['fuel_type'] ?? '');
        $requestedPrice = (float)($b['requested_price'] ?? 0);
        $reason = trim($b['reason'] ?? '');
        if (!$branchId) jsonError('Cashier branch is required.');
        if (!$fuelType || $requestedPrice <= 0) jsonError('Fuel type and requested price are required.');

        $stmt = $db->prepare(
            'SELECT f.price AS base_price, bp.price AS branch_price
             FROM fuel_types f
             LEFT JOIN fuel_branch_prices bp
               ON bp.fuel_type = f.id AND bp.branch_id = ?
             WHERE f.id = ?
             LIMIT 1'
        );
        $stmt->execute([$branchId, $fuelType]);
        $fuel = $stmt->fetch();
        if (!$fuel) jsonError('Invalid fuel type.');
        if ($requestedPrice > (float)$fuel['base_price']) {
            jsonError('Requested price cannot exceed the owner ceiling price.');
        }

        $db->prepare(
            'INSERT INTO fuel_price_requests
               (branch_id, fuel_type, base_price, current_branch_price, requested_price, reason, requested_by)
             VALUES (?,?,?,?,?,?,?)'
        )->execute([
            $branchId,
            $fuelType,
            (float)$fuel['base_price'],
            $fuel['branch_price'] !== null ? (float)$fuel['branch_price'] : null,
            $requestedPrice,
            substr($reason, 0, 1000),
            $user['id'],
        ]);
        auditLog($db, $user, 'fuel_price_request', 'fuel_type', $fuelType, ['branch_id' => $branchId, 'requested_price' => $requestedPrice]);
        jsonSuccess(null, 'Price change request submitted.');
    }

    case 'price_requests': {
        $where = [];
        $params = [];
        if ($user['role'] !== 'owner') {
            $branchIds = assignedBranchIds($db, $user);
            if (!$branchIds) jsonSuccess([]);
            $where[] = 'r.branch_id IN ('.implode(',', array_fill(0, count($branchIds), '?')).')';
            array_push($params, ...$branchIds);
        } elseif (!empty($_GET['branch_id'])) {
            $where[] = 'r.branch_id = ?';
            $params[] = $_GET['branch_id'];
        }
        if (!empty($_GET['status'])) {
            $where[] = 'r.status = ?';
            $params[] = $_GET['status'];
        }
        $sqlWhere = $where ? 'WHERE '.implode(' AND ', $where) : '';
        $stmt = $db->prepare(
            'SELECT r.*,
                    b.name AS branch_name,
                    b.location AS branch_location,
                    f.name AS fuel_name,
                    f.color AS fuel_color,
                    f.price AS current_ceiling_price,
                    u.name AS requested_by_name,
                    rv.name AS reviewed_by_name
             FROM fuel_price_requests r
             LEFT JOIN branches b ON b.id = r.branch_id
             LEFT JOIN fuel_types f ON f.id = r.fuel_type
             LEFT JOIN users u ON u.id = r.requested_by
             LEFT JOIN users rv ON rv.id = r.reviewed_by
             '.$sqlWhere.'
             ORDER BY FIELD(r.status, \'pending\', \'approved\', \'rejected\'), r.requested_at DESC
             LIMIT 300'
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    case 'review_price': {
        requireRole('manager');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b = getBody();
        $id = (int)($b['request_id'] ?? 0);
        $status = trim($b['status'] ?? '');
        $note = trim($b['review_note'] ?? '');
        if (!$id || !in_array($status, ['approved', 'rejected'], true)) {
            jsonError('Request id and review decision are required.');
        }
        if ($note === '') {
            jsonError('A manager review note is required before approving or rejecting this request.');
        }
        $stmt = $db->prepare('SELECT * FROM fuel_price_requests WHERE id=? LIMIT 1');
        $stmt->execute([$id]);
        $request = $stmt->fetch();
        if (!$request) jsonError('Price request not found.', 404);
        if ($request['status'] !== 'pending') jsonError('This request has already been reviewed.');
        if (!canAccessBranch($db, $user, $request['branch_id'])) {
            jsonError('Managers can only review price requests for their assigned branch.', 403);
        }
        if ($status === 'approved') {
            $ceilingStmt = $db->prepare('SELECT price FROM fuel_types WHERE id=? LIMIT 1');
            $ceilingStmt->execute([$request['fuel_type']]);
            $currentCeiling = $ceilingStmt->fetchColumn();
            if ($currentCeiling === false) jsonError('Fuel type not found.', 404);
            if ((float)$request['requested_price'] > (float)$currentCeiling) {
                jsonError('This request is above the current owner ceiling price.');
            }
        }

        $db->beginTransaction();
        try {
            if ($status === 'approved') {
                $db->prepare(
                    'INSERT INTO fuel_branch_prices
                       (branch_id, fuel_type, price, approved_request_id, approved_by, approved_at)
                     VALUES (?,?,?,?,?,NOW())
                     ON DUPLICATE KEY UPDATE
                       price=VALUES(price),
                       approved_request_id=VALUES(approved_request_id),
                       approved_by=VALUES(approved_by),
                       approved_at=VALUES(approved_at)'
                )->execute([
                    $request['branch_id'],
                    $request['fuel_type'],
                    $request['requested_price'],
                    $id,
                    $user['id'],
                ]);
            }
            $db->prepare(
                'UPDATE fuel_price_requests
                 SET status=?, reviewed_by=?, reviewed_at=NOW(), review_note=?
                 WHERE id=?'
            )->execute([$status, $user['id'], substr($note, 0, 1000), $id]);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
        auditLog($db, $user, 'fuel_price_review', 'fuel_price_request', (string)$id, [
            'status' => $status,
            'branch_id' => $request['branch_id'],
            'fuel_type' => $request['fuel_type'],
        ]);
        jsonSuccess(null, $status === 'approved' ? 'Branch price approved.' : 'Price request rejected.');
    }

    case 'create': {
        requireRole('owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b        = getBody();
        $id       = trim($b['id']       ?? '');
        $name     = trim($b['name']     ?? '');
        $location = trim($b['location'] ?? '');
        if (!$id || !$name || !$location) jsonError('id, name and location required.');
        if (!preg_match('/^[a-zA-Z0-9_-]{2,20}$/', $id)) jsonError('Branch ID must be 2-20 letters, numbers, dashes, or underscores.');
        try {
            $db->prepare('INSERT INTO branches (id,name,location) VALUES (?,?,?)')->execute([$id,$name,$location]);
            auditLog($db, $user, 'branch_create', 'branch', $id, ['name' => $name, 'location' => $location]);
            jsonSuccess(['id'=>$id], 'Branch created.');
        } catch (PDOException $e) {
            jsonError('Branch ID already exists.');
        }
    }

    default:
        jsonError('Unknown action.', 404);
}
