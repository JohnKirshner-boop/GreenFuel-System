<?php
// backend/routes/settings.php
// GET  ?action=list
// POST ?action=update { setting_key, setting_value } (owner only)

require_once __DIR__ . '/../config.php';
$user   = requireAuth();
$action = $_GET['action'] ?? 'list';
$db     = getDB();

function settingsEnsure(PDO $db): void {
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

settingsEnsure($db);

switch ($action) {
    case 'list': {
        $rows = $db->query('SELECT setting_key, setting_value FROM system_settings')->fetchAll();
        $settings = [];
        foreach ($rows as $row) {
            $settings[$row['setting_key']] = $row['setting_value'];
        }
        jsonSuccess($settings);
    }

    case 'update': {
        requireRole('owner');
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonError('POST required', 405);
        requireCsrf();
        $b = getBody();
        $key = trim($b['setting_key'] ?? '');
        $value = trim((string)($b['setting_value'] ?? ''));
        if ($key !== 'pos_vat_rate') jsonError('Unsupported setting.');
        if ($value === '' || !is_numeric($value)) jsonError('Enter a valid tax rate.');
        $rate = round((float)$value, 2);
        if ($rate < 0 || $rate > 100) jsonError('Tax rate must be between 0 and 100.');
        $stmt = $db->prepare(
            'UPDATE system_settings
             SET setting_value=?
             WHERE setting_key=?'
        );
        $stmt->execute([(string)$rate, $key]);
        auditLog($db, $user, 'setting_update', 'system_setting', $key, ['value' => $rate]);
        jsonSuccess(['pos_vat_rate' => $rate], 'Setting updated.');
    }

    default:
        jsonError('Unknown action.', 404);
}
