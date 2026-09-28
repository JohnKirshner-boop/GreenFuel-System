<?php
// backend/routes/analytics.php
// GET ?action=summary          — network totals
// GET ?action=daily  [&branch_id=] [&days=7]
// GET ?action=branch_ranking
// GET ?action=fuel_breakdown   [&branch_id=]
// GET ?action=forecast         [&branch_id=]

require_once __DIR__ . '/../config.php';
$user   = requireRole('owner', 'manager');
$action = $_GET['action'] ?? 'summary';
$db     = getDB();

function analyticsTableExists(PDO $db, string $table): bool {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?'
    );
    $stmt->execute([DB_NAME, $table]);
    return (int)$stmt->fetchColumn() > 0;
}

function analyticsMonthWeeks(string $month): array {
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
        jsonError('Invalid month. Use YYYY-MM.');
    }
    $start = new DateTimeImmutable($month.'-01');
    $lastDay = (int)$start->format('t');
    $weeks = [];
    for ($day = 1, $week = 1; $day <= $lastDay; $day += 7, $week++) {
        $from = $start->setDate((int)$start->format('Y'), (int)$start->format('m'), $day);
        $toDay = min($day + 6, $lastDay);
        $to = $start->setDate((int)$start->format('Y'), (int)$start->format('m'), $toDay);
        $weeks[] = [
            'number' => $week,
            'label'  => 'Week '.$week,
            'start'  => $from->format('Y-m-d'),
            'end'    => $to->format('Y-m-d'),
        ];
    }
    return $weeks;
}

function analyticsDailyEntryAgg(PDO $db, string $start, string $end): array {
    if (!analyticsTableExists($db, 'daily_entries')) return [];
    $stmt = $db->prepare(
        "SELECT branch_id, total_cash_expected, payload_json
         FROM daily_entries
         WHERE entry_date BETWEEN ? AND ?
           AND status IN ('submitted','reviewed')"
    );
    $stmt->execute([$start, $end]);
    $agg = [];
    foreach ($stmt->fetchAll() as $entry) {
        $bid = $entry['branch_id'];
        if (!isset($agg[$bid])) {
            $agg[$bid] = ['tx_count' => 0, 'revenue' => 0.0, 'liters' => 0.0];
        }
        $agg[$bid]['tx_count']++;
        $agg[$bid]['revenue'] += (float)$entry['total_cash_expected'];
        $payload = json_decode($entry['payload_json'] ?? '{}', true);
        if (is_array($payload)) {
            for ($pump = 1; $pump <= 4; $pump++) {
                $agg[$bid]['liters'] += (float)($payload["digital__pump{$pump}__consumed"] ?? 0);
            }
        }
    }
    return $agg;
}

function analyticsTransactionAgg(PDO $db, string $start, string $end): array {
    $stmt = $db->prepare(
        "SELECT branch_id,
                COUNT(*) AS tx_count,
                COALESCE(SUM(total_amount),0) AS revenue,
                COALESCE(SUM(liters),0) AS liters
         FROM transactions
         WHERE status != 'void'
           AND DATE(timestamp) BETWEEN ? AND ?
         GROUP BY branch_id"
    );
    $stmt->execute([$start, $end]);
    $agg = [];
    foreach ($stmt->fetchAll() as $row) {
        $agg[$row['branch_id']] = [
            'tx_count' => (int)$row['tx_count'],
            'revenue' => (float)$row['revenue'],
            'liters' => (float)$row['liters'],
        ];
    }
    return $agg;
}

function analyticsDailyInventoryTankFuelMap(): array {
    return [
        'diesel_7kl' => 'diesel',
        'diesel_10kl' => 'e10',
        'unleaded_7_5kl' => 'unleaded',
        'premium_10kl' => 'premium',
    ];
}

function analyticsBranchRowsForRange(PDO $db, array $branches, string $start, string $end): array {
    $daily = analyticsDailyEntryAgg($db, $start, $end);
    $tx = analyticsTransactionAgg($db, $start, $end);
    $rows = [];
    foreach ($branches as $branch) {
        $bid = $branch['id'];
        $source = 'none';
        $metrics = ['tx_count' => 0, 'revenue' => 0.0, 'liters' => 0.0];
        if (isset($daily[$bid]) && ($daily[$bid]['tx_count'] > 0 || $daily[$bid]['revenue'] > 0)) {
            $metrics = $daily[$bid];
            $source = 'daily_entries';
        } elseif (isset($tx[$bid])) {
            $metrics = $tx[$bid];
            $source = 'transactions';
        }
        $rows[] = [
            'id' => $bid,
            'name' => $branch['name'],
            'location' => $branch['location'],
            'tx_count' => (int)$metrics['tx_count'],
            'revenue' => round((float)$metrics['revenue'], 2),
            'liters' => round((float)$metrics['liters'], 2),
            'avg_tx' => $metrics['tx_count'] > 0 ? round((float)$metrics['revenue'] / (int)$metrics['tx_count'], 2) : 0,
            'source' => $source,
        ];
    }
    usort($rows, fn($a, $b) => $b['revenue'] <=> $a['revenue']);
    return $rows;
}

switch ($action) {

    // ---- OVERALL NETWORK SUMMARY ----
    case 'summary': {
        $row = $db->query(
            'SELECT COUNT(*) AS tx_count,
                    SUM(total_amount) AS total_revenue,
                    SUM(tax_amount) AS total_tax,
                    SUM(liters) AS total_liters,
                    AVG(total_amount) AS avg_tx
             FROM transactions
             WHERE status != \'void\''
        )->fetch();
        $today = $db->query(
            'SELECT COUNT(*) AS tx_count,
                    COALESCE(SUM(total_amount),0) AS revenue,
                    COALESCE(SUM(tax_amount),0) AS tax,
                    COALESCE(SUM(liters),0) AS liters
             FROM transactions WHERE status != \'void\' AND DATE(timestamp)=CURDATE()'
        )->fetch();
        jsonSuccess(['all_time' => $row, 'today' => $today]);
    }

    // ---- DAILY REVENUE PER BRANCH ----
    case 'daily': {
        $days = min((int)($_GET['days'] ?? 7), 90);
        $bid  = $_GET['branch_id'] ?? null;
        $extra = $bid ? ' AND t.branch_id = ?' : '';
        $params = [$days];
        if ($bid) $params[] = $bid;
        $stmt = $db->prepare(
            'SELECT DATE(t.timestamp) AS day,
                    t.branch_id,
                    b.name AS branch_name,
                    COUNT(*) AS tx_count,
                    SUM(t.total_amount) AS revenue,
                    SUM(t.tax_amount) AS tax,
                    SUM(t.liters) AS liters
             FROM transactions t
             LEFT JOIN branches b ON b.id = t.branch_id
             WHERE t.status != \'void\' AND t.timestamp >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'.$extra.'
             GROUP BY DATE(t.timestamp), t.branch_id
             ORDER BY day ASC, t.branch_id'
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    // ---- BRANCH RANKING ----
    case 'branch_ranking': {
        $stmt = $db->query(
            'SELECT b.id, b.name, b.location,
                    COUNT(t.id) AS tx_count,
                    COALESCE(SUM(t.total_amount),0) AS revenue,
                    COALESCE(SUM(t.liters),0) AS liters,
                    COALESCE(AVG(t.total_amount),0) AS avg_tx
             FROM branches b
             LEFT JOIN transactions t ON t.branch_id = b.id AND t.status != \'void\'
             GROUP BY b.id
             ORDER BY revenue DESC'
        );
        jsonSuccess($stmt->fetchAll());
    }

    // ---- BRANCH COMPARISON BY WEEKS OF THE SELECTED MONTH ----
    case 'branch_comparison': {
        requireRole('owner');
        $month = $_GET['month'] ?? date('Y-m');
        $weeks = analyticsMonthWeeks($month);
        $selectedWeek = max(1, (int)($_GET['week'] ?? 0));
        if ($selectedWeek < 1 || $selectedWeek > count($weeks)) {
            $today = date('Y-m-d');
            $selectedWeek = 1;
            if ($month === date('Y-m')) {
                foreach ($weeks as $week) {
                    if ($today >= $week['start'] && $today <= $week['end']) {
                        $selectedWeek = (int)$week['number'];
                        break;
                    }
                }
            }
        }

        $branches = $db->query('SELECT id, name, location FROM branches ORDER BY name')->fetchAll();
        $selectedRange = $weeks[$selectedWeek - 1];
        $ranking = analyticsBranchRowsForRange($db, $branches, $selectedRange['start'], $selectedRange['end']);
        $previousRows = $selectedWeek > 1
            ? analyticsBranchRowsForRange($db, $branches, $weeks[$selectedWeek - 2]['start'], $weeks[$selectedWeek - 2]['end'])
            : [];
        $previousByBranch = [];
        foreach ($previousRows as $row) $previousByBranch[$row['id']] = (float)$row['revenue'];

        foreach ($ranking as &$row) {
            $previous = $previousByBranch[$row['id']] ?? 0.0;
            $current = (float)$row['revenue'];
            $row['previous_revenue'] = round($previous, 2);
            $row['growth_pct'] = $previous > 0 ? round((($current - $previous) / $previous) * 100, 1) : ($current > 0 ? 100.0 : 0.0);
        }
        unset($row);
        usort($ranking, fn($a, $b) => $b['revenue'] <=> $a['revenue']);

        $trendByBranch = [];
        foreach ($branches as $branch) {
            $trendByBranch[$branch['id']] = [
                'branch_id' => $branch['id'],
                'branch_name' => $branch['name'],
                'data' => [],
            ];
        }
        foreach ($weeks as $week) {
            $weekRows = analyticsBranchRowsForRange($db, $branches, $week['start'], $week['end']);
            foreach ($weekRows as $row) {
                $trendByBranch[$row['id']]['data'][] = [
                    'week_number' => $week['number'],
                    'label' => $week['label'],
                    'start' => $week['start'],
                    'end' => $week['end'],
                    'revenue' => $row['revenue'],
                    'liters' => $row['liters'],
                    'tx_count' => $row['tx_count'],
                    'source' => $row['source'],
                ];
            }
        }

        jsonSuccess([
            'month' => $month,
            'selected_week' => $selectedWeek,
            'selected_range' => $selectedRange,
            'weeks' => $weeks,
            'ranking' => $ranking,
            'trends' => array_values($trendByBranch),
        ]);
    }

    // ---- FUEL BREAKDOWN ----
    case 'fuel_breakdown': {
        $bid    = $_GET['branch_id'] ?? null;
        $extra  = $bid ? ' AND t.branch_id = ?' : '';
        $params = $bid ? [$bid] : [];
        $stmt   = $db->prepare(
            'SELECT f.id, f.name, f.color,
                    COUNT(t.id) AS tx_count,
                    COALESCE(SUM(t.liters),0) AS liters,
                    COALESCE(SUM(t.total_amount),0) AS revenue
             FROM fuel_types f
             LEFT JOIN transactions t ON t.fuel_type = f.id AND t.status != \'void\''.$extra.'
             GROUP BY f.id
             ORDER BY revenue DESC'
        );
        $stmt->execute($params);
        jsonSuccess($stmt->fetchAll());
    }

    // ---- FORECAST (fuel stock vs sales demand) ----
    case 'forecast': {
        $bid = $user['role'] !== 'owner' ? ($user['branch_id'] ?? null) : ($_GET['branch_id'] ?? null);
        $end = date('Y-m-d');
        $start = date('Y-m-d', strtotime($end.' -6 days'));
        $branchFilter = $bid ? ' AND branch_id = ?' : '';
        $recentParams = [$start, $end];
        if ($bid) $recentParams[] = $bid;

        $recentStmt = $db->prepare(
            "SELECT COALESCE(SUM(liters),0)
             FROM transactions
             WHERE status != 'void'
               AND DATE(timestamp) BETWEEN ? AND ?
               $branchFilter"
        );
        $recentStmt->execute($recentParams);
        $recentLiters = (float)$recentStmt->fetchColumn();
        $basis = 'recent_7_days';

        if ($recentLiters <= 0) {
            $maxSql = "SELECT MAX(DATE(timestamp)) FROM transactions WHERE status != 'void'".($bid ? ' AND branch_id = ?' : '');
            $maxStmt = $db->prepare($maxSql);
            $maxStmt->execute($bid ? [$bid] : []);
            $latest = $maxStmt->fetchColumn();
            if ($latest) {
                $end = $latest;
                $start = date('Y-m-d', strtotime($end.' -6 days'));
                $basis = 'latest_recorded';
            }
        }

        $branchSql = 'SELECT id, name, location FROM branches'.($bid ? ' WHERE id=?' : '').' ORDER BY name';
        $branchStmt = $db->prepare($branchSql);
        $branchStmt->execute($bid ? [$bid] : []);
        $branches = $branchStmt->fetchAll();

        $fuels = $db->query('SELECT id, name, color FROM fuel_types ORDER BY FIELD(id, \'diesel\', \'e10\', \'unleaded\', \'premium\'), name')->fetchAll();

        $salesParams = [$start, $end];
        if ($bid) $salesParams[] = $bid;
        $salesStmt = $db->prepare(
            "SELECT branch_id, fuel_type, DATE(timestamp) AS day,
                    COALESCE(SUM(liters),0) AS liters,
                    COALESCE(SUM(total_amount),0) AS revenue
             FROM transactions
             WHERE status != 'void'
               AND DATE(timestamp) BETWEEN ? AND ?
               $branchFilter
             GROUP BY branch_id, fuel_type, DATE(timestamp)"
        );
        $salesStmt->execute($salesParams);
        $sales = [];
        foreach ($salesStmt->fetchAll() as $row) {
            $sales[$row['branch_id']][$row['fuel_type']][$row['day']] = [
                'liters' => (float)$row['liters'],
                'revenue' => (float)$row['revenue'],
            ];
        }

        $stock = [];
        if (analyticsTableExists($db, 'fuel_inventory_levels')) {
            $stockSql = "SELECT l.branch_id, l.fuel_type, l.current_liters,
                                COALESCE(p.critical_liters,1000) AS critical_liters,
                                COALESCE(p.tank_capacity_liters,0) AS tank_capacity_liters
                         FROM fuel_inventory_levels l
                         LEFT JOIN fuel_calibration_profiles p
                           ON p.branch_id = l.branch_id AND p.fuel_type = l.fuel_type".
                         ($bid ? ' WHERE l.branch_id=?' : '');
            $stockStmt = $db->prepare($stockSql);
            $stockStmt->execute($bid ? [$bid] : []);
            foreach ($stockStmt->fetchAll() as $row) {
                $stock[$row['branch_id']][$row['fuel_type']] = [
                    'current_liters' => (float)$row['current_liters'],
                    'critical_liters' => (float)$row['critical_liters'],
                    'tank_capacity_liters' => (float)$row['tank_capacity_liters'],
                    'stock_source' => 'inventory_level',
                    'stock_date' => null,
                ];
            }
        }

        if (analyticsTableExists($db, 'daily_entries')) {
            $dailySql = "SELECT branch_id, entry_date, submitted_at, payload_json
                         FROM daily_entries
                         WHERE status IN ('submitted','reviewed')".
                         ($bid ? ' AND branch_id=?' : '').
                         " ORDER BY entry_date DESC, submitted_at DESC, id DESC";
            $dailyStmt = $db->prepare($dailySql);
            $dailyStmt->execute($bid ? [$bid] : []);

            foreach ($dailyStmt->fetchAll() as $entry) {
                $payload = json_decode($entry['payload_json'] ?? '{}', true);
                if (!is_array($payload)) continue;

                foreach (analyticsDailyInventoryTankFuelMap() as $tankKey => $fuelType) {
                    $endingKey = "inv__{$tankKey}__ending__l";
                    if (!array_key_exists($endingKey, $payload)) continue;
                    if (($stock[$entry['branch_id']][$fuelType]['stock_source'] ?? '') === 'daily_entry') continue;

                    $base = $stock[$entry['branch_id']][$fuelType] ?? [
                        'current_liters' => 0.0,
                        'critical_liters' => 1000.0,
                        'tank_capacity_liters' => 0.0,
                    ];
                    $stock[$entry['branch_id']][$fuelType] = [
                        'current_liters' => (float)($payload[$endingKey] ?? 0),
                        'critical_liters' => (float)($base['critical_liters'] ?? 1000),
                        'tank_capacity_liters' => (float)($base['tank_capacity_liters'] ?? 0),
                        'stock_source' => 'daily_entry',
                        'stock_date' => $entry['entry_date'],
                    ];
                }
            }
        }

        $dateWindow = [];
        for ($i = 0; $i < 7; $i++) {
            $dateWindow[] = date('Y-m-d', strtotime($start." +$i days"));
        }

        $result = [];
        foreach ($branches as $branch) {
            foreach ($fuels as $fuel) {
                $dailyData = [];
                $totalLiters = 0.0;
                $totalRevenue = 0.0;
                $salesDays = 0;
                foreach ($dateWindow as $day) {
                    $daySales = $sales[$branch['id']][$fuel['id']][$day] ?? ['liters' => 0, 'revenue' => 0];
                    $liters = (float)$daySales['liters'];
                    $revenue = (float)$daySales['revenue'];
                    if ($liters > 0) $salesDays++;
                    $totalLiters += $liters;
                    $totalRevenue += $revenue;
                    $dailyData[] = [
                        'day' => $day,
                        'liters' => round($liters, 2),
                        'revenue' => round($revenue, 2),
                    ];
                }

                $stockRow = $stock[$branch['id']][$fuel['id']] ?? [
                    'current_liters' => 0.0,
                    'critical_liters' => 1000.0,
                    'tank_capacity_liters' => 0.0,
                    'stock_source' => 'none',
                    'stock_date' => null,
                ];
                $avgDailyLiters = $salesDays > 0 ? $totalLiters / $salesDays : 0.0;
                $projected7 = $avgDailyLiters * 7;
                $currentStock = (float)$stockRow['current_liters'];
                $critical = (float)$stockRow['critical_liters'];
                $daysRemaining = $avgDailyLiters > 0 ? $currentStock / $avgDailyLiters : null;

                if ($salesDays === 0) {
                    $suggest = 'no sales data';
                    $risk = 4;
                } elseif ($currentStock <= 0 || $currentStock <= $critical || ($daysRemaining !== null && $daysRemaining <= 2)) {
                    $suggest = 'refill urgent';
                    $risk = 1;
                } elseif ($currentStock < $projected7 || ($daysRemaining !== null && $daysRemaining <= 5)) {
                    $suggest = 'monitor stock';
                    $risk = 2;
                } else {
                    $suggest = 'stock healthy';
                    $risk = 3;
                }

                $result[] = [
                    'branch_id' => $branch['id'],
                    'branch_name' => $branch['name'],
                    'branch_location' => $branch['location'],
                    'fuel_type' => $fuel['id'],
                    'fuel_name' => $fuel['name'],
                    'fuel_color' => $fuel['color'],
                    'current_stock' => round($currentStock, 2),
                    'critical_liters' => round($critical, 2),
                    'tank_capacity_liters' => round((float)$stockRow['tank_capacity_liters'], 2),
                    'stock_source' => $stockRow['stock_source'] ?? 'none',
                    'stock_date' => $stockRow['stock_date'] ?? null,
                    'recent_liters' => round($totalLiters, 2),
                    'recent_revenue' => round($totalRevenue, 2),
                    'sales_days' => $salesDays,
                    'avg_daily_liters' => round($avgDailyLiters, 2),
                    'projected_7day_liters' => round($projected7, 2),
                    'days_remaining' => $daysRemaining === null ? null : round($daysRemaining, 1),
                    'forecast_ma' => round($projected7, 2),
                    'avg_daily' => round($avgDailyLiters, 2),
                    'suggestion' => $suggest,
                    'risk_score' => $risk,
                    'basis' => $basis,
                    'basis_label' => $basis === 'recent_7_days' ? 'Recent 7 calendar days' : 'Latest 7 recorded days',
                    'date_start' => $start,
                    'date_end' => $end,
                    'daily_data' => $dailyData,
                ];
            }
        }
        usort($result, fn($a, $b) => ($a['risk_score'] <=> $b['risk_score']) ?: strcmp($a['branch_name'], $b['branch_name']) ?: strcmp($a['fuel_name'], $b['fuel_name']));
        jsonSuccess($result);
    }

    // ---- INSIGHTS (decision support) ----
    case 'insights': {
        $ranking = $db->query(
            'SELECT b.name, COALESCE(SUM(t.total_amount),0) AS revenue
             FROM branches b
             LEFT JOIN transactions t ON t.branch_id = b.id AND t.status != \'void\'
             GROUP BY b.id ORDER BY revenue DESC'
        )->fetchAll();

        $trend = $db->query(
            'SELECT DATE(timestamp) AS day, SUM(liters) AS liters
             FROM transactions
             WHERE status != \'void\' AND timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
             GROUP BY DATE(timestamp) ORDER BY day'
        )->fetchAll();

        $liters = array_column($trend, 'liters');
        $half   = intdiv(count($liters), 2);
        $early  = $half > 0 ? array_sum(array_slice($liters, 0, $half)) / $half : 0;
        $recent = $half > 0 ? array_sum(array_slice($liters, -$half)) / $half   : 0;
        $trendUp = $recent > $early;

        $top     = $ranking[0] ?? null;
        $bottom  = end($ranking) ?: null;

        $insights = [];
        if ($top)    $insights[] = ['type'=>'success','label'=>'Top Performer','text'=>$top['name'].' leads with ₱'.number_format($top['revenue'],2).' in total revenue.'];
        if ($bottom) $insights[] = ['type'=>'warning','label'=>'Action Needed','text'=>$bottom['name'].' has the lowest revenue at ₱'.number_format($bottom['revenue'],2).'. Consider a promotion.'];
        $insights[] = ['type'=>$trendUp?'success':'danger','label'=>'Sales Trend','text'=>'Network sales volume is '.($trendUp?'increasing — demand is growing.':'declining — consider promotions.')];
        jsonSuccess($insights);
    }

    default:
        jsonError('Unknown action.', 404);
}
