import { query } from '../config/database.js';

async function getWhmcsConfig() {
  const rows = await query('SELECT `key`, value FROM settings WHERE `key` IN ("whmcs_url","whmcs_identifier","whmcs_secret")');
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return cfg;
}

// Fire-and-forget: logs an activity line to WHMCS Activity Log.
// Never throws — VPS operations must not fail because WHMCS is unreachable.
export async function logWhmcsActivity(description) {
  try {
    const { whmcs_url, whmcs_identifier, whmcs_secret } = await getWhmcsConfig();
    if (!whmcs_url || !whmcs_identifier || !whmcs_secret) return;

    const base = whmcs_url.replace(/\/$/, '');
    const body = new URLSearchParams({
      identifier:  whmcs_identifier,
      secret:      whmcs_secret,
      action:      'LogActivity',
      description,
      responsetype: 'json',
    });

    const { fetch } = await import('undici');
    await fetch(`${base}/includes/api.php`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
  } catch {
    // Silently ignore — WHMCS logging must never break VPS operations
  }
}
