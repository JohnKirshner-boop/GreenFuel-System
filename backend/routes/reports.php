<?php
// backend/routes/reports.php
// GET  ?action=weekly  [&branch_id=]
// POST ?action=submit  { branch_id, week_start, week_end }
// GET  ?action=list    [&branch_id=]

require_once __DIR__ . '/../config.php';
requireRole('manager', 'owner');
$action = $_GET['action'] ?? 'weekly';
$db     = getDB();
$user   = currentUser();

function reportFuelMeta(PDO $db): array {
    $rows = $db->query('SELECT id, name, color FROM fuel_types ORDER BY name')->fetchAll();
    $map = [];
    foreach ($rows as $row) {
        $map[$row['id']] = $row;
    }
    return $map;
}

function reportNumber(array $payload, string $key): float {
    return isset($payload[$key]) ? (float)$payload[$key] : 0.0;
}

function normalizeReportRange(string $weekStart, string $weekEnd): array {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $weekStart) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $weekEnd)) {
        jsonError('Invalid report date range.');
    }
    if ($weekEnd < $weekStart) {
        jsonError('Week end must be on or after week start.');
    }
    return [$weekStart, $weekEnd];
}

function weeklyFromDailyEntries(PDO $db, ?string $bid, string $weekStart, string $weekEnd): ?array {
    if (!$bid) return null;

    try {
        $stmt = $db->prepare(
            "SELECT *
             FROM daily_entries
             WHERE branch_id = ? AND entry_date BETWEEN ? AND ?
             ORDER BY entry_date"
        );
        $stmt->execute([$bid, $weekStart, $weekEnd]);
        $entries = $stmt->fetchAll();
    } catch (PDOException $e) {
        return null;
    }
    if (!$entries) return null;

    $fuelMeta = reportFuelMeta($db);
    $fuelTotals = [];
    foreach ($fuelMeta as $id => $fuel) {
        $fuelTotals[$id] = [
            'id' => $id,
            'name' => $fuel['name'],
            'color' => $fuel['color'],
            'liters' => 0,
            'revenue' => 0,
        ];
    }

    $sales = 0.0;
    $expenses = 0.0;
    $liters = 0.0;
    $daily = [];
    $expenseSummary = [];

    foreach ($entries as $entry) {
        $payload = json_decode($entry['payload_json'] ?? '{}', true);
        if (!is_array($payload)) $payload = [];

        $entryLiters = 0.0;
        for ($pump = 1; $pump <= 4; $pump++) {
            $fuelId = $payload["digital__pump{$pump}__product"] ?? '';
            $pumpLiters = reportNumber($payload, "digital__pump{$pump}__consumed");
            $pumpAmount = reportNumber($payload, "digital__pump{$pump}__amount");
            $entryLiters += $pumpLiters;

            if ($fuelId) {
                if (!isset($fuelTotals[$fuelId])) {
                    $fuelTotals[$fuelId] = [
                        'id' => $fuelId,
                        'name' => $fuelMeta[$fuelId]['name'] ?? ucfirst($fuelId),
                        'color' => $fuelMeta[$fuelId]['color'] ?? '#16a34a',
                        'liters' => 0,
                        'revenue' => 0,
                    ];
                }
                $fuelTotals[$fuelId]['liters'] += $pumpLiters;
                $fuelTotals[$fuelId]['revenue'] += $pumpAmount;
            }
        }

        $entrySales = (float)$entry['total_cash_expected'];
        $entryExpenses = (float)$entry['total_expenses'];
        $sales += $entrySales;
        $expenses += $entryExpenses;
        $liters += $entryLiters;

        for ($i = 0; $i < 8; $i++) {
            $description = trim((string)($payload["expense__{$i}__description"] ?? ''));
            $expenseLiters = reportNumber($payload, "expense__{$i}__liters");
            $expenseAmount = reportNumber($payload, "expense__{$i}__amount");
            if ($description === '' && $expenseLiters == 0.0 && $expenseAmount == 0.0) {
                continue;
            }
            if ($description === '') {
                $description = 'Unlabeled Expense';
            }
            $key = strtolower($description);
            if (!isset($expenseSummary[$key])) {
                $expenseSummary[$key] = [
                    'description' => $description,
                    'liters' => 0,
                    'amount' => 0,
                ];
            }
            $expenseSummary[$key]['liters'] += $expenseLiters;
            $expenseSummary[$key]['amount'] += $expenseAmount;
        }

        $daily[] = [
            'day' => $entry['entry_date'],
            'entry_date' => $entry['entry_date'],
            'shift' => $entry['shift'],
            'status' => $entry['status'],
            'tx_count' => 1,
            'revenue' => round($entrySales, 2),
            'expenses' => round($entryExpenses, 2),
            'liters' => round($entryLiters, 2),
            'daily_entry_id' => (int)$entry['id'],
        ];
    }

    $fuelBreakdown = array_values($fuelTotals);
    usort($fuelBreakdown, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
    $expenseBreakdown = array_map(fn($row) => [
        'description' => $row['description'],
        'liters' => round((float)$row['liters'], 2),
        'amount' => round((float)$row['amount'], 2),
    ], array_values($expenseSummary));

    return [
        'source' => 'daily_entries',
        'daily_entries_count' => count($entries),
        'totals' => [
            'tx_count' => count($entries),
            'total_sales' => round($sales, 2),
            'total_expenses' => round($expenses, 2),
            'total_liters' => round($liters, 2),
        ],
        'fuel_breakdown' => $fuelBreakdown,
        'expense_summary' => $expenseBreakdown,
        'daily' => $daily,
    ];
}

switch ($action) {

    case 'weekly': {
        $bid = $user['role'] === 'owner'
            ? (!empty($_GET['branch_id']) ? requireBranchAccess($db, $user, $_GET['branch_id']) : null)
            : activeBranchId($db, $user, $_GET['branch_id'] ?? ($user['branch_id'] ?? null));
        // Default: current week Mon–Sun
        $weekStart = date('Y-m-d', strtotime('monday this week'));
        $weekEnd   = date('Y-m-d', strtotime('sunday this week'));
        if (!empty($_GET['week_start'])) $weekStart = $_GET['week_start'];
        if (!empty($_GET['week_end']))   $weekEnd   = $_GET['week_end'];
        [$weekStart, $weekEnd] = normalizeReportRange($weekStart, $weekEnd);

        $dailySummary = weeklyFromDailyEntries($db, $bid, $weekStart, $weekEnd);
        if ($dailySummary !== null) {
            jsonSuccess(array_merge([
                'week_start' => $weekStart,
                'week_end' => $weekEnd,
            ], $dailySummary));
        }

        $params = [$weekStart, $weekEnd];
        $extra  = '';
        if ($bid) { $extra = ' AND t.branch_id = ?'; $params[] = $bid; }

        // Totals
        $stmt = $db->prepare(
            'SELECT COUNT(*) AS tx_count,
                    COALESCE(SUM(total_amount),0) AS total_sales,
                    COALESCE(SUM(liters),0)        AS total_liters
             FROM transactions t
             WHERE t.status != \'void\' AND DATE(t.timestamp) BETWEEN ? AND ?'.$extra
        );
        $stmt->execute($params);
        $totals = $stmt->fetch();
        $totals['total_expenses'] = 0;

        // Fuel breakdown
        $stmt2 = $db->prepare(
            'SELECT f.id, f.name, f.color,
                    COALESCE(SUM(t.liters),0)        AS liters,
                    COALESCE(SUM(t.total_amount),0)  AS revenue
             FROM fuel_types f
             LEFT JOIN transactions t
               ON t.fuel_type = f.id
               AND t.status != \'void\'
               AND DATE(t.timestamp) BETWEEN ? AND ?'.(
                   $bid ? ' AND t.branch_id = ?' : '').'
             GROUP BY f.id ORDER BY revenue DESC'
        );
        $stmt2->execute($params);
        $fuelBreakdown = $stmt2->fetchAll();

        // Daily
        $stmt3 = $db->prepare(
            'SELECT DATE(t.timestamp) AS day,
                    COUNT(*) AS tx_count,
                    SUM(t.total_amount) AS revenue,
                    SUM(t.liters) AS liters
             FROM transactions t
             WHERE t.status != \'void\' AND DATE(t.timestamp) BETWEEN ? AND ?'.$extra.'
             GROUP BY DATE(t.timestamp) ORDER BY day'
        );
        $stmt3->execute($params);
        $daily = $stmt3->fetchAll();

        jsonSuccess([
            'week_start'     => $weekStart,
            'week_end'       => $weekEnd,
            'source'         => 'transactions',
            'totals'         => $totals,
            'fuel_breakdown' => $fuelBreakdown,
            'expense_summary'=> [],
            'daily'          => $daily,
        ]);
    }

    case 'submit': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b          = getBody();
        $bid        = $user['role'] === 'owner'
            ? requireBranchAccess($db, $user, $b['branch_id'] ?? null)
            : activeBranchId($db, $user, $b['branch_id'] ?? ($user['branch_id'] ?? null));
        $weekStart  = $b['week_start'] ?? date('Y-m-d', strtotime('monday this week'));
        $weekEnd    = $b['week_end']   ?? date('Y-m-d', strtotime('sunday this week'));
        [$weekStart, $weekEnd] = normalizeReportRange($weekStart, $weekEnd);

        $dailySummary = weeklyFromDailyEntries($db, $bid, $weekStart, $weekEnd);
        if ($dailySummary !== null) {
            $sales = $dailySummary['totals']['total_sales'];
            $expenses = $dailySummary['totals']['total_expenses'];
            $liters = $dailySummary['totals']['total_liters'];
        } else {
            $stmt = $db->prepare(
                'SELECT COALESCE(SUM(total_amount),0) AS sales,
                        COALESCE(SUM(liters),0) AS liters
                 FROM transactions
                 WHERE branch_id=? AND status != \'void\' AND DATE(timestamp) BETWEEN ? AND ?'
            );
            $stmt->execute([$bid, $weekStart, $weekEnd]);
            $t = $stmt->fetch();
            $sales = (float)$t['sales'];
            $expenses = 0.0;
            $liters = (float)$t['liters'];
        }

        $db->prepare(
            'INSERT INTO weekly_reports
               (branch_id, week_start, week_end, total_sales, total_expenses,
                total_liters, submitted_by, submitted_at, status)
             VALUES (?,?,?,?,?,?,?,NOW(),\'submitted\')'
        )->execute([
            $bid, $weekStart, $weekEnd,
            $sales, $expenses,
            $liters, $user['id'],
        ]);
        auditLog($db, $user, 'weekly_report_submit', 'weekly_report', $bid.'-'.$weekStart.'-'.$weekEnd, [
            'branch_id' => $bid,
            'week_start' => $weekStart,
            'week_end' => $weekEnd,
        ]);

        jsonSuccess(null, 'Weekly report submitted successfully.');
    }

    case 'list': {
        requireRole('owner');
        $where = [];
        $params = [];
        if (!empty($_GET['branch_id'])) {
            $where[] = 'r.branch_id = ?';
            $params[] = requireBranchAccess($db, $user, $_GET['branch_id']);
        }
        if (!empty($_GET['week_start'])) {
            $where[] = 'r.week_end >= ?';
            $params[] = $_GET['week_start'];
        }
        if (!empty($_GET['week_end'])) {
            $where[] = 'r.week_start <= ?';
            $params[] = $_GET['week_end'];
        }
        $whereSql = $where ? 'WHERE '.implode(' AND ', $where) : '';
        $stmt = $db->prepare(
            "SELECT r.*, b.name AS branch_name, u.name AS submitted_by_name
             FROM weekly_reports r
             LEFT JOIN branches b ON b.id = r.branch_id
             LEFT JOIN users    u ON u.id = r.submitted_by
             $whereSql
             ORDER BY r.submitted_at DESC, r.id DESC LIMIT 50"
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    default:
        jsonError('Unknown action.', 404);
}
