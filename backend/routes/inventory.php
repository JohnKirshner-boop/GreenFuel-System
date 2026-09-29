<?php
// backend/routes/inventory.php
// GET  ?action=dashboard|levels|movements|calibration|reports_daily|reports_weekly|reports_summary
// POST ?action=measure|refill|calibration

require_once __DIR__ . '/../config.php';
$user = requireAuth();
$db = getDB();
$action = $_GET['action'] ?? 'dashboard';

function invColumnExists(PDO $db, string $table, string $column): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute([DB_NAME, $table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function ensureInventorySupport(PDO $db): void {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_calibration_profiles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          tank_name VARCHAR(80) NOT NULL,
          tank_capacity_liters DECIMAL(12,2) NOT NULL DEFAULT 0,
          liters_per_cm DECIMAL(12,4) NOT NULL DEFAULT 100,
          critical_liters DECIMAL(12,2) NOT NULL DEFAULT 1000,
          max_height_cm DECIMAL(8,2) NOT NULL DEFAULT 100,
          active TINYINT(1) NOT NULL DEFAULT 1,
          updated_by INT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_calib_profile (branch_id, fuel_type)
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_calibration_rows (
          id INT AUTO_INCREMENT PRIMARY KEY,
          profile_id INT NOT NULL,
          height_cm DECIMAL(8,2) NOT NULL,
          liters_value DECIMAL(12,2) NOT NULL,
          UNIQUE KEY uq_profile_height (profile_id, height_cm)
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_inventory_levels (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          current_liters DECIMAL(12,2) NOT NULL DEFAULT 0,
          last_measurement_cm DECIMAL(8,2) NULL,
          last_measured_at DATETIME NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_inventory_level (branch_id, fuel_type)
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_tank_measurements (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          measurement_cm DECIMAL(8,2) NOT NULL,
          estimated_liters DECIMAL(12,2) NOT NULL,
          calibration_mode ENUM('ratio','lookup') DEFAULT 'ratio',
          encoded_by INT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_refill_records (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          liters_added DECIMAL(12,2) NOT NULL,
          refill_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          notes VARCHAR(255) NULL,
          encoded_by INT NULL
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_inventory_movements (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          movement_type ENUM('measurement_set','sale_deduction','refill_addition','adjustment','void_reversal') NOT NULL,
          liters_delta DECIMAL(12,2) NOT NULL,
          liters_before DECIMAL(12,2) NOT NULL DEFAULT 0,
          liters_after DECIMAL(12,2) NOT NULL DEFAULT 0,
          reference_type VARCHAR(30) NULL,
          reference_id VARCHAR(50) NULL,
          notes VARCHAR(255) NULL,
          encoded_by INT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS fuel_inventory_alerts (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          fuel_type VARCHAR(20) NOT NULL,
          alert_type ENUM('low_stock','refill_required') NOT NULL,
          message VARCHAR(255) NOT NULL,
          status ENUM('active','resolved') DEFAULT 'active',
          triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          resolved_at DATETIME NULL,
          resolved_by INT NULL
        )"
    );

    if (!invColumnExists($db, 'users', 'can_inventory_input')) {
        $db->exec("ALTER TABLE users ADD COLUMN can_inventory_input TINYINT(1) NOT NULL DEFAULT 1");
    }

    $branches = $db->query("SELECT id FROM branches")->fetchAll();
    foreach ($branches as $b) {
        foreach (['diesel','unleaded','premium'] as $fuel) {
            $stmt = $db->prepare(
                "INSERT IGNORE INTO fuel_calibration_profiles
                 (branch_id, fuel_type, tank_name, tank_capacity_liters, liters_per_cm, critical_liters, max_height_cm)
                 VALUES (?,?,?,?,?,?,?)"
            );
            $stmt->execute([$b['id'], $fuel, ucfirst($fuel).' Tank', 10000, 100, 1000, 100]);
            $lvl = $db->prepare(
                "INSERT IGNORE INTO fuel_inventory_levels
                 (branch_id, fuel_type, current_liters, last_measurement_cm, last_measured_at)
                 VALUES (?,?,?,?,NOW())"
            );
            $lvl->execute([$b['id'], $fuel, 0, 0]);
        }
    }
}

function allowedBranch(array $user, ?string $branch): string {
    return activeBranchId(getDB(), $user, $branch ?: ($user['branch_id'] ?? null));
}

function logMovement(PDO $db, string $branch, string $fuel, string $type, float $delta, float $before, float $after, ?string $refType, ?string $refId, ?int $uid, string $notes = ''): void {
    $stmt = $db->prepare(
        "INSERT INTO fuel_inventory_movements
         (branch_id, fuel_type, movement_type, liters_delta, liters_before, liters_after, reference_type, reference_id, notes, encoded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    $stmt->execute([$branch, $fuel, $type, $delta, $before, $after, $refType, $refId, $notes, $uid]);
}

function upsertAlert(PDO $db, string $branch, string $fuel, float $currentLiters, ?int $uid): void {
    $critStmt = $db->prepare("SELECT critical_liters FROM fuel_calibration_profiles WHERE branch_id=? AND fuel_type=? LIMIT 1");
    $critStmt->execute([$branch, $fuel]);
    $critical = (float)($critStmt->fetchColumn() ?: 0);

    if ($critical > 0 && $currentLiters <= $critical) {
        $msg = 'Low '.ucfirst($fuel).' stock: '.number_format($currentLiters, 2).'L';
        $ins = $db->prepare(
            "INSERT INTO fuel_inventory_alerts (branch_id, fuel_type, alert_type, message, status)
             SELECT ?, ?, 'low_stock', ?, 'active'
             WHERE NOT EXISTS (
                SELECT 1 FROM fuel_inventory_alerts
                WHERE branch_id=? AND fuel_type=? AND alert_type='low_stock' AND status='active'
             )"
        );
        $ins->execute([$branch, $fuel, $msg, $branch, $fuel]);
    } else {
        $res = $db->prepare(
            "UPDATE fuel_inventory_alerts
             SET status='resolved', resolved_at=NOW(), resolved_by=?
             WHERE branch_id=? AND fuel_type=? AND alert_type='low_stock' AND status='active'"
        );
        $res->execute([$uid, $branch, $fuel]);
    }
}

function estimateLiters(PDO $db, string $branch, string $fuel, float $cm): array {
    $profile = $db->prepare(
        "SELECT id, liters_per_cm, max_height_cm FROM fuel_calibration_profiles
         WHERE branch_id=? AND fuel_type=? AND active=1 LIMIT 1"
    );
    $profile->execute([$branch, $fuel]);
    $p = $profile->fetch();
    if (!$p) jsonError('Calibration profile missing for '.$fuel.'.');
    if ($cm < 0 || $cm > (float)$p['max_height_cm']) jsonError('Measurement out of allowed cm range.');

    $rowStmt = $db->prepare("SELECT liters_value FROM fuel_calibration_rows WHERE profile_id=? AND height_cm=? LIMIT 1");
    $rowStmt->execute([$p['id'], round($cm, 2)]);
    $liters = $rowStmt->fetchColumn();
    if ($liters !== false) return ['liters' => round((float)$liters, 2), 'mode' => 'lookup'];

    return ['liters' => round($cm * (float)$p['liters_per_cm'], 2), 'mode' => 'ratio'];
}

ensureInventorySupport($db);

switch ($action) {
    case 'levels': {
        $branch = allowedBranch($user, $_GET['branch_id'] ?? null);
        $stmt = $db->prepare(
            "SELECT l.branch_id, b.name AS branch_name, l.fuel_type, f.name AS fuel_name, f.color, l.current_liters,
                    l.last_measurement_cm, l.last_measured_at, p.critical_liters, p.tank_capacity_liters
             FROM fuel_inventory_levels l
             LEFT JOIN branches b ON b.id=l.branch_id
             LEFT JOIN fuel_types f ON f.id=l.fuel_type
             LEFT JOIN fuel_calibration_profiles p ON p.branch_id=l.branch_id AND p.fuel_type=l.fuel_type
             WHERE l.branch_id=? AND l.fuel_type IN ('diesel','unleaded','premium')
             ORDER BY FIELD(l.fuel_type,'diesel','unleaded','premium')"
        );
        $stmt->execute([$branch]);
        jsonSuccess($stmt->fetchAll());
    }

    case 'measure': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        if (!in_array($user['role'], ['cashier','manager','owner'])) jsonError('Access denied.', 403);
        $b = getBody();
        $branch = allowedBranch($user, $b['branch_id'] ?? null);
        $fuel = trim($b['fuel_type'] ?? '');
        $cm = is_numeric($b['measurement_cm'] ?? null) ? (float)$b['measurement_cm'] : -1;
        if (!in_array($fuel, ['diesel','unleaded','premium'])) jsonError('Invalid fuel type.');
        if ($cm < 0) jsonError('Measurement must be zero or positive.');

        $estimate = estimateLiters($db, $branch, $fuel, $cm);
        $db->beginTransaction();
        try {
            $lock = $db->prepare("SELECT current_liters FROM fuel_inventory_levels WHERE branch_id=? AND fuel_type=? FOR UPDATE");
            $lock->execute([$branch, $fuel]);
            $before = (float)($lock->fetchColumn() ?: 0);
            $after = $estimate['liters'];
            $delta = round($after - $before, 2);

            $db->prepare(
                "UPDATE fuel_inventory_levels
                 SET current_liters=?, last_measurement_cm=?, last_measured_at=NOW()
                 WHERE branch_id=? AND fuel_type=?"
            )->execute([$after, $cm, $branch, $fuel]);

            $db->prepare(
                "INSERT INTO fuel_tank_measurements
                 (branch_id, fuel_type, measurement_cm, estimated_liters, calibration_mode, encoded_by)
                 VALUES (?,?,?,?,?,?)"
            )->execute([$branch, $fuel, $cm, $after, $estimate['mode'], $user['id']]);

            logMovement($db, $branch, $fuel, 'measurement_set', $delta, $before, $after, 'measurement', null, (int)$user['id'], 'Tank measurement sync');
            upsertAlert($db, $branch, $fuel, $after, (int)$user['id']);
            $db->commit();
            auditLog($db, $user, 'inventory_measure', 'fuel_inventory', $branch.'-'.$fuel, ['measurement_cm' => $cm, 'estimated_liters' => $after]);
            jsonSuccess(['fuel_type' => $fuel, 'measurement_cm' => $cm, 'estimated_liters' => $after], 'Measurement saved.');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('GreenFuel inventory measure failed: '.$e->getMessage());
            jsonError('Could not save measurement.', 500);
        }
    }

    case 'refill': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireRole('manager', 'owner');
        requireCsrf();
        $b = getBody();
        $branch = allowedBranch($user, $b['branch_id'] ?? null);
        $fuel = trim($b['fuel_type'] ?? '');
        $added = is_numeric($b['liters_added'] ?? null) ? (float)$b['liters_added'] : 0;
        $notes = trim($b['notes'] ?? '');
        if (!in_array($fuel, ['diesel','unleaded','premium'])) jsonError('Invalid fuel type.');
        if ($added <= 0) jsonError('liters_added must be greater than zero.');

        $db->beginTransaction();
        try {
            $lock = $db->prepare("SELECT current_liters FROM fuel_inventory_levels WHERE branch_id=? AND fuel_type=? FOR UPDATE");
            $lock->execute([$branch, $fuel]);
            $before = (float)($lock->fetchColumn() ?: 0);
            $after = round($before + $added, 2);

            $db->prepare(
                "UPDATE fuel_inventory_levels SET current_liters=?, updated_at=NOW() WHERE branch_id=? AND fuel_type=?"
            )->execute([$after, $branch, $fuel]);
            $db->prepare(
                "INSERT INTO fuel_refill_records (branch_id, fuel_type, liters_added, notes, encoded_by)
                 VALUES (?,?,?,?,?)"
            )->execute([$branch, $fuel, $added, $notes, $user['id']]);
            logMovement($db, $branch, $fuel, 'refill_addition', $added, $before, $after, 'refill', null, (int)$user['id'], $notes);
            upsertAlert($db, $branch, $fuel, $after, (int)$user['id']);
            $db->commit();
            auditLog($db, $user, 'inventory_refill', 'fuel_inventory', $branch.'-'.$fuel, ['liters_added' => $added]);
            jsonSuccess(['fuel_type' => $fuel, 'liters_after' => $after], 'Refill recorded.');
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('GreenFuel inventory refill failed: '.$e->getMessage());
            jsonError('Could not record refill.', 500);
        }
    }

    case 'movements': {
        $branch = allowedBranch($user, $_GET['branch_id'] ?? null);
        $fuel = trim($_GET['fuel_type'] ?? '');
        $from = trim($_GET['date_from'] ?? '');
        $to = trim($_GET['date_to'] ?? '');
        $where = ['m.branch_id=?']; $params = [$branch];
        if ($fuel) { $where[] = 'm.fuel_type=?'; $params[] = $fuel; }
        if ($from) { $where[] = 'DATE(m.created_at) >= ?'; $params[] = $from; }
        if ($to)   { $where[] = 'DATE(m.created_at) <= ?'; $params[] = $to; }
        $params[] = min((int)($_GET['limit'] ?? 200), 500);

        $stmt = $db->prepare(
            "SELECT m.*, b.name AS branch_name, f.name AS fuel_name, u.name AS encoder_name
             FROM fuel_inventory_movements m
             LEFT JOIN branches b ON b.id=m.branch_id
             LEFT JOIN fuel_types f ON f.id=m.fuel_type
             LEFT JOIN users u ON u.id=m.encoded_by
             WHERE ".implode(' AND ', $where)."
             ORDER BY m.created_at DESC
             LIMIT ?"
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    case 'calibration': {
        if ($_SERVER['REQUEST_METHOD'] === 'GET') {
            $branch = allowedBranch($user, $_GET['branch_id'] ?? null);
            $stmt = $db->prepare(
                "SELECT p.*, f.name AS fuel_name
                 FROM fuel_calibration_profiles p
                 LEFT JOIN fuel_types f ON f.id=p.fuel_type
                 WHERE p.branch_id=? AND p.fuel_type IN ('diesel','unleaded','premium')
                 ORDER BY FIELD(p.fuel_type,'diesel','unleaded','premium')"
            );
            $stmt->execute([$branch]);
            jsonSuccess($stmt->fetchAll());
        }
        requireRole('owner');
        requireCsrf();
        $b = getBody();
        $branch = allowedBranch($user, $b['branch_id'] ?? null);
        $fuel = trim($b['fuel_type'] ?? '');
        $lpc = (float)($b['liters_per_cm'] ?? 0);
        $critical = (float)($b['critical_liters'] ?? 0);
        $maxCm = (float)($b['max_height_cm'] ?? 0);
        if (!in_array($fuel, ['diesel','unleaded','premium'])) jsonError('Invalid fuel type.');
        if ($lpc <= 0 || $maxCm <= 0) jsonError('liters_per_cm and max_height_cm must be > 0.');

        $db->prepare(
            "UPDATE fuel_calibration_profiles
             SET liters_per_cm=?, critical_liters=?, max_height_cm=?, updated_by=?, updated_at=NOW()
             WHERE branch_id=? AND fuel_type=?"
        )->execute([$lpc, max(0, $critical), $maxCm, $user['id'], $branch, $fuel]);
        auditLog($db, $user, 'inventory_calibration_update', 'fuel_calibration', $branch.'-'.$fuel);
        jsonSuccess(null, 'Calibration updated.');
    }

    case 'dashboard': {
        $branch = allowedBranch($user, $_GET['branch_id'] ?? null);
        $today = date('Y-m-d');
        $weekStart = date('Y-m-d', strtotime('-6 days'));

        $levelsStmt = $db->prepare(
            "SELECT l.fuel_type, f.name AS fuel_name, f.color, l.current_liters, p.critical_liters, p.tank_capacity_liters
             FROM fuel_inventory_levels l
             LEFT JOIN fuel_types f ON f.id=l.fuel_type
             LEFT JOIN fuel_calibration_profiles p ON p.branch_id=l.branch_id AND p.fuel_type=l.fuel_type
             WHERE l.branch_id=? AND l.fuel_type IN ('diesel','unleaded','premium')"
        );
        $levelsStmt->execute([$branch]);
        $levels = $levelsStmt->fetchAll();

        $dailyStmt = $db->prepare(
            "SELECT fuel_type, ABS(SUM(liters_delta)) AS liters
             FROM fuel_inventory_movements
             WHERE branch_id=? AND movement_type='sale_deduction' AND DATE(created_at)=?
             GROUP BY fuel_type"
        );
        $dailyStmt->execute([$branch, $today]);
        $daily = $dailyStmt->fetchAll();

        $weeklyStmt = $db->prepare(
            "SELECT fuel_type, ABS(SUM(liters_delta)) AS liters
             FROM fuel_inventory_movements
             WHERE branch_id=? AND movement_type='sale_deduction' AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY fuel_type"
        );
        $weeklyStmt->execute([$branch, $weekStart, $today]);
        $weekly = $weeklyStmt->fetchAll();

        $fastStmt = $db->prepare(
            "SELECT fuel_type, ABS(SUM(liters_delta)) AS liters
             FROM fuel_inventory_movements
             WHERE branch_id=? AND movement_type='sale_deduction' AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY fuel_type ORDER BY liters DESC LIMIT 1"
        );
        $fastStmt->execute([$branch, $weekStart, $today]);
        $fast = $fastStmt->fetch();

        $alertsStmt = $db->prepare(
            "SELECT * FROM fuel_inventory_alerts WHERE branch_id=? AND status='active' ORDER BY triggered_at DESC"
        );
        $alertsStmt->execute([$branch]);
        $alerts = $alertsStmt->fetchAll();

        jsonSuccess([
            'levels' => $levels,
            'daily_consumption' => $daily,
            'weekly_usage' => $weekly,
            'fast_moving' => $fast ?: null,
            'alerts' => $alerts
        ]);
    }

    case 'reports_daily':
    case 'reports_weekly':
    case 'reports_summary': {
        $branch = allowedBranch($user, $_GET['branch_id'] ?? null);
        $from = $_GET['date_from'] ?? date('Y-m-d', strtotime('-6 days'));
        $to = $_GET['date_to'] ?? date('Y-m-d');

        $stmt = $db->prepare(
            "SELECT DATE(created_at) AS day, fuel_type,
                    SUM(CASE WHEN movement_type='sale_deduction' THEN ABS(liters_delta) ELSE 0 END) AS sold_liters,
                    SUM(CASE WHEN movement_type='refill_addition' THEN liters_delta ELSE 0 END) AS refill_liters,
                    SUM(CASE WHEN movement_type='measurement_set' THEN liters_delta ELSE 0 END) AS measurement_adjustment
             FROM fuel_inventory_movements
             WHERE branch_id=? AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY DATE(created_at), fuel_type
             ORDER BY day DESC"
        );
        $stmt->execute([$branch, $from, $to]);
        $rows = $stmt->fetchAll();
        jsonSuccess($rows);
    }

    default:
        jsonError('Unknown action.', 404);
}
