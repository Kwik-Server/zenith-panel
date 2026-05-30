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
    if (!whmcs_url || !whmcs_identifier || !whmcs_secret) {
      console.warn('[WHMCS] Skipping activity log — credentials not configured in settings');
      return;
    }

    const base = whmcs_url.replace(/\/$/, '');
    const body = new URLSearchParams({
      identifier:   whmcs_identifier,
      secret:       whmcs_secret,
      action:       'LogActivity',
      description,
      responsetype: 'json',
    });

    const { fetch } = await import('undici');
    const res  = await fetch(`${base}/includes/api.php`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });
    const json = await res.json().catch(() => null);
    if (json?.result !== 'success') {
      console.warn('[WHMCS] LogActivity failed:', JSON.stringify(json));
    }
  } catch (err) {
    console.warn('[WHMCS] LogActivity error:', err.message);
  }
}

// Used by the admin test endpoint to verify credentials work
export async function testWhmcsConnection() {
  const { whmcs_url, whmcs_identifier, whmcs_secret } = await getWhmcsConfig();
  if (!whmcs_url || !whmcs_identifier || !whmcs_secret) {
    throw new Error('whmcs_url, whmcs_identifier and whmcs_secret must all be set in Settings');
  }
  const base = whmcs_url.replace(/\/$/, '');
  const body = new URLSearchParams({
    identifier:   whmcs_identifier,
    secret:       whmcs_secret,
    action:       'LogActivity',
    description:  'Zenith Panel: API connection test',
    responsetype: 'json',
  });
  const { fetch } = await import('undici');
  const res  = await fetch(`${base}/includes/api.php`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  const json = await res.json();
  if (json?.result !== 'success') throw new Error(json?.message || JSON.stringify(json));
  return json;
}
