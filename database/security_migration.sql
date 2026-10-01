-- ============================================================
-- GreenFuel security migration for existing databases
-- Run once after pulling the security update.
-- Select your GreenFuel database first in phpMyAdmin, or run:
--   mysql -u <user> -p <database_name> < security_migration.sql
-- ============================================================

-- Replace old unhashed seed-account passwords with bcrypt hashes.
-- If these accounts are already hashed, these WHERE clauses will not touch them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status ENUM('pending','active','deactivated') NOT NULL DEFAULT 'active' AFTER role;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_at DATETIME NULL AFTER last_seen_at;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_by INT NULL AFTER activated_at;

UPDATE users
   SET account_status = 'active'
 WHERE account_status IS NULL OR account_status = '';

UPDATE users
   SET password = '$2y$10$RjinHCFdGltHkY7eD7N5B.GCL.99CMOpTuNaL2cBtg9f5ltsWeSAW'
 WHERE email = 'owner@greenfuel.local'
   AND password NOT LIKE '$2y$%'
   AND password NOT LIKE '$argon2%';

UPDATE users
   SET password = '$2y$10$LALI.FyFzi5rGp3m8YPaNu5fMorXeTk/CwnRXMgofM9NW.UGooldu'
 WHERE email = 'manager1@greenfuel.local'
   AND password NOT LIKE '$2y$%'
   AND password NOT LIKE '$argon2%';

UPDATE users
   SET password = '$2y$10$H7V5kuuG0vokv1KiHExebee7fXBaHv0DylugJ3ehM9fGWCkw83hpe'
 WHERE email = 'manager2@greenfuel.local'
   AND password NOT LIKE '$2y$%'
   AND password NOT LIKE '$argon2%';

UPDATE users
   SET password = '$2y$10$eehdACmnvw2yWuSmgiraX.pbS3OItBbPbcPZL0dseBaCsTyjJrc.W'
 WHERE email = 'cashier1@greenfuel.local'
   AND password NOT LIKE '$2y$%'
   AND password NOT LIKE '$argon2%';

UPDATE users
   SET password = '$2y$10$UyjQ/MLoi.zoBDFra0PZDugo5H/0eZw0oERuWqOq4a6zozLvzXguW'
 WHERE email = 'cashier2@greenfuel.local'
   AND password NOT LIKE '$2y$%'
   AND password NOT LIKE '$argon2%';

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
