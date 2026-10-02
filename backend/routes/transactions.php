<?php
// backend/routes/transactions.php
// GET  ?action=list     [&branch_id=] [&date=YYYY-MM-DD] [&fuel_type=] [&limit=]
// GET  ?action=today    [&branch_id=]
// GET  ?action=recent   [&branch_id=] [&limit=12]
// POST ?action=create   { branch_id, fuel_type, liters, customer }
// POST ?action=verify   { tx_id, status, remarks }

require_once __DIR__ . '/../config.php';
$user   = requireAuth();
$action = $_GET['action'] ?? 'list';
$db     = getDB();

function txColumnExists(PDO $db, string $column): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $stmt->execute([DB_NAME, 'transactions', $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function txTableExists(PDO $db, string $table): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?'
    );
    $stmt->execute([DB_NAME, $table]);
    return (int)$stmt->fetchColumn() > 0;
}

function ensureSystemSettings(PDO $db): void {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS system_settings (
          setting_key VARCHAR(64) PRIMARY KEY,
          setting_value VARCHAR(255) NOT NULL,
          description VARCHAR(255) NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )"
    );
    $stmt = $db->prepare(
        'INSERT INTO system_settings (setting_key, setting_value, description)
         VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE setting_value = setting_value'
    );
    $stmt->execute(['pos_vat_rate', '12', 'VAT rate extracted from VAT-inclusive POS fuel transactions.']);
}

function txConfiguredTaxRate(PDO $db): float {
    ensureSystemSettings($db);
    $stmt = $db->prepare('SELECT setting_value FROM system_settings WHERE setting_key=? LIMIT 1');
    $stmt->execute(['pos_vat_rate']);
    $rate = (float)$stmt->fetchColumn();
    if ($rate < 0 || $rate > 100) $rate = 12;
    return round($rate, 2);
}

function ensureTransactionSupport(PDO $db): void {
    ensureSystemSettings($db);
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
    $columns = [
        'amount_paid'      => 'ALTER TABLE transactions ADD COLUMN amount_paid DECIMAL(12,2) DEFAULT 0 AFTER total_amount',
        'subtotal_amount'  => 'ALTER TABLE transactions ADD COLUMN subtotal_amount DECIMAL(12,2) DEFAULT 0 AFTER amount_paid',
        'tax_rate'         => 'ALTER TABLE transactions ADD COLUMN tax_rate DECIMAL(6,2) DEFAULT 0 AFTER subtotal_amount',
        'tax_amount'       => 'ALTER TABLE transactions ADD COLUMN tax_amount DECIMAL(12,2) DEFAULT 0 AFTER tax_rate',
        'cash_received'    => 'ALTER TABLE transactions ADD COLUMN cash_received DECIMAL(12,2) DEFAULT 0 AFTER amount_paid',
        'change_amount'    => 'ALTER TABLE transactions ADD COLUMN change_amount DECIMAL(12,2) DEFAULT 0 AFTER cash_received',
        'shift_session_id' => 'ALTER TABLE transactions ADD COLUMN shift_session_id INT NULL AFTER cashier_id',
        'void_reason'      => 'ALTER TABLE transactions ADD COLUMN void_reason TEXT NULL AFTER status',
        'voided_by'        => 'ALTER TABLE transactions ADD COLUMN voided_by INT NULL AFTER void_reason',
        'voided_at'        => 'ALTER TABLE transactions ADD COLUMN voided_at DATETIME NULL AFTER voided_by',
    ];
    foreach ($columns as $column => $sql) {
        if (!txColumnExists($db, $column)) $db->exec($sql);
    }
    try {
        $db->exec('ALTER TABLE transactions MODIFY liters DECIMAL(10,4) NOT NULL');
    } catch (PDOException $e) {
        // Older or locked local schemas may keep the previous precision.
    }
    try {
        $db->exec("ALTER TABLE transactions MODIFY status ENUM('pending','verified','flagged','recalibrated','void') DEFAULT 'pending'");
    } catch (PDOException $e) {
        // Some MySQL installs may already have a compatible definition.
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
        "CREATE TABLE IF NOT EXISTS void_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          transaction_id VARCHAR(20) NOT NULL,
          reason TEXT NOT NULL,
          voided_by INT NULL,
          voided_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (transaction_id) REFERENCES transactions(id),
          FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
        )"
    );
    if (!txTableExists($db, 'shift_sessions')) {
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
    }
}

function activeShiftSessionId(PDO $db, array $user, string $branchId): ?int {
    $stmt = $db->prepare(
        "SELECT id FROM shift_sessions
         WHERE branch_id=? AND cashier_id=? AND status='open' AND end_time IS NULL
         ORDER BY start_time DESC LIMIT 1"
    );
    $stmt->execute([$branchId, $user['id']]);
    $id = $stmt->fetchColumn();
    return $id ? (int)$id : null;
}

function nextTransactionId(PDO $db): string {
    $prefix = 'TX-'.date('Ymd').'-';
    $stmt = $db->prepare(
        'SELECT id FROM transactions
         WHERE id LIKE ?
         ORDER BY id DESC
         LIMIT 1'
    );
    $stmt->execute([$prefix.'%']);
    $last = $stmt->fetchColumn();
    $next = 1;
    if ($last && preg_match('/^'.preg_quote($prefix, '/').'(\d+)$/', $last, $m)) {
        $next = ((int)$m[1]) + 1;
    }
    return $prefix.str_pad((string)$next, 4, '0', STR_PAD_LEFT);
}

ensureTransactionSupport($db);

switch ($action) {

    case 'denominations': {
        $rows = $db->query(
            'SELECT id, value, label, sort_order
             FROM cash_denominations
             WHERE active=1
             ORDER BY sort_order, value DESC'
        )->fetchAll();
        jsonSuccess($rows);
    }

    case 'list': {
        $bid = ($user['role'] === 'owner')
            ? (!empty($_GET['branch_id']) ? requireBranchAccess($db, $user, $_GET['branch_id']) : null)
            : activeBranchId($db, $user, $_GET['branch_id'] ?? ($user['branch_id'] ?? null));
        $where = ['1=1']; $params = [];
        if ($bid)                  { $where[] = 't.branch_id = ?';      $params[] = $bid; }
        if (!empty($_GET['date'])) { $where[] = 'DATE(t.timestamp) = ?'; $params[] = $_GET['date']; }
        if (!empty($_GET['fuel_type'])) { $where[] = 't.fuel_type = ?'; $params[] = $_GET['fuel_type']; }
        if (!empty($_GET['status']))    { $where[] = 't.status = ?';    $params[] = $_GET['status']; }
        $limit    = min((int)($_GET['limit'] ?? 200), 1000);
        $offset   = (int)($_GET['offset'] ?? 0);
        $params[] = $limit; $params[] = $offset;
        $stmt = $db->prepare(
            'SELECT t.*, f.name AS fuel_name, f.color AS fuel_color,
                    b.name AS branch_name, u.name AS cashier_name,
                    vu.name AS voided_by_name,
                    COALESCE(chg.change_recorded,0) AS change_recorded
             FROM transactions t
             LEFT JOIN fuel_types f ON f.id = t.fuel_type
             LEFT JOIN branches   b ON b.id = t.branch_id
             LEFT JOIN users      u ON u.id = t.cashier_id
             LEFT JOIN users      vu ON vu.id = t.voided_by
             LEFT JOIN (
               SELECT transaction_id, SUM(amount) AS change_recorded
               FROM transaction_change_breakdown
               GROUP BY transaction_id
             ) chg ON chg.transaction_id = t.id
             WHERE '.implode(' AND ', $where).'
             ORDER BY t.timestamp DESC LIMIT ? OFFSET ?'
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    case 'today': {
        $bid    = ($user['role'] === 'owner')
            ? (!empty($_GET['branch_id']) ? requireBranchAccess($db, $user, $_GET['branch_id']) : null)
            : activeBranchId($db, $user, $_GET['branch_id'] ?? ($user['branch_id'] ?? null));
        $params = [date('Y-m-d')];
        $extra  = '';
        if ($bid) { $extra = ' AND t.branch_id = ?'; $params[] = $bid; }
        $stmt = $db->prepare(
            'SELECT t.*, f.name AS fuel_name, f.color AS fuel_color, b.name AS branch_name,
                    COALESCE(chg.change_recorded,0) AS change_recorded
             FROM transactions t
             LEFT JOIN fuel_types f ON f.id = t.fuel_type
             LEFT JOIN branches   b ON b.id = t.branch_id
             LEFT JOIN (
               SELECT transaction_id, SUM(amount) AS change_recorded
               FROM transaction_change_breakdown
               GROUP BY transaction_id
             ) chg ON chg.transaction_id = t.id
             WHERE DATE(t.timestamp) = ? AND t.status != \'void\''.$extra.'
             ORDER BY t.timestamp DESC'
        );
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $summary = [
            'count'        => count($rows),
            'total_amount' => array_sum(array_column($rows, 'total_amount')),
            'total_tax'    => array_sum(array_column($rows, 'tax_amount')),
            'total_liters' => array_sum(array_column($rows, 'liters')),
        ];
        jsonSuccess(['transactions' => $rows, 'summary' => $summary]);
    }

    case 'recent': {
        $bid    = ($user['role'] === 'owner')
            ? (!empty($_GET['branch_id']) ? requireBranchAccess($db, $user, $_GET['branch_id']) : null)
            : activeBranchId($db, $user, $_GET['branch_id'] ?? ($user['branch_id'] ?? null));
        $limit  = min((int)($_GET['limit'] ?? 12), 50);
        $params = [];
        $whereParts = [];
        if ($bid) {
            $whereParts[] = 't.branch_id = ?';
            $params[] = $bid;
        }
        $shiftSessionId = (int)($_GET['shift_session_id'] ?? 0);
        if ($shiftSessionId > 0) {
            $whereParts[] = 't.shift_session_id = ?';
            $params[] = $shiftSessionId;
        }
        $where = $whereParts ? 'WHERE '.implode(' AND ', $whereParts) : '';
        $params[] = $limit;
        $stmt = $db->prepare(
            'SELECT t.*, f.name AS fuel_name, f.color AS fuel_color,
                    COALESCE(chg.change_recorded,0) AS change_recorded
             FROM transactions t
             LEFT JOIN fuel_types f ON f.id = t.fuel_type
             LEFT JOIN (
               SELECT transaction_id, SUM(amount) AS change_recorded
               FROM transaction_change_breakdown
               GROUP BY transaction_id
             ) chg ON chg.transaction_id = t.id
             '.$where.' ORDER BY t.timestamp DESC LIMIT ?'
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    case 'create': {
        requireRole('cashier');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b         = getBody();
        $branch_id = activeBranchId($db, $user, $b['branch_id'] ?? ($user['branch_id'] ?? null));
        $fuel_type = trim($b['fuel_type'] ?? '');
        $amountPaid= (float)($b['amount_paid'] ?? 0);
        $amountProvided = is_numeric($b['amount_paid'] ?? null) && $amountPaid > 0;
        $taxRate   = is_numeric($b['tax_rate'] ?? null)
            ? round((float)$b['tax_rate'], 2)
            : txConfiguredTaxRate($db);
        $rawLiters = $b['liters'] ?? null;
        $liters    = is_numeric($rawLiters) ? (float)$rawLiters : 0;
        $customer  = trim($b['customer'] ?? 'Walk-in');
        $breakdown = is_array($b['cash_breakdown'] ?? null) ? $b['cash_breakdown'] : [];
        $changeBreakdown = is_array($b['change_breakdown'] ?? null) ? $b['change_breakdown'] : [];
        $cashPayloadProvided = array_key_exists('cash_received', $b) || !empty($breakdown) || !empty($changeBreakdown);

        if (!$fuel_type)  jsonError('fuel_type is required.');
        if (($rawLiters === null || trim((string)$rawLiters) === '') && !$amountProvided) {
            jsonError('Liters or amount paid is required.');
        }
        if ($liters <= 0 && !$amountProvided) jsonError('Liters must be greater than zero.');
        if ($amountPaid < 0) jsonError('Negative amount values are not allowed.');
        if ($taxRate < 0 || $taxRate > 100) jsonError('VAT rate must be between 0 and 100 percent.');
        if (!activeShiftSessionId($db, $user, $branch_id)) jsonError('Start a shift before processing sales.');

        // Fetch the approved branch price. If the branch has no approved override,
        // use the owner-managed official base price.
        $fStmt = $db->prepare(
            'SELECT COALESCE(bp.price, f.price) AS price
             FROM fuel_types f
             LEFT JOIN fuel_branch_prices bp
               ON bp.fuel_type = f.id AND bp.branch_id = ?
             WHERE f.id = ?
             LIMIT 1'
        );
        $fStmt->execute([$branch_id, $fuel_type]);
        $fuel = $fStmt->fetch();
        if (!$fuel) jsonError('Invalid fuel type.');

        $price = (float)$fuel['price'];
        if ($price <= 0) jsonError('Fuel price is not configured.');
        if ($liters > 0) {
            $liters = round($liters, 4);
            $total = round($liters * $price, 2);
        } elseif ($amountProvided) {
            $total = round($amountPaid, 2);
            $liters = round($total / $price, 4);
        } else {
            jsonError('Liters must be greater than zero.');
        }
        $subtotal = round($total / (1 + ($taxRate / 100)), 2);
        $taxAmount = round($total - $subtotal, 2);
        $amountPaid = $total;

        $denoms = $db->query('SELECT id, value FROM cash_denominations WHERE active=1')->fetchAll();
        $denomMap = [];
        foreach ($denoms as $d) $denomMap[(string)(float)$d['value']] = $d;
        $breakdownTotal = 0;
        foreach ($breakdown as $value => $qty) {
            $breakdownTotal += ((float)$value) * max(0, (int)$qty);
        }
        $changeBreakdownTotal = 0;
        foreach ($changeBreakdown as $value => $qty) {
            $changeBreakdownTotal += ((float)$value) * max(0, (int)$qty);
        }
        $cashReceived = (float)($b['cash_received'] ?? 0);
        if ($cashReceived < 0) jsonError('Negative cash values are not allowed.');
        if ($cashReceived <= 0) $cashReceived = $breakdownTotal;
        $change = $cashPayloadProvided ? round(max(0, $cashReceived - $total), 2) : 0.0;
        if ($cashPayloadProvided && $cashReceived < $total) jsonError('Cash received is less than amount paid.');
        if ($cashPayloadProvided && $changeBreakdownTotal - $change > 0.01) {
            jsonError('Change given denominations are greater than the computed change.');
        }

        $shiftSessionId = activeShiftSessionId($db, $user, $branch_id);
        $db->beginTransaction();
        try {
            $stmt = $db->prepare(
                'INSERT INTO transactions
                   (id, branch_id, fuel_type, liters, price_per_liter, total_amount,
                    amount_paid, subtotal_amount, tax_rate, tax_amount,
                    cash_received, change_amount, customer, cashier_id,
                    shift_session_id, status, timestamp)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,\'pending\',NOW())'
            );
            for ($attempt = 0; $attempt < 5; $attempt++) {
                $tx_id = nextTransactionId($db);
                try {
                    $stmt->execute([$tx_id, $branch_id, $fuel_type, $liters, $price, $total,
                                    $amountPaid, $subtotal, $taxRate, $taxAmount,
                                    $cashReceived, $change, substr($customer,0,100),
                                    $user['id'], $shiftSessionId]);
                    break;
                } catch (PDOException $e) {
                    if ($attempt === 4 || $e->getCode() !== '23000') throw $e;
                    usleep(20000);
                }
            }

            if ($breakdown) {
                $cashStmt = $db->prepare(
                    'INSERT INTO transaction_cash_breakdown
                       (transaction_id, denomination_id, denomination_value, quantity, amount)
                     VALUES (?,?,?,?,?)'
                );
                foreach ($breakdown as $value => $qty) {
                    $qty = max(0, (int)$qty);
                    $value = (float)$value;
                    if ($qty <= 0) continue;
                    $key = (string)$value;
                    if (!isset($denomMap[$key])) continue;
                    $cashStmt->execute([$tx_id, $denomMap[$key]['id'], $value, $qty, $value * $qty]);
                }
            }
            if ($changeBreakdown) {
                $changeStmt = $db->prepare(
                    'INSERT INTO transaction_change_breakdown
                       (transaction_id, denomination_id, denomination_value, quantity, amount)
                     VALUES (?,?,?,?,?)'
                );
                foreach ($changeBreakdown as $value => $qty) {
                    $qty = max(0, (int)$qty);
                    $value = (float)$value;
                    if ($qty <= 0) continue;
                    $key = (string)$value;
                    if (!isset($denomMap[$key])) continue;
                    $changeStmt->execute([$tx_id, $denomMap[$key]['id'], $value, $qty, $value * $qty]);
                }
            }
            $db->commit();
            auditLog($db, $user, 'transaction_create', 'transaction', $tx_id, [
                'branch_id' => $branch_id,
                'fuel_type' => $fuel_type,
                'total_amount' => $total,
            ]);
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }

        jsonSuccess([
            'id'              => $tx_id,
            'total_amount'    => $total,
            'amount_paid'     => $amountPaid,
            'subtotal_amount' => $subtotal,
            'tax_rate'        => $taxRate,
            'tax_amount'      => $taxAmount,
            'cash_received'   => $cashReceived,
            'change_amount'   => $change,
            'change_recorded' => round($changeBreakdownTotal, 2),
            'price_per_liter' => $price,
            'liters'          => $liters,
            'shift_session_id' => $shiftSessionId,
        ], 'Transaction saved.');
    }

    case 'void': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b      = getBody();
        $tx_id  = trim($b['tx_id'] ?? '');
        $reason = trim($b['reason'] ?? '');
        if (!$tx_id) jsonError('tx_id is required.');
        if (!$reason) jsonError('Void reason is required.');

        $stmt = $db->prepare('SELECT * FROM transactions WHERE id=? LIMIT 1');
        $stmt->execute([$tx_id]);
        $tx = $stmt->fetch();
        if (!$tx) jsonError('Transaction not found.', 404);
        if (!canAccessBranch($db, $user, $tx['branch_id'])) jsonError('Access denied.', 403);
        if ($tx['status'] === 'void') jsonError('Transaction is already void.');

        $db->prepare(
            "UPDATE transactions
             SET status='void', void_reason=?, voided_by=?, voided_at=NOW()
             WHERE id=?"
        )->execute([$reason, $user['id'], $tx_id]);
        $db->prepare(
            'INSERT INTO void_logs (transaction_id, reason, voided_by, voided_at)
             VALUES (?,?,?,NOW())'
        )->execute([$tx_id, $reason, $user['id']]);
        auditLog($db, $user, 'transaction_void', 'transaction', $tx_id, ['reason' => substr($reason, 0, 500)]);
        jsonSuccess(null, 'Transaction voided.');
    }

    case 'verify': {
        requireRole('manager', 'owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b      = getBody();
        $tx_id  = trim($b['tx_id'] ?? '');
        $status = trim($b['status'] ?? '');
        if (!$tx_id || !in_array($status, ['verified'], true))
            jsonError('tx_id and valid status required.');
        $check = $db->prepare('SELECT branch_id FROM transactions WHERE id=? LIMIT 1');
        $check->execute([$tx_id]);
        $branchId = $check->fetchColumn();
        if (!$branchId) jsonError('Transaction not found.', 404);
        if (!canAccessBranch($db, $user, (string)$branchId)) jsonError('Access denied.', 403);
        $stmt = $db->prepare('UPDATE transactions SET status=? WHERE id=?');
        $stmt->execute([$status, $tx_id]);
        auditLog($db, $user, 'transaction_verify', 'transaction', $tx_id, ['status' => $status]);
        jsonSuccess(null, 'Transaction '.$status.'.');
    }

    default:
        jsonError('Unknown action.', 404);
}
