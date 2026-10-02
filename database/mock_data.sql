-- ============================================================
-- GreenFuel / FuelSight mock data
-- Run this AFTER schema.sql and security_migration.sql.
--
-- Local examples:
--   mysql -u root greenfuel < database/mock_data.sql
--   mysql -u root greenfuel_fixed < database/mock_data.sql
--
-- AWS example:
--   sudo mysql greenfuel < database/mock_data.sql
--
-- This file is safe to re-run. It only clears rows marked with
-- MOCK-* ids or "Mock demo data:" notes before inserting fresh demo rows.
-- ============================================================

SET @mock_owner_id := (SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1);
SET @mock_manager1_id := (SELECT id FROM users WHERE email = 'manager1@greenfuel.local' LIMIT 1);
SET @mock_manager2_id := (SELECT id FROM users WHERE email = 'manager2@greenfuel.local' LIMIT 1);

-- Prepare newer account fields when the target database is older than the current schema.
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE users ADD COLUMN account_status ENUM('pending','active','deactivated') NOT NULL DEFAULT 'active' AFTER role",
    "DO 0"
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'account_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE users ADD COLUMN activated_at DATETIME NULL AFTER last_seen_at",
    "DO 0"
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'activated_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    "ALTER TABLE users ADD COLUMN activated_by INT NULL AFTER activated_at",
    "DO 0"
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'activated_by'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NULL,
  actor_role VARCHAR(30) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id VARCHAR(120) NULL,
  details_json JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_actor (actor_id),
  KEY idx_audit_action (action),
  KEY idx_audit_created (created_at),
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Keep seeded demo accounts usable for testing.
UPDATE users
   SET account_status = 'active',
       activated_at = COALESCE(activated_at, NOW()),
       activated_by = COALESCE(activated_by, @mock_owner_id)
 WHERE email IN (
   'owner@greenfuel.local',
   'manager1@greenfuel.local',
   'manager2@greenfuel.local',
   'cashier1@greenfuel.local',
   'cashier2@greenfuel.local'
 );

INSERT INTO users (username, email, password, name, role, account_status, branch_id, activated_at, activated_by)
VALUES
  ('cashier3', 'cashier3@greenfuel.local', '$2y$10$eehdACmnvw2yWuSmgiraX.pbS3OItBbPbcPZL0dseBaCsTyjJrc.W', 'Liza Ramos', 'cashier', 'active', 'b3', NOW(), @mock_owner_id),
  ('cashier4', 'cashier4@greenfuel.local', '$2y$10$eehdACmnvw2yWuSmgiraX.pbS3OItBbPbcPZL0dseBaCsTyjJrc.W', 'Mark Villanueva', 'cashier', 'active', 'b4', NOW(), @mock_owner_id)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  role = VALUES(role),
  account_status = 'active',
  branch_id = VALUES(branch_id),
  activated_at = COALESCE(activated_at, NOW()),
  activated_by = COALESCE(activated_by, @mock_owner_id);

INSERT IGNORE INTO user_branches (user_id, branch_id, is_primary)
SELECT u.id, x.branch_id, x.is_primary
  FROM users u
  JOIN (
    SELECT 'manager1@greenfuel.local' AS email, 'b1' AS branch_id, 1 AS is_primary UNION ALL
    SELECT 'manager1@greenfuel.local', 'b3', 0 UNION ALL
    SELECT 'manager2@greenfuel.local', 'b2', 1 UNION ALL
    SELECT 'manager2@greenfuel.local', 'b4', 0 UNION ALL
    SELECT 'cashier1@greenfuel.local', 'b1', 1 UNION ALL
    SELECT 'cashier2@greenfuel.local', 'b2', 1 UNION ALL
    SELECT 'cashier3@greenfuel.local', 'b3', 1 UNION ALL
    SELECT 'cashier4@greenfuel.local', 'b4', 1
  ) x ON x.email = u.email;

-- Inventory support tables used by forecasting.
CREATE TABLE IF NOT EXISTS fuel_calibration_profiles (
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
);

CREATE TABLE IF NOT EXISTS fuel_inventory_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id VARCHAR(10) NOT NULL,
  fuel_type VARCHAR(20) NOT NULL,
  current_liters DECIMAL(12,2) NOT NULL DEFAULT 0,
  last_measurement_cm DECIMAL(8,2) NULL,
  last_measured_at DATETIME NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inventory_level (branch_id, fuel_type)
);

CREATE TABLE IF NOT EXISTS fuel_inventory_movements (
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
);

-- Approved branch prices. Existing real branch prices are kept.
INSERT INTO fuel_branch_prices (branch_id, fuel_type, price, approved_request_id, approved_by, approved_at)
SELECT b.id,
       f.id,
       ROUND(f.price + CASE b.id
         WHEN 'b1' THEN 0.00
         WHEN 'b2' THEN 0.35
         WHEN 'b3' THEN -0.20
         WHEN 'b4' THEN 0.50
         ELSE 0.00
       END, 2),
       NULL,
       @mock_owner_id,
       NOW()
  FROM branches b
 CROSS JOIN fuel_types f
 WHERE 1 = 1
ON DUPLICATE KEY UPDATE updated_at = updated_at;

-- Remove previously seeded mock rows.
DELETE FROM transaction_cash_breakdown WHERE transaction_id LIKE 'MOCK-%';
DELETE FROM transaction_change_breakdown WHERE transaction_id LIKE 'MOCK-%';
DELETE FROM void_logs WHERE transaction_id LIKE 'MOCK-%';
DELETE FROM transactions WHERE id LIKE 'MOCK-%';

DELETE scb
  FROM shift_cash_breakdown scb
  JOIN shift_sessions ss ON ss.id = scb.shift_session_id
 WHERE ss.cashier_note LIKE 'Mock demo data:%';

DELETE FROM shift_records WHERE id LIKE 'MOCK-%';
DELETE FROM shift_sessions WHERE cashier_note LIKE 'Mock demo data:%';
DELETE FROM daily_entries WHERE duty_personnel = 'Mock Demo Personnel';
DELETE FROM fuel_price_requests WHERE reason LIKE 'Mock demo data:%';
DELETE FROM fuel_inventory_movements WHERE reference_id LIKE 'MOCK-%';
DELETE FROM audit_logs WHERE action LIKE 'mock_%' OR entity_id LIKE 'MOCK-%';

-- Recent POS terminal transactions across all branches.
DROP TEMPORARY TABLE IF EXISTS mock_tx;
CREATE TEMPORARY TABLE mock_tx (
  seq INT NOT NULL,
  branch_id VARCHAR(10) NOT NULL,
  cashier_email VARCHAR(120) NOT NULL,
  day_offset INT NOT NULL,
  fuel_type VARCHAR(20) NOT NULL,
  liters DECIMAL(10,4) NOT NULL,
  customer VARCHAR(100) NOT NULL
);

INSERT INTO mock_tx (seq, branch_id, cashier_email, day_offset, fuel_type, liters, customer) VALUES
  (1, 'b1', 'cashier1@greenfuel.local', 0, 'diesel',   48.7500, 'Walk-in'),
  (2, 'b1', 'cashier1@greenfuel.local', 0, 'unleaded', 32.2000, 'Walk-in'),
  (3, 'b1', 'cashier1@greenfuel.local', 0, 'premium',  15.4000, 'Walk-in'),
  (1, 'b1', 'cashier1@greenfuel.local', 1, 'e10',      41.8000, 'Fleet A'),
  (2, 'b1', 'cashier1@greenfuel.local', 1, 'diesel',   38.6000, 'Walk-in'),
  (1, 'b1', 'cashier1@greenfuel.local', 2, 'unleaded', 55.2500, 'Walk-in'),
  (1, 'b1', 'cashier1@greenfuel.local', 4, 'premium',  24.7000, 'Walk-in'),
  (1, 'b1', 'cashier1@greenfuel.local', 6, 'diesel',   60.3000, 'Fleet B'),
  (1, 'b2', 'cashier2@greenfuel.local', 0, 'unleaded', 42.4000, 'Walk-in'),
  (2, 'b2', 'cashier2@greenfuel.local', 0, 'diesel',   36.1000, 'Walk-in'),
  (1, 'b2', 'cashier2@greenfuel.local', 1, 'premium',  20.7500, 'Walk-in'),
  (2, 'b2', 'cashier2@greenfuel.local', 1, 'e10',      31.2500, 'Walk-in'),
  (1, 'b2', 'cashier2@greenfuel.local', 3, 'diesel',   58.9000, 'Fleet C'),
  (1, 'b2', 'cashier2@greenfuel.local', 5, 'unleaded', 49.3000, 'Walk-in'),
  (1, 'b3', 'cashier3@greenfuel.local', 0, 'diesel',   44.2500, 'Walk-in'),
  (2, 'b3', 'cashier3@greenfuel.local', 0, 'e10',      37.8000, 'Walk-in'),
  (1, 'b3', 'cashier3@greenfuel.local', 2, 'premium',  18.9000, 'Walk-in'),
  (1, 'b3', 'cashier3@greenfuel.local', 4, 'unleaded', 52.6500, 'Walk-in'),
  (1, 'b4', 'cashier4@greenfuel.local', 0, 'premium',  25.3000, 'Walk-in'),
  (2, 'b4', 'cashier4@greenfuel.local', 0, 'diesel',   40.5000, 'Walk-in'),
  (1, 'b4', 'cashier4@greenfuel.local', 2, 'unleaded', 46.1500, 'Walk-in'),
  (1, 'b4', 'cashier4@greenfuel.local', 5, 'e10',      39.7000, 'Walk-in');

DROP TEMPORARY TABLE IF EXISTS mock_shift_source;
CREATE TEMPORARY TABLE mock_shift_source AS
SELECT mt.branch_id,
       mt.cashier_email,
       mt.day_offset,
       SUM(mt.liters) AS total_liters,
       ROUND(SUM(mt.liters * COALESCE(bp.price, f.price)), 2) AS total_sales
  FROM mock_tx mt
  JOIN fuel_types f ON f.id = mt.fuel_type
  LEFT JOIN fuel_branch_prices bp
    ON bp.branch_id = mt.branch_id
   AND bp.fuel_type = mt.fuel_type
 GROUP BY mt.branch_id, mt.cashier_email, mt.day_offset;

INSERT INTO shift_sessions
  (branch_id, cashier_id, start_time, end_time, total_sales, total_liters, total_cash, cashier_note, status)
SELECT m.branch_id,
       u.id,
       DATE_ADD(DATE_SUB(CURDATE(), INTERVAL m.day_offset DAY), INTERVAL 7 HOUR),
       DATE_ADD(DATE_SUB(CURDATE(), INTERVAL m.day_offset DAY), INTERVAL 15 HOUR),
       m.total_sales,
       ROUND(m.total_liters, 2),
       ROUND(m.total_sales + CASE m.branch_id WHEN 'b1' THEN 20 WHEN 'b2' THEN -15 WHEN 'b3' THEN 0 ELSE 35 END, 2),
       CONCAT('Mock demo data: cashier end-shift note for ', m.branch_id, ' on ', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL m.day_offset DAY), '%Y-%m-%d'), '. Includes cash count explanation.'),
       'submitted'
  FROM mock_shift_source m
  JOIN users u ON u.email = m.cashier_email;

INSERT INTO transactions
  (id, branch_id, fuel_type, liters, price_per_liter, total_amount, amount_paid,
   subtotal_amount, tax_rate, tax_amount, cash_received, change_amount, customer,
   cashier_id, shift_session_id, status, timestamp)
SELECT CONCAT('MOCK-', g.branch_id, '-', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL g.day_offset DAY), '%m%d'), '-', UPPER(LEFT(g.fuel_type, 2)), '-', g.seq),
       g.branch_id,
       g.fuel_type,
       g.liters,
       g.price_per_liter,
       g.total_gross,
       g.total_gross,
       ROUND(g.total_gross / 1.12, 2),
       12.00,
       ROUND(g.total_gross - ROUND(g.total_gross / 1.12, 2), 2),
       CEIL(g.total_gross / 100) * 100,
       ROUND((CEIL(g.total_gross / 100) * 100) - g.total_gross, 2),
       g.customer,
       u.id,
       ss.id,
       IF(g.day_offset = 0, 'pending', 'verified'),
       DATE_ADD(DATE_ADD(DATE_SUB(CURDATE(), INTERVAL g.day_offset DAY), INTERVAL 8 HOUR), INTERVAL (g.seq * 37) MINUTE)
  FROM (
    SELECT mt.*,
           COALESCE(bp.price, f.price) AS price_per_liter,
           ROUND(mt.liters * COALESCE(bp.price, f.price), 2) AS total_gross
      FROM mock_tx mt
      JOIN fuel_types f ON f.id = mt.fuel_type
      LEFT JOIN fuel_branch_prices bp
        ON bp.branch_id = mt.branch_id
       AND bp.fuel_type = mt.fuel_type
  ) g
  JOIN users u ON u.email = g.cashier_email
  JOIN shift_sessions ss
    ON ss.branch_id = g.branch_id
   AND ss.cashier_id = u.id
   AND DATE(ss.start_time) = DATE_SUB(CURDATE(), INTERVAL g.day_offset DAY)
   AND ss.cashier_note LIKE 'Mock demo data:%';

INSERT INTO shift_cash_breakdown
  (shift_session_id, denomination_id, denomination_value, quantity, amount)
SELECT q.shift_session_id,
       q.denomination_id,
       q.denomination_value,
       q.quantity,
       q.denomination_value * q.quantity
  FROM (
    SELECT ss.id AS shift_session_id,
           cd.id AS denomination_id,
           cd.value AS denomination_value,
           CASE cd.value
             WHEN 1000 THEN FLOOR(ss.total_cash / 1000)
             WHEN 500 THEN MOD(FLOOR(ss.total_cash / 500), 2)
             WHEN 200 THEN 1
             WHEN 100 THEN 3
             WHEN 50 THEN 2
             WHEN 20 THEN 5
             ELSE 0
           END AS quantity
      FROM shift_sessions ss
      JOIN cash_denominations cd ON cd.active = 1
     WHERE ss.cashier_note LIKE 'Mock demo data:%'
  ) q
 WHERE q.quantity > 0;

INSERT INTO shift_records
  (id, branch_id, date, shift, shift_session_id, start_time, end_time, cashier_id,
   total_sales, total_liters, status, remarks, cashier_note, created_at)
SELECT CONCAT('MOCK-SHIFT-', ss.id),
       ss.branch_id,
       DATE(ss.start_time),
       'Morning',
       ss.id,
       ss.start_time,
       ss.end_time,
       ss.cashier_id,
       ss.total_sales,
       ss.total_liters,
       IF(DATE(ss.start_time) = CURDATE(), 'Pending', 'Verified'),
       'Mock demo shift record for manager verification.',
       ss.cashier_note,
       ss.created_at
  FROM shift_sessions ss
 WHERE ss.cashier_note LIKE 'Mock demo data:%';

-- Daily manager entries. These feed weekly reports and inventory forecasting.
DROP TEMPORARY TABLE IF EXISTS mock_daily;
CREATE TEMPORARY TABLE mock_daily (
  branch_id VARCHAR(10) NOT NULL,
  manager_email VARCHAR(120) NOT NULL,
  day_offset INT NOT NULL,
  diesel_l DECIMAL(10,2) NOT NULL,
  unleaded_l DECIMAL(10,2) NOT NULL,
  premium_l DECIMAL(10,2) NOT NULL,
  e10_l DECIMAL(10,2) NOT NULL,
  expenses DECIMAL(12,2) NOT NULL,
  over_short DECIMAL(12,2) NOT NULL,
  expense_note VARCHAR(120) NOT NULL,
  diesel_stock DECIMAL(12,2) NOT NULL,
  unleaded_stock DECIMAL(12,2) NOT NULL,
  premium_stock DECIMAL(12,2) NOT NULL,
  e10_stock DECIMAL(12,2) NOT NULL
);

INSERT INTO mock_daily
  (branch_id, manager_email, day_offset, diesel_l, unleaded_l, premium_l, e10_l,
   expenses, over_short, expense_note, diesel_stock, unleaded_stock, premium_stock, e10_stock)
VALUES
  ('b1', 'manager1@greenfuel.local', 0, 88.40, 72.50, 28.20, 51.30, 920.00,  15.00, 'Utilities and store supplies', 6030.00, 5660.00, 7480.00, 8120.00),
  ('b1', 'manager1@greenfuel.local', 1, 90.50, 65.20, 34.10, 48.60, 850.50,  20.00, 'Generator fuel and office supplies', 6118.40, 5732.50, 7508.20, 8171.30),
  ('b1', 'manager1@greenfuel.local', 2, 79.80, 58.75, 22.40, 42.10, 630.00, -10.00, 'Minor maintenance materials', 6208.90, 5797.70, 7542.30, 8219.90),
  ('b2', 'manager2@greenfuel.local', 0, 76.20, 81.35, 21.70, 39.40, 780.00,   5.00, 'Cleaning supplies and utilities', 5340.00, 6210.00, 7050.00, 7650.00),
  ('b2', 'manager2@greenfuel.local', 1, 84.60, 69.20, 19.35, 45.75, 695.25, -12.00, 'Pump receipt rolls and repairs', 5416.20, 6291.35, 7071.70, 7689.40);

INSERT INTO daily_entries
  (branch_id, entry_date, shift, time_in, time_out, duty_personnel,
   total_cash_expected, total_expenses, actual_cash_remitted, cash_payment,
   over_short, payload_json, submitted_by, submitted_at, status)
SELECT x.branch_id,
       DATE_SUB(CURDATE(), INTERVAL x.day_offset DAY),
       'Automatic Time Records',
       '07:00:00',
       '15:00:00',
       'Mock Demo Personnel',
       x.expected_sales,
       x.expenses,
       ROUND(x.expected_sales - x.expenses + x.over_short, 2),
       ROUND(x.expected_sales - x.expenses + x.over_short, 2),
       x.over_short,
       JSON_OBJECT(
         'digital__pump1__product', 'diesel',
         'digital__pump1__beginning', 1000 + (x.day_offset * 40),
         'digital__pump1__ending', 1000 + (x.day_offset * 40) + x.diesel_l,
         'digital__pump1__consumed', x.diesel_l,
         'digital__pump1__amount', ROUND(x.diesel_l * x.diesel_price, 2),
         'digital__pump2__product', 'unleaded',
         'digital__pump2__beginning', 2000 + (x.day_offset * 40),
         'digital__pump2__ending', 2000 + (x.day_offset * 40) + x.unleaded_l,
         'digital__pump2__consumed', x.unleaded_l,
         'digital__pump2__amount', ROUND(x.unleaded_l * x.unleaded_price, 2),
         'digital__pump3__product', 'premium',
         'digital__pump3__beginning', 3000 + (x.day_offset * 40),
         'digital__pump3__ending', 3000 + (x.day_offset * 40) + x.premium_l,
         'digital__pump3__consumed', x.premium_l,
         'digital__pump3__amount', ROUND(x.premium_l * x.premium_price, 2),
         'digital__pump4__product', 'e10',
         'digital__pump4__beginning', 4000 + (x.day_offset * 40),
         'digital__pump4__ending', 4000 + (x.day_offset * 40) + x.e10_l,
         'digital__pump4__consumed', x.e10_l,
         'digital__pump4__amount', ROUND(x.e10_l * x.e10_price, 2),
         'expense__0__description', x.expense_note,
         'expense__0__liters', 0,
         'expense__0__amount', x.expenses,
         'expense__1__description', 'Cashier end-shift note',
         'expense__1__liters', 0,
         'expense__1__amount', 0,
         'expense__1__note', 'Mock demo data: cashier reported small denomination changes at end shift.',
         'total_cash_expected', x.expected_sales,
         'total_expenses', x.expenses,
         'actual_cash_remitted', ROUND(x.expected_sales - x.expenses + x.over_short, 2),
         'inv__diesel_7kl__beginning__l', x.diesel_stock + x.diesel_l,
         'inv__diesel_7kl__ending__l', x.diesel_stock,
         'inv__diesel_7kl__beginning__cm', ROUND((x.diesel_stock + x.diesel_l) / 70, 2),
         'inv__diesel_7kl__ending__cm', ROUND(x.diesel_stock / 70, 2),
         'inv__diesel_7kl__delivery__l', 0,
         'inv__unleaded_7_5kl__beginning__l', x.unleaded_stock + x.unleaded_l,
         'inv__unleaded_7_5kl__ending__l', x.unleaded_stock,
         'inv__unleaded_7_5kl__beginning__cm', ROUND((x.unleaded_stock + x.unleaded_l) / 75, 2),
         'inv__unleaded_7_5kl__ending__cm', ROUND(x.unleaded_stock / 75, 2),
         'inv__unleaded_7_5kl__delivery__l', 0,
         'inv__premium_10kl__beginning__l', x.premium_stock + x.premium_l,
         'inv__premium_10kl__ending__l', x.premium_stock,
         'inv__premium_10kl__beginning__cm', ROUND((x.premium_stock + x.premium_l) / 100, 2),
         'inv__premium_10kl__ending__cm', ROUND(x.premium_stock / 100, 2),
         'inv__premium_10kl__delivery__l', 0,
         'inv__diesel_10kl__beginning__l', x.e10_stock + x.e10_l,
         'inv__diesel_10kl__ending__l', x.e10_stock,
         'inv__diesel_10kl__beginning__cm', ROUND((x.e10_stock + x.e10_l) / 100, 2),
         'inv__diesel_10kl__ending__cm', ROUND(x.e10_stock / 100, 2),
         'inv__diesel_10kl__delivery__l', 0
       ),
       u.id,
       DATE_ADD(DATE_SUB(CURDATE(), INTERVAL x.day_offset DAY), INTERVAL 16 HOUR),
       'submitted'
  FROM (
    SELECT d.*,
           COALESCE(bpd.price, fd.price) AS diesel_price,
           COALESCE(bpu.price, fu.price) AS unleaded_price,
           COALESCE(bpp.price, fp.price) AS premium_price,
           COALESCE(bpe.price, fe.price) AS e10_price,
           ROUND(
             (d.diesel_l * COALESCE(bpd.price, fd.price)) +
             (d.unleaded_l * COALESCE(bpu.price, fu.price)) +
             (d.premium_l * COALESCE(bpp.price, fp.price)) +
             (d.e10_l * COALESCE(bpe.price, fe.price)),
             2
           ) AS expected_sales
      FROM mock_daily d
      JOIN fuel_types fd ON fd.id = 'diesel'
      JOIN fuel_types fu ON fu.id = 'unleaded'
      JOIN fuel_types fp ON fp.id = 'premium'
      JOIN fuel_types fe ON fe.id = 'e10'
      LEFT JOIN fuel_branch_prices bpd ON bpd.branch_id = d.branch_id AND bpd.fuel_type = 'diesel'
      LEFT JOIN fuel_branch_prices bpu ON bpu.branch_id = d.branch_id AND bpu.fuel_type = 'unleaded'
      LEFT JOIN fuel_branch_prices bpp ON bpp.branch_id = d.branch_id AND bpp.fuel_type = 'premium'
      LEFT JOIN fuel_branch_prices bpe ON bpe.branch_id = d.branch_id AND bpe.fuel_type = 'e10'
  ) x
  JOIN users u ON u.email = x.manager_email;

-- Submitted weekly reports for owner notifications.
INSERT INTO weekly_reports
  (branch_id, week_start, week_end, total_sales, total_expenses, total_liters, submitted_by, submitted_at, status)
SELECT d.branch_id,
       DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AS week_start,
       DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY) AS week_end,
       ROUND(SUM(d.total_cash_expected), 2),
       ROUND(SUM(d.total_expenses), 2),
       ROUND(SUM(
         COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump1__consumed"')) AS DECIMAL(10,2)), 0) +
         COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump2__consumed"')) AS DECIMAL(10,2)), 0) +
         COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump3__consumed"')) AS DECIMAL(10,2)), 0) +
         COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump4__consumed"')) AS DECIMAL(10,2)), 0)
       ), 2),
       MIN(d.submitted_by),
       NOW(),
       'submitted'
  FROM daily_entries d
 WHERE d.duty_personnel = 'Mock Demo Personnel'
   AND d.entry_date BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
                        AND DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)
 GROUP BY d.branch_id
HAVING NOT EXISTS (
  SELECT 1
    FROM weekly_reports wr
   WHERE wr.branch_id = d.branch_id
     AND wr.week_start = DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
     AND wr.week_end = DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)
);

UPDATE weekly_reports wr
  JOIN (
    SELECT d.branch_id,
           ROUND(SUM(
             COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump1__consumed"')) AS DECIMAL(10,2)), 0) +
             COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump2__consumed"')) AS DECIMAL(10,2)), 0) +
             COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump3__consumed"')) AS DECIMAL(10,2)), 0) +
             COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(d.payload_json, '$."digital__pump4__consumed"')) AS DECIMAL(10,2)), 0)
           ), 2) AS total_liters
      FROM daily_entries d
     WHERE d.duty_personnel = 'Mock Demo Personnel'
       AND d.entry_date BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
                            AND DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)
     GROUP BY d.branch_id
  ) x ON x.branch_id = wr.branch_id
   SET wr.total_liters = x.total_liters
 WHERE wr.week_start = DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
   AND wr.week_end = DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY)
   AND wr.status = 'submitted'
   AND wr.total_liters = 0;

-- Inventory stock for forecasting. Existing real readings are kept.
DROP TEMPORARY TABLE IF EXISTS mock_stock;
CREATE TEMPORARY TABLE mock_stock (
  branch_id VARCHAR(10) NOT NULL,
  fuel_type VARCHAR(20) NOT NULL,
  current_liters DECIMAL(12,2) NOT NULL,
  last_cm DECIMAL(8,2) NOT NULL,
  capacity_liters DECIMAL(12,2) NOT NULL,
  liters_per_cm DECIMAL(12,4) NOT NULL
);

INSERT INTO mock_stock (branch_id, fuel_type, current_liters, last_cm, capacity_liters, liters_per_cm) VALUES
  ('b1', 'diesel',   6030.00, 86.14,  7000, 70),
  ('b1', 'unleaded', 5660.00, 75.47,  7500, 75),
  ('b1', 'premium',  7480.00, 74.80, 10000, 100),
  ('b1', 'e10',      8120.00, 81.20, 10000, 100),
  ('b2', 'diesel',   5340.00, 76.29,  7000, 70),
  ('b2', 'unleaded', 6210.00, 82.80,  7500, 75),
  ('b2', 'premium',  7050.00, 70.50, 10000, 100),
  ('b2', 'e10',      7650.00, 76.50, 10000, 100),
  ('b3', 'diesel',   4925.00, 70.36,  7000, 70),
  ('b3', 'unleaded', 5880.00, 78.40,  7500, 75),
  ('b3', 'premium',  6920.00, 69.20, 10000, 100),
  ('b3', 'e10',      7210.00, 72.10, 10000, 100),
  ('b4', 'diesel',   4550.00, 65.00,  7000, 70),
  ('b4', 'unleaded', 5445.00, 72.60,  7500, 75),
  ('b4', 'premium',  6690.00, 66.90, 10000, 100),
  ('b4', 'e10',      6880.00, 68.80, 10000, 100);

INSERT INTO fuel_calibration_profiles
  (branch_id, fuel_type, tank_name, tank_capacity_liters, liters_per_cm, critical_liters, max_height_cm, active, updated_by)
SELECT s.branch_id,
       s.fuel_type,
       CONCAT(f.name, ' Tank'),
       s.capacity_liters,
       s.liters_per_cm,
       1000,
       ROUND(s.capacity_liters / s.liters_per_cm, 2),
       1,
       @mock_owner_id
  FROM mock_stock s
  JOIN fuel_types f ON f.id = s.fuel_type
 WHERE 1 = 1
ON DUPLICATE KEY UPDATE updated_at = updated_at;

INSERT INTO fuel_inventory_levels
  (branch_id, fuel_type, current_liters, last_measurement_cm, last_measured_at)
SELECT s.branch_id, s.fuel_type, s.current_liters, s.last_cm, NOW()
  FROM mock_stock s
 WHERE 1 = 1
ON DUPLICATE KEY UPDATE updated_at = updated_at;

INSERT INTO fuel_inventory_movements
  (branch_id, fuel_type, movement_type, liters_delta, liters_before, liters_after,
   reference_type, reference_id, notes, encoded_by, created_at)
SELECT s.branch_id,
       s.fuel_type,
       'measurement_set',
       0,
       s.current_liters,
       s.current_liters,
       'mock_seed',
       CONCAT('MOCK-STOCK-', s.branch_id, '-', s.fuel_type),
       'Mock demo data: starting inventory level for forecasting.',
       @mock_owner_id,
       NOW()
  FROM mock_stock s;

-- Fuel price requests for manager review and history.
INSERT INTO fuel_price_requests
  (branch_id, fuel_type, base_price, current_branch_price, requested_price, reason,
   status, requested_by, requested_at, reviewed_by, reviewed_at, review_note)
SELECT 'b1',
       'diesel',
       f.price,
       COALESCE(bp.price, f.price),
       ROUND(COALESCE(bp.price, f.price) - 0.40, 2),
       'Mock demo data: Nearby competitor lowered diesel price this morning.',
       'pending',
       c.id,
       DATE_SUB(NOW(), INTERVAL 2 HOUR),
       NULL,
       NULL,
       NULL
  FROM fuel_types f
  LEFT JOIN fuel_branch_prices bp ON bp.branch_id = 'b1' AND bp.fuel_type = 'diesel'
  JOIN users c ON c.email = 'cashier1@greenfuel.local'
 WHERE f.id = 'diesel';

INSERT INTO fuel_price_requests
  (branch_id, fuel_type, base_price, current_branch_price, requested_price, reason,
   status, requested_by, requested_at, reviewed_by, reviewed_at, review_note)
SELECT 'b2',
       'unleaded',
       f.price,
       COALESCE(bp.price, f.price),
       ROUND(COALESCE(bp.price, f.price) + 0.25, 2),
       'Mock demo data: Supplier delivery cost increased for the branch.',
       'approved',
       c.id,
       DATE_SUB(NOW(), INTERVAL 4 DAY),
       m.id,
       DATE_SUB(NOW(), INTERVAL 3 DAY),
       'Approved for branch pricing history demo.'
  FROM fuel_types f
  LEFT JOIN fuel_branch_prices bp ON bp.branch_id = 'b2' AND bp.fuel_type = 'unleaded'
  JOIN users c ON c.email = 'cashier2@greenfuel.local'
  JOIN users m ON m.email = 'manager2@greenfuel.local'
 WHERE f.id = 'unleaded';

INSERT INTO fuel_price_requests
  (branch_id, fuel_type, base_price, current_branch_price, requested_price, reason,
   status, requested_by, requested_at, reviewed_by, reviewed_at, review_note)
SELECT 'b3',
       'premium',
       f.price,
       COALESCE(bp.price, f.price),
       ROUND(COALESCE(bp.price, f.price) + 2.00, 2),
       'Mock demo data: Requested price was above the owner ceiling.',
       'rejected',
       c.id,
       DATE_SUB(NOW(), INTERVAL 6 DAY),
       m.id,
       DATE_SUB(NOW(), INTERVAL 5 DAY),
       'Rejected because it exceeds the approved ceiling price.'
  FROM fuel_types f
  LEFT JOIN fuel_branch_prices bp ON bp.branch_id = 'b3' AND bp.fuel_type = 'premium'
  JOIN users c ON c.email = 'cashier3@greenfuel.local'
  JOIN users m ON m.email = 'manager1@greenfuel.local'
 WHERE f.id = 'premium';

-- Audit trail samples.
INSERT INTO audit_logs
  (actor_id, actor_role, action, entity_type, entity_id, details_json, ip_address, created_at)
SELECT @mock_owner_id,
       'owner',
       'mock_owner_review',
       'weekly_report',
       CONCAT('MOCK-WEEKLY-', branch_id),
       JSON_OBJECT('note', 'Mock demo data: owner received submitted weekly report notification.'),
       '127.0.0.1',
       NOW()
  FROM weekly_reports
 WHERE status = 'submitted'
 ORDER BY submitted_at DESC
 LIMIT 2;

INSERT INTO audit_logs
  (actor_id, actor_role, action, entity_type, entity_id, details_json, ip_address, created_at)
SELECT id,
       'manager',
       'mock_shift_verification',
       'shift_record',
       'MOCK-SHIFT-PENDING',
       JSON_OBJECT('note', 'Mock demo data: manager has a pending cashier shift to verify.'),
       '127.0.0.1',
       NOW()
  FROM users
 WHERE email = 'manager1@greenfuel.local'
 LIMIT 1;

