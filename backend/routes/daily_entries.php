<?php
// backend/routes/daily_entries.php
// GET  ?action=list [&branch_id=&date=]
// POST ?action=save { branch_id, entry_date, shift, payload, totals... }

require_once __DIR__ . '/../config.php';
requireRole('manager', 'owner');
$action = $_GET['action'] ?? 'list';
$db     = getDB();
$user   = currentUser();

function ensureDailyEntriesTable(PDO $db): void {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS daily_entries (
          id                   INT           AUTO_INCREMENT PRIMARY KEY,
          branch_id             VARCHAR(10)   NOT NULL,
          entry_date            DATE          NOT NULL,
          shift                 VARCHAR(30)   NOT NULL,
          time_in               TIME          NULL,
          time_out              TIME          NULL,
          duty_personnel        VARCHAR(100)  NULL,
          total_cash_expected   DECIMAL(12,2) DEFAULT 0,
          total_expenses        DECIMAL(12,2) DEFAULT 0,
          actual_cash_remitted  DECIMAL(12,2) DEFAULT 0,
          cash_payment          DECIMAL(12,2) DEFAULT 0,
          over_short            DECIMAL(12,2) DEFAULT 0,
          payload_json          JSON          NOT NULL,
          submitted_by          INT           NULL,
          submitted_at          DATETIME      DEFAULT CURRENT_TIMESTAMP,
          status                ENUM('submitted','reviewed') DEFAULT 'submitted',
          FOREIGN KEY (branch_id)    REFERENCES branches(id),
          FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
        )"
    );
}

function dailyColumnExists(PDO $db, string $table, string $column): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute([DB_NAME, $table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function ensureDailyCashSupport(PDO $db): void {
    if (!dailyColumnExists($db, 'transactions', 'cash_received')) {
        $db->exec('ALTER TABLE transactions ADD COLUMN cash_received DECIMAL(12,2) DEFAULT 0 AFTER total_amount');
    }
    if (!dailyColumnExists($db, 'transactions', 'change_amount')) {
        $db->exec('ALTER TABLE transactions ADD COLUMN change_amount DECIMAL(12,2) DEFAULT 0 AFTER cash_received');
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS cash_denominations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          value DECIMAL(8,2) NOT NULL UNIQUE,
          label VARCHAR(20) NOT NULL,
          sort_order INT NOT NULL DEFAULT 0,
          active TINYINT(1) NOT NULL DEFAULT 1
        )"
    );
    $denoms = [
        [1000, 'P1000', 1], [500, 'P500', 2], [200, 'P200', 3],
        [100, 'P100', 4], [50, 'P50', 5], [20, 'P20', 6],
        [10, 'P10', 7], [5, 'P5', 8], [1, 'P1', 9],
    ];
    $ins = $db->prepare('INSERT IGNORE INTO cash_denominations (value,label,sort_order) VALUES (?,?,?)');
    foreach ($denoms as $d) $ins->execute($d);
    $db->exec(
        "CREATE TABLE IF NOT EXISTS transaction_cash_breakdown (
          id INT AUTO_INCREMENT PRIMARY KEY,
          transaction_id VARCHAR(20) NOT NULL,
          denomination_id INT NOT NULL,
          denomination_value DECIMAL(8,2) NOT NULL,
          quantity INT NOT NULL DEFAULT 0,
          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
          FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS transaction_change_breakdown (
          id INT AUTO_INCREMENT PRIMARY KEY,
          transaction_id VARCHAR(20) NOT NULL,
          denomination_id INT NOT NULL,
          denomination_value DECIMAL(8,2) NOT NULL,
          quantity INT NOT NULL DEFAULT 0,
          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
          FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS shift_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          cashier_id INT NOT NULL,
          start_time DATETIME NOT NULL,
          end_time DATETIME NULL,
          total_sales DECIMAL(12,2) DEFAULT 0,
          total_liters DECIMAL(10,2) DEFAULT 0,
          total_cash DECIMAL(12,2) DEFAULT 0,
          status ENUM('open','closed','submitted') DEFAULT 'open',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (branch_id) REFERENCES branches(id),
          FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE CASCADE
        )"
    );
    if (!dailyColumnExists($db, 'shift_sessions', 'cashier_note')) {
        $db->exec('ALTER TABLE shift_sessions ADD COLUMN cashier_note TEXT NULL AFTER total_cash');
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS shift_cash_breakdown (
          id INT AUTO_INCREMENT PRIMARY KEY,
          shift_session_id INT NOT NULL,
          denomination_id INT NOT NULL,
          denomination_value DECIMAL(8,2) NOT NULL,
          quantity INT NOT NULL DEFAULT 0,
          amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_shift_cash_breakdown (shift_session_id, denomination_id),
          FOREIGN KEY (shift_session_id) REFERENCES shift_sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
        )"
    );
}

function ensureDailyInventoryForecastSupport(PDO $db): void {
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

    $rows = $db->query(
        "SELECT b.id AS branch_id, f.id AS fuel_type, f.name AS fuel_name
         FROM branches b
         CROSS JOIN fuel_types f"
    )->fetchAll();
    $profile = $db->prepare(
        "INSERT IGNORE INTO fuel_calibration_profiles
         (branch_id, fuel_type, tank_name, tank_capacity_liters, liters_per_cm, critical_liters, max_height_cm)
         VALUES (?,?,?,?,?,?,?)"
    );
    foreach ($rows as $row) {
        $profile->execute([$row['branch_id'], $row['fuel_type'], $row['fuel_name'].' Tank', 10000, 100, 1000, 100]);
    }
}

function dailyInventoryTankFuelMap(): array {
    return [
        'diesel_7kl' => 'diesel',
        'diesel_10kl' => 'e10',
        'unleaded_7_5kl' => 'unleaded',
        'premium_10kl' => 'premium',
    ];
}

function syncDailyEntryInventoryStock(PDO $db, string $branchId, array $payload, ?int $userId, int $entryId): void {
    ensureDailyInventoryForecastSupport($db);
    $readLevel = $db->prepare(
        "SELECT current_liters
         FROM fuel_inventory_levels
         WHERE branch_id=? AND fuel_type=?
         LIMIT 1"
    );
    $upsert = $db->prepare(
        "INSERT INTO fuel_inventory_levels
           (branch_id, fuel_type, current_liters, last_measurement_cm, last_measured_at)
         VALUES (?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE
           current_liters=VALUES(current_liters),
           last_measurement_cm=VALUES(last_measurement_cm),
           last_measured_at=VALUES(last_measured_at)"
    );
    $movement = $db->prepare(
        "INSERT INTO fuel_inventory_movements
           (branch_id, fuel_type, movement_type, liters_delta, liters_before, liters_after,
            reference_type, reference_id, notes, encoded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)"
    );

    foreach (dailyInventoryTankFuelMap() as $tankKey => $fuelType) {
        $endingKey = "inv__{$tankKey}__ending__l";
        if (!array_key_exists($endingKey, $payload)) continue;

        $endingLiters = (float)($payload[$endingKey] ?? 0);
        $endingCmKey = "inv__{$tankKey}__ending__cm";
        $endingCm = array_key_exists($endingCmKey, $payload) ? (float)$payload[$endingCmKey] : null;

        $readLevel->execute([$branchId, $fuelType]);
        $before = (float)($readLevel->fetchColumn() ?: 0);
        $upsert->execute([$branchId, $fuelType, $endingLiters, $endingCm]);

        if (abs($endingLiters - $before) > 0.009) {
            $movement->execute([
                $branchId,
                $fuelType,
                'measurement_set',
                round($endingLiters - $before, 2),
                round($before, 2),
                round($endingLiters, 2),
                'daily_entry',
                (string)$entryId,
                'Daily Entry inventory ending stock',
                $userId,
            ]);
        }
    }
}

ensureDailyEntriesTable($db);
ensureDailyCashSupport($db);
ensureDailyInventoryForecastSupport($db);

switch ($action) {

    case 'cash_summary': {
        $bid = $user['role'] !== 'owner' ? $user['branch_id'] : ($_GET['branch_id'] ?? null);
        if (!$bid) jsonError('branch_id is required.');
        $date = $_GET['date'] ?? date('Y-m-d');

        $stmt = $db->prepare(
            "SELECT d.id, d.value, d.label,
                    COALESCE(counted.quantity,0) AS cash_quantity,
                    COALESCE(counted.amount,0) AS cash_amount,
                    0 AS change_quantity,
                    0 AS change_amount,
                    COALESCE(counted.quantity,0) AS quantity,
                    COALESCE(counted.amount,0) AS amount
             FROM cash_denominations d
             LEFT JOIN (
               SELECT cb.denomination_id,
                      SUM(cb.quantity) AS quantity,
                      SUM(cb.amount) AS amount
               FROM shift_cash_breakdown cb
               INNER JOIN shift_sessions s ON s.id = cb.shift_session_id
               WHERE s.branch_id = ?
                 AND DATE(COALESCE(s.end_time, s.start_time)) = ?
                 AND s.status != 'open'
               GROUP BY cb.denomination_id
             ) counted ON counted.denomination_id = d.id
             WHERE d.active = 1
             ORDER BY d.sort_order, d.value DESC"
        );
        $stmt->execute([$bid, $date]);
        $denoms = $stmt->fetchAll();

        $totalsStmt = $db->prepare(
            "SELECT COUNT(*) AS tx_count,
                    COALESCE(SUM(total_amount),0) AS transaction_total,
                    COALESCE(SUM(liters),0) AS total_liters,
                    COALESCE(SUM(cash_received),0) AS cash_received,
                    COALESCE(SUM(change_amount),0) AS change_total
             FROM transactions
             WHERE branch_id=? AND DATE(timestamp)=? AND status!='void'"
        );
        $totalsStmt->execute([$bid, $date]);
        $totals = $totalsStmt->fetch();
        $cashFromDenoms = array_reduce($denoms, fn($sum, $d) => $sum + (float)$d['amount'], 0.0);
        $cashInFromDenoms = $cashFromDenoms;
        $changeFromDenoms = 0.0;
        $cashReceivedTotal = (float)$totals['cash_received'];
        $changeTotal = 0.0;
        $expected = (float)$totals['transaction_total'];
        $actual = $cashFromDenoms;

        $notesStmt = $db->prepare(
            "SELECT s.id,
                    s.start_time,
                    s.end_time,
                    s.total_sales,
                    s.total_cash,
                    s.cashier_note,
                    u.name AS cashier_name
             FROM shift_sessions s
             LEFT JOIN users u ON u.id = s.cashier_id
             WHERE s.branch_id = ?
               AND DATE(COALESCE(s.end_time, s.start_time)) = ?
               AND s.status != 'open'
               AND s.cashier_note IS NOT NULL
               AND TRIM(s.cashier_note) != ''
             ORDER BY COALESCE(s.end_time, s.start_time) ASC"
        );
        $notesStmt->execute([$bid, $date]);

        jsonSuccess([
            'date' => $date,
            'branch_id' => $bid,
            'denominations' => $denoms,
            'shift_notes' => $notesStmt->fetchAll(),
            'totals' => [
                'tx_count' => (int)$totals['tx_count'],
                'transaction_total' => round($expected, 2),
                'total_liters' => round((float)$totals['total_liters'], 2),
                'cash_received' => round($cashReceivedTotal, 2),
                'cash_breakdown_total' => round($cashInFromDenoms, 2),
                'denomination_cash' => round($cashFromDenoms, 2),
                'change_total' => round($changeTotal, 2),
                'change_breakdown_total' => round($changeFromDenoms, 2),
                'expected_cash' => round($expected, 2),
                'actual_remitted_cash' => round($actual, 2),
                'over_short' => round($actual - $expected, 2),
            ],
        ]);
    }

    case 'list': {
        $bid = $user['role'] !== 'owner' ? $user['branch_id'] : ($_GET['branch_id'] ?? null);
        $params = [];
        $where = [];
        if ($bid) {
            $where[] = 'd.branch_id = ?';
            $params[] = $bid;
        }
        if (!empty($_GET['date'])) {
            $where[] = 'd.entry_date = ?';
            $params[] = $_GET['date'];
        }
        if (!empty($_GET['date_from'])) {
            $where[] = 'd.entry_date >= ?';
            $params[] = $_GET['date_from'];
        }
        if (!empty($_GET['date_to'])) {
            $where[] = 'd.entry_date <= ?';
            $params[] = $_GET['date_to'];
        }
        $sqlWhere = $where ? 'WHERE '.implode(' AND ', $where) : '';
        $stmt = $db->prepare(
            "SELECT d.*, b.name AS branch_name, b.location AS branch_location,
                    u.name AS submitted_by_name
             FROM daily_entries d
             LEFT JOIN branches b ON b.id = d.branch_id
             LEFT JOIN users u ON u.id = d.submitted_by
             $sqlWhere
             ORDER BY d.entry_date DESC, d.submitted_at DESC
             LIMIT 100"
        );
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            $row['payload'] = json_decode($row['payload_json'], true) ?: [];
            unset($row['payload_json']);
        }
        jsonSuccess($rows);
    }

    case 'save': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        if ($user['role'] !== 'manager') jsonError('Only managers can submit daily entries.', 403);
        $b = getBody();
        $bid = $user['branch_id'];
        $entryDate = trim($b['entry_date'] ?? '');
        $shift = trim($b['shift'] ?? '');
        if (!$entryDate || !$shift) jsonError('Entry date and shift are required.');

        $payload = $b['payload'] ?? [];
        if (!is_array($payload)) $payload = [];

        $entryId = (int)($b['id'] ?? $b['entry_id'] ?? 0);
        $values = [
            $entryDate,
            $shift,
            $b['time_in'] ?: null,
            $b['time_out'] ?: null,
            trim($b['duty_personnel'] ?? '') ?: null,
            (float)($b['total_cash_expected'] ?? 0),
            (float)($b['total_expenses'] ?? 0),
            (float)($b['actual_cash_remitted'] ?? 0),
            (float)($b['cash_payment'] ?? 0),
            (float)($b['over_short'] ?? 0),
            json_encode($payload, JSON_UNESCAPED_UNICODE),
            $user['id'],
        ];

        if ($entryId > 0) {
            $check = $db->prepare('SELECT id, branch_id FROM daily_entries WHERE id=? LIMIT 1');
            $check->execute([$entryId]);
            $existing = $check->fetch();
            if (!$existing) jsonError('Daily entry not found.', 404);
            if ($existing['branch_id'] !== $bid) jsonError('Access denied for this daily entry.', 403);

            $stmt = $db->prepare(
                "UPDATE daily_entries
                 SET entry_date=?, shift=?, time_in=?, time_out=?, duty_personnel=?,
                     total_cash_expected=?, total_expenses=?, actual_cash_remitted=?,
                     cash_payment=?, over_short=?, payload_json=?, submitted_by=?,
                     submitted_at=NOW(), status='submitted'
                 WHERE id=?"
            );
            $stmt->execute([...$values, $entryId]);
            syncDailyEntryInventoryStock($db, $bid, $payload, (int)$user['id'], $entryId);
            jsonSuccess(['id' => $entryId], 'Daily entry updated.');
        }

        $stmt = $db->prepare(
            "INSERT INTO daily_entries
              (branch_id, entry_date, shift, time_in, time_out, duty_personnel,
               total_cash_expected, total_expenses, actual_cash_remitted,
               cash_payment, over_short, payload_json, submitted_by, submitted_at, status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),'submitted')"
        );
        $stmt->execute([
            $bid,
            ...$values,
        ]);

        $newId = (int)$db->lastInsertId();
        syncDailyEntryInventoryStock($db, $bid, $payload, (int)$user['id'], $newId);

        jsonSuccess(['id' => $newId], 'Daily entry submitted.');
    }

    default:
        jsonError('Unknown action.', 404);
}
