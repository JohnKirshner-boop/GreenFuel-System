<?php
// backend/routes/shifts.php
// GET  ?action=pending  [&branch_id=]
// GET  ?action=history  [&branch_id=]
// POST ?action=verify   { shift_id, status, remarks }

require_once __DIR__ . '/../config.php';
$user   = requireAuth();
$action = $_GET['action'] ?? 'pending';
$db     = getDB();

function shiftColumnExists(PDO $db, string $column): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute([DB_NAME, 'shift_records', $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function shiftTableColumnExists(PDO $db, string $table, string $column): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute([DB_NAME, $table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function ensureShiftSupport(PDO $db): void {
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
        "CREATE TABLE IF NOT EXISTS shift_sessions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          branch_id VARCHAR(10) NOT NULL,
          cashier_id INT NOT NULL,
          start_time DATETIME NOT NULL,
          end_time DATETIME NULL,
          total_sales DECIMAL(12,2) DEFAULT 0,
          total_liters DECIMAL(10,2) DEFAULT 0,
          total_cash DECIMAL(12,2) DEFAULT 0,
          cashier_note TEXT NULL,
          status ENUM('open','closed','submitted') DEFAULT 'open',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (branch_id) REFERENCES branches(id),
          FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE CASCADE
        )"
    );
    if (!shiftTableColumnExists($db, 'shift_sessions', 'total_cash')) {
        $db->exec('ALTER TABLE shift_sessions ADD COLUMN total_cash DECIMAL(12,2) DEFAULT 0 AFTER total_liters');
    }
    if (!shiftTableColumnExists($db, 'shift_sessions', 'cashier_note')) {
        $db->exec('ALTER TABLE shift_sessions ADD COLUMN cashier_note TEXT NULL AFTER total_cash');
    }
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
    $columns = [
        'shift_session_id' => 'ALTER TABLE shift_records ADD COLUMN shift_session_id INT NULL AFTER shift',
        'start_time'       => 'ALTER TABLE shift_records ADD COLUMN start_time DATETIME NULL AFTER shift_session_id',
        'end_time'         => 'ALTER TABLE shift_records ADD COLUMN end_time DATETIME NULL AFTER start_time',
        'cashier_note'     => 'ALTER TABLE shift_records ADD COLUMN cashier_note TEXT NULL AFTER remarks',
    ];
    foreach ($columns as $column => $sql) {
        if (!shiftColumnExists($db, $column)) $db->exec($sql);
    }
}

function legacyShiftName(string $datetime): string {
    $hour = (int)date('H', strtotime($datetime));
    if ($hour < 12) return 'Morning';
    if ($hour < 18) return 'Afternoon';
    return 'Night';
}

function activeSession(PDO $db, array $user): ?array {
    $stmt = $db->prepare(
        "SELECT s.*, b.name AS branch_name, u.name AS cashier_name
         FROM shift_sessions s
         LEFT JOIN branches b ON b.id=s.branch_id
         LEFT JOIN users u ON u.id=s.cashier_id
         WHERE s.branch_id=? AND s.cashier_id=? AND s.status='open' AND s.end_time IS NULL
         ORDER BY s.start_time DESC LIMIT 1"
    );
    $stmt->execute([$user['branch_id'], $user['id']]);
    $row = $stmt->fetch();
    return $row ?: null;
}

ensureShiftSupport($db);

switch ($action) {

    case 'current': {
        requireRole('cashier', 'manager', 'owner');
        jsonSuccess(activeSession($db, $user));
    }

    case 'start': {
        requireRole('cashier', 'manager', 'owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $bid = $user['branch_id'];
        if (!$bid) jsonError('Branch is required to start a shift.');
        $open = activeSession($db, $user);
        if ($open) jsonSuccess($open, 'Shift already open.');
        $db->prepare(
            "INSERT INTO shift_sessions (branch_id, cashier_id, start_time, status)
             VALUES (?, ?, NOW(), 'open')"
        )->execute([$bid, $user['id']]);
        $id = $db->lastInsertId();
        $stmt = $db->prepare('SELECT * FROM shift_sessions WHERE id=?');
        $stmt->execute([$id]);
        jsonSuccess($stmt->fetch(), 'Shift started.');
    }

    case 'end': {
        requireRole('cashier', 'manager', 'owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $session = activeSession($db, $user);
        if (!$session) jsonError('No open shift to end.');
        $body = getBody();
        $cashBreakdown = is_array($body['cash_breakdown'] ?? null) ? $body['cash_breakdown'] : [];
        $cashierNote = substr(trim((string)($body['cashier_note'] ?? '')), 0, 2000);

        $denoms = $db->query('SELECT id, value FROM cash_denominations WHERE active=1')->fetchAll();
        $denomMap = [];
        foreach ($denoms as $d) $denomMap[(string)(float)$d['value']] = $d;
        $cashRows = [];
        $cashTotal = 0.0;
        foreach ($cashBreakdown as $value => $qty) {
            $qty = max(0, (int)$qty);
            $value = (float)$value;
            if ($qty <= 0) continue;
            $key = (string)$value;
            if (!isset($denomMap[$key])) continue;
            $amount = round($value * $qty, 2);
            $cashTotal += $amount;
            $cashRows[] = [
                'denomination_id' => (int)$denomMap[$key]['id'],
                'value' => $value,
                'quantity' => $qty,
                'amount' => $amount,
            ];
        }

        $stmt = $db->prepare(
            "SELECT COALESCE(SUM(t.total_amount),0) AS sales,
                    COALESCE(SUM(t.liters),0) AS liters
             FROM transactions t
             WHERE t.shift_session_id=? AND t.status!='void'"
        );
        $stmt->execute([$session['id']]);
        $totals = $stmt->fetch();

        $db->beginTransaction();
        try {
            $db->prepare(
                "UPDATE shift_sessions
                 SET end_time=NOW(), total_sales=?, total_liters=?, total_cash=?, cashier_note=?, status='submitted'
                 WHERE id=?"
            )->execute([$totals['sales'], $totals['liters'], $cashTotal, $cashierNote ?: null, $session['id']]);

            $db->prepare('DELETE FROM shift_cash_breakdown WHERE shift_session_id=?')->execute([$session['id']]);
            if ($cashRows) {
                $cashStmt = $db->prepare(
                    'INSERT INTO shift_cash_breakdown
                       (shift_session_id, denomination_id, denomination_value, quantity, amount)
                     VALUES (?,?,?,?,?)'
                );
                foreach ($cashRows as $row) {
                    $cashStmt->execute([
                        $session['id'],
                        $row['denomination_id'],
                        $row['value'],
                        $row['quantity'],
                        $row['amount'],
                    ]);
                }
            }

            $fresh = $db->prepare('SELECT * FROM shift_sessions WHERE id=?');
            $fresh->execute([$session['id']]);
            $closed = $fresh->fetch();
            $shiftName = legacyShiftName($closed['start_time']);
            $sid = 'SHIFTSESSION-'.$session['id'];
            $db->prepare(
                "INSERT INTO shift_records
                   (id, branch_id, date, shift, shift_session_id, start_time, end_time,
                    cashier_id, total_sales, total_liters, cashier_note, status)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?, 'Pending')
                 ON DUPLICATE KEY UPDATE
                   end_time=VALUES(end_time),
                   total_sales=VALUES(total_sales),
                   total_liters=VALUES(total_liters),
                   cashier_note=VALUES(cashier_note),
                   status='Pending'"
            )->execute([
                $sid,
                $session['branch_id'],
                date('Y-m-d', strtotime($closed['start_time'])),
                $shiftName,
                $session['id'],
                $closed['start_time'],
                $closed['end_time'],
                $session['cashier_id'],
                $totals['sales'],
                $totals['liters'],
                $cashierNote ?: null,
            ]);
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }

        jsonSuccess([
            'session' => $closed,
            'shift_record_id' => $sid,
            'cash_total' => round($cashTotal, 2),
        ], 'Shift ended and submitted.');
    }

    case 'pending': {
        requireRole('manager', 'owner');
        $bid   = $user['role'] !== 'owner' ? $user['branch_id'] : ($_GET['branch_id'] ?? null);
        $extra = $bid ? ' AND s.branch_id = ?' : '';
        $params= $bid ? [$bid] : [];
        $stmt  = $db->prepare(
            'SELECT s.*, b.name AS branch_name, u.name AS cashier_name
             FROM shift_records s
             LEFT JOIN branches b ON b.id = s.branch_id
             LEFT JOIN users    u ON u.id = s.cashier_id
             WHERE s.status = \'Pending\''.$extra.'
             ORDER BY COALESCE(s.start_time, s.created_at) DESC, s.date DESC'
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    case 'history': {
        requireRole('manager', 'owner');
        $bid   = $user['role'] !== 'owner' ? $user['branch_id'] : ($_GET['branch_id'] ?? null);
        $extra = $bid ? ' AND s.branch_id = ?' : '';
        $params= $bid ? [$bid] : [];
        $stmt  = $db->prepare(
            'SELECT s.*, b.name AS branch_name, u.name AS cashier_name,
                    v.name AS verifier_name
             FROM shift_records s
             LEFT JOIN branches b ON b.id = s.branch_id
             LEFT JOIN users    u ON u.id = s.cashier_id
             LEFT JOIN users    v ON v.id = s.verified_by
             WHERE s.status != \'Pending\''.$extra.'
             ORDER BY COALESCE(s.verified_at, s.end_time, s.created_at) DESC LIMIT 50'
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    case 'verify': {
        requireRole('manager', 'owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $b        = getBody();
        $shift_id = trim($b['shift_id'] ?? '');
        $status   = trim($b['status']   ?? '');
        $remarks  = trim($b['remarks']  ?? '');
        if (!$shift_id || !in_array($status, ['Verified','Recalibrated','Flagged']))
            jsonError('shift_id and valid status required.');
        $stmt = $db->prepare(
            'UPDATE shift_records
             SET status=?, remarks=?, verified_by=?, verified_at=NOW()
             WHERE id=?'
        );
        $stmt->execute([$status, $remarks ?: null, $user['id'], $shift_id]);
        jsonSuccess(null, 'Shift '.$status.'.');
    }

    // Auto-create today's pending shifts (called by frontend on POS close)
    case 'open': {
        requireRole('cashier', 'manager', 'owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        $b      = getBody();
        $bid    = $b['branch_id'] ?? $user['branch_id'];
        $shift  = $b['shift'] ?? legacyShiftName(date('Y-m-d H:i:s'));
        $today  = date('Y-m-d');
        $sid    = 'SHIFT-'.$today.'-'.strtoupper(substr($shift,0,2)).'-'.$bid;

        // Compute totals from today's transactions
        $stmt = $db->prepare(
            'SELECT COALESCE(SUM(total_amount),0) AS sales,
                    COALESCE(SUM(liters),0) AS liters
             FROM transactions
             WHERE branch_id=? AND DATE(timestamp)=? AND status=\'pending\''
        );
        $stmt->execute([$bid, $today]);
        $totals = $stmt->fetch();

        $db->prepare(
            'INSERT INTO shift_records
               (id, branch_id, date, shift, cashier_id, total_sales, total_liters, status)
             VALUES (?,?,?,?,?,?,?,\'Pending\')
             ON DUPLICATE KEY UPDATE
               cashier_id=VALUES(cashier_id),
               total_sales=VALUES(total_sales),
               total_liters=VALUES(total_liters),
               status=\'Pending\''
        )->execute([$sid, $bid, $today, $shift, $user['id'],
                    $totals['sales'], $totals['liters']]);

        jsonSuccess(['shift_id' => $sid], 'Shift record created.');
    }

    default:
        jsonError('Unknown action.', 404);
}
