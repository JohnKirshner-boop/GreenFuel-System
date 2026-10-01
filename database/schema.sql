-- ============================================================
-- GreenFuel Centralized System — Database Schema
-- Run this once in phpMyAdmin or MySQL CLI:
--   mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS greenfuel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE greenfuel;

-- ------------------------------------------------------------
-- BRANCHES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id         VARCHAR(10)  PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  location   VARCHAR(150) NOT NULL,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO branches (id, name, location) VALUES
  ('b1', 'GMA Cavite',    'GMA, Cavite'),
  ('b2', 'Santa Rosa',    'Santa Rosa, Laguna'),
  ('b3', 'Biñan Station', 'Biñan, Laguna'),
  ('b4', 'Batangas',      'Batangas');

-- ------------------------------------------------------------
-- FUEL TYPES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_types (
  id    VARCHAR(20)  PRIMARY KEY,
  name  VARCHAR(50)  NOT NULL,
  price DECIMAL(8,2) NOT NULL,
  color VARCHAR(10)  NOT NULL DEFAULT '#16a34a'
);

INSERT IGNORE INTO fuel_types (id, name, price, color) VALUES
  ('diesel',   'Diesel',      65.50, '#2563eb'),
  ('unleaded', 'Unleaded 91', 68.75, '#16a34a'),
  ('premium',  'Premium 95',  74.50, '#d97706'),
  ('e10',      'E10 Blend',   63.00, '#9333ea');

-- ------------------------------------------------------------
-- SYSTEM SETTINGS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key   VARCHAR(64)  PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  description   VARCHAR(255) NULL,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES ('pos_vat_rate', '12', 'VAT rate extracted from VAT-inclusive POS fuel transactions.')
ON DUPLICATE KEY UPDATE setting_value = setting_value;

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(50)  NOT NULL UNIQUE,
  email      VARCHAR(120) NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  name       VARCHAR(100) NOT NULL,
  role       ENUM('owner','manager','cashier') NOT NULL,
  account_status ENUM('pending','active','deactivated') NOT NULL DEFAULT 'active',
  branch_id  VARCHAR(10)  NULL,
  profile_image LONGTEXT  NULL,
  theme_preference VARCHAR(20) NOT NULL DEFAULT 'light',
  last_login_at DATETIME  NULL,
  last_seen_at  DATETIME  NULL,
  activated_at DATETIME    NULL,
  activated_by INT         NULL,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- Seed passwords are bcrypt hashes. Change these before production use.
INSERT IGNORE INTO users (username, email, password, name, role, branch_id) VALUES
  ('admin',    'owner@greenfuel.local',    '$2y$10$RjinHCFdGltHkY7eD7N5B.GCL.99CMOpTuNaL2cBtg9f5ltsWeSAW', 'Admin Owner',    'owner',   NULL),
  ('manager1', 'manager1@greenfuel.local', '$2y$10$LALI.FyFzi5rGp3m8YPaNu5fMorXeTk/CwnRXMgofM9NW.UGooldu', 'Maria Santos',   'manager', 'b1'),
  ('manager2', 'manager2@greenfuel.local', '$2y$10$H7V5kuuG0vokv1KiHExebee7fXBaHv0DylugJ3ehM9fGWCkw83hpe', 'Juan Dela Cruz', 'manager', 'b2'),
  ('cashier1', 'cashier1@greenfuel.local', '$2y$10$eehdACmnvw2yWuSmgiraX.pbS3OItBbPbcPZL0dseBaCsTyjJrc.W', 'Ana Reyes',      'cashier', 'b1'),
  ('cashier2', 'cashier2@greenfuel.local', '$2y$10$UyjQ/MLoi.zoBDFra0PZDugo5H/0eZw0oERuWqOq4a6zozLvzXguW', 'Pedro Lim',      'cashier', 'b2');

CREATE TABLE IF NOT EXISTS user_branches (
  user_id    INT         NOT NULL,
  branch_id  VARCHAR(10) NOT NULL,
  is_primary TINYINT(1)  NOT NULL DEFAULT 0,
  created_at DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, branch_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

INSERT IGNORE INTO user_branches (user_id, branch_id, is_primary)
SELECT id, branch_id, 1
  FROM users
 WHERE role IN ('manager','cashier')
   AND branch_id IS NOT NULL
   AND branch_id <> '';

CREATE TABLE IF NOT EXISTS password_resets (
  id           INT       AUTO_INCREMENT PRIMARY KEY,
  user_id      INT       NOT NULL,
  token_hash   CHAR(64)  NOT NULL,
  expires_at   DATETIME  NOT NULL,
  used_at      DATETIME  NULL,
  requested_ip VARCHAR(45) NULL,
  created_at   DATETIME  DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_password_resets_token (token_hash),
  KEY idx_password_resets_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- BRANCH-SPECIFIC APPROVED FUEL PRICES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_branch_prices (
  branch_id           VARCHAR(10)  NOT NULL,
  fuel_type           VARCHAR(20)  NOT NULL,
  price               DECIMAL(8,2) NOT NULL,
  approved_request_id INT          NULL,
  approved_by         INT          NULL,
  approved_at         DATETIME     NULL,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_id, fuel_type),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (fuel_type) REFERENCES fuel_types(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS fuel_price_requests (
  id                   INT          AUTO_INCREMENT PRIMARY KEY,
  branch_id            VARCHAR(10)  NOT NULL,
  fuel_type            VARCHAR(20)  NOT NULL,
  base_price           DECIMAL(8,2) NOT NULL,
  current_branch_price DECIMAL(8,2) NULL,
  requested_price      DECIMAL(8,2) NOT NULL,
  reason               TEXT         NULL,
  status               ENUM('pending','approved','rejected') DEFAULT 'pending',
  requested_by         INT          NULL,
  requested_at         DATETIME     DEFAULT CURRENT_TIMESTAMP,
  reviewed_by          INT          NULL,
  reviewed_at          DATETIME     NULL,
  review_note          TEXT         NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (fuel_type) REFERENCES fuel_types(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- TRANSACTIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id              VARCHAR(20)   PRIMARY KEY,
  branch_id       VARCHAR(10)   NOT NULL,
  fuel_type       VARCHAR(20)   NOT NULL,
  liters          DECIMAL(10,4) NOT NULL,
  price_per_liter DECIMAL(8,2)  NOT NULL,
  total_amount    DECIMAL(12,2) NOT NULL,
  amount_paid     DECIMAL(12,2) DEFAULT 0,
  subtotal_amount DECIMAL(12,2) DEFAULT 0,
  tax_rate        DECIMAL(6,2)  DEFAULT 0,
  tax_amount      DECIMAL(12,2) DEFAULT 0,
  cash_received   DECIMAL(12,2) DEFAULT 0,
  change_amount   DECIMAL(12,2) DEFAULT 0,
  customer        VARCHAR(100)  DEFAULT 'Walk-in',
  cashier_id      INT           NULL,
  shift_session_id INT          NULL,
  status          ENUM('pending','verified','flagged','recalibrated','void') DEFAULT 'pending',
  void_reason     TEXT          NULL,
  voided_by       INT           NULL,
  voided_at       DATETIME      NULL,
  timestamp       DATETIME      NOT NULL,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id)  REFERENCES branches(id),
  FOREIGN KEY (fuel_type)  REFERENCES fuel_types(id),
  FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (voided_by)  REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_branch    ON transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_tx_fuel      ON transactions(fuel_type);
CREATE INDEX IF NOT EXISTS idx_tx_status    ON transactions(status);

-- ------------------------------------------------------------
-- CASH DENOMINATIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_denominations (
  id         INT          AUTO_INCREMENT PRIMARY KEY,
  value      DECIMAL(8,2) NOT NULL UNIQUE,
  label      VARCHAR(20)  NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  active     TINYINT(1)   NOT NULL DEFAULT 1
);

INSERT IGNORE INTO cash_denominations (value, label, sort_order) VALUES
  (1000, 'P1000', 1),
  (500,  'P500',  2),
  (200,  'P200',  3),
  (100,  'P100',  4),
  (50,   'P50',   5),
  (20,   'P20',   6),
  (10,   'P10',   7),
  (5,    'P5',    8),
  (1,    'P1',    9);

-- ------------------------------------------------------------
-- SHIFT SESSIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shift_sessions (
  id           INT           AUTO_INCREMENT PRIMARY KEY,
  branch_id    VARCHAR(10)   NOT NULL,
  cashier_id   INT           NOT NULL,
  start_time   DATETIME      NOT NULL,
  end_time     DATETIME      NULL,
  total_sales  DECIMAL(12,2) DEFAULT 0,
  total_liters DECIMAL(10,2) DEFAULT 0,
  total_cash   DECIMAL(12,2) DEFAULT 0,
  cashier_note TEXT          NULL,
  status       ENUM('open','closed','submitted') DEFAULT 'open',
  created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id)  REFERENCES branches(id),
  FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shift_cash_breakdown (
  id             INT           AUTO_INCREMENT PRIMARY KEY,
  shift_session_id INT         NOT NULL,
  denomination_id INT          NOT NULL,
  denomination_value DECIMAL(8,2) NOT NULL,
  quantity       INT           NOT NULL DEFAULT 0,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at     DATETIME      DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shift_cash_breakdown (shift_session_id, denomination_id),
  FOREIGN KEY (shift_session_id) REFERENCES shift_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
);

-- ------------------------------------------------------------
-- TRANSACTION CASH BREAKDOWN
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_cash_breakdown (
  id             INT           AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(20)   NOT NULL,
  denomination_id INT          NOT NULL,
  denomination_value DECIMAL(8,2) NOT NULL,
  quantity       INT           NOT NULL DEFAULT 0,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
);

CREATE TABLE IF NOT EXISTS transaction_change_breakdown (
  id             INT           AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(20)   NOT NULL,
  denomination_id INT          NOT NULL,
  denomination_value DECIMAL(8,2) NOT NULL,
  quantity       INT           NOT NULL DEFAULT 0,
  amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (denomination_id) REFERENCES cash_denominations(id)
);

-- ------------------------------------------------------------
-- VOID LOGS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS void_logs (
  id             INT          AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(20)  NOT NULL,
  reason         TEXT         NOT NULL,
  voided_by      INT          NULL,
  voided_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- SHIFT RECORDS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shift_records (
  id           VARCHAR(40)   PRIMARY KEY,
  branch_id    VARCHAR(10)   NOT NULL,
  date         DATE          NOT NULL,
  shift        ENUM('Morning','Afternoon','Night') NOT NULL,
  shift_session_id INT       NULL,
  start_time    DATETIME     NULL,
  end_time      DATETIME     NULL,
  cashier_id   INT           NULL,
  total_sales  DECIMAL(12,2) DEFAULT 0,
  total_liters DECIMAL(10,2) DEFAULT 0,
  status       ENUM('Pending','Verified','Recalibrated','Flagged') DEFAULT 'Pending',
  remarks      TEXT          NULL,
  cashier_note TEXT          NULL,
  verified_by  INT           NULL,
  verified_at  DATETIME      NULL,
  created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id)   REFERENCES branches(id),
  FOREIGN KEY (cashier_id)  REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- WEEKLY REPORTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_reports (
  id             INT           AUTO_INCREMENT PRIMARY KEY,
  branch_id      VARCHAR(10)   NOT NULL,
  week_start     DATE          NOT NULL,
  week_end       DATE          NOT NULL,
  total_sales    DECIMAL(12,2) DEFAULT 0,
  total_expenses DECIMAL(12,2) DEFAULT 0,
  total_liters   DECIMAL(10,2) DEFAULT 0,
  submitted_by   INT           NULL,
  submitted_at   DATETIME      NULL,
  status         ENUM('draft','submitted','approved') DEFAULT 'draft',
  FOREIGN KEY (branch_id)    REFERENCES branches(id),
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------
-- DAILY MANAGER ENTRIES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_entries (
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
);

CREATE INDEX IF NOT EXISTS idx_daily_entries_branch_date ON daily_entries(branch_id, entry_date);

-- ------------------------------------------------------------
-- AUDIT LOGS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGINT       AUTO_INCREMENT PRIMARY KEY,
  actor_id     INT          NULL,
  actor_role   VARCHAR(30)  NULL,
  action       VARCHAR(80)  NOT NULL,
  entity_type  VARCHAR(80)  NULL,
  entity_id    VARCHAR(120) NULL,
  details_json JSON         NULL,
  ip_address   VARCHAR(45)  NULL,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_actor (actor_id),
  KEY idx_audit_action (action),
  KEY idx_audit_created (created_at),
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);
