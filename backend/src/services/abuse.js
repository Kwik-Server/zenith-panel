// Abuse automation: pull provider reports (Leaseweb API + mailbox), match the reported IPs
// to VPS, open a WHMCS ticket with a deadline shorter than the provider's, and suspend the
// VPS if that deadline passes. Every automatic step is gated by settings, and anything the
// automation can't decide safely lands in status 'review' with an admin alert.
import crypto from 'crypto';
import { query, queryOne } from '../config/database.js';
import { redis } from '../config/redis.js';
import { callWhmcs, logWhmcsActivity } from './whmcs.js';
import { addVpsJob } from './queue.js';
import { logAction } from './audit.js';
import * as lsw from './leaseweb-abuse.js';
import { scanMailbox, parseAbuseEmail, isTrustedSender, extractIps } from './abuse-mailbox.js';

const H = 3600 * 1000;
const LOCK_KEY = 'zenith:abuse:cycle-lock';
const MAIL_SEEN_PREFIX = 'zenith:abuse:mail:';

export const ABUSE_DEFAULTS = {
  abuse_enabled:               'false',
  abuse_auto_suspend:          'true',
  abuse_client_ratio:          '0.5',
  abuse_min_client_hours:      '2',
  abuse_suspend_margin_hours:  '1',
  abuse_default_window_hours:  '24',
  abuse_max_suspends_per_hour: '5',
  abuse_whmcs_deptid:          '',
  abuse_whmcs_admin_username:  '',
  abuse_provider_updates:      'true',
  abuse_imap_host:             '',
  abuse_imap_port:             '993',
  abuse_imap_secure:           'true',
  abuse_imap_user:             '',
  abuse_imap_pass:             '',
  abuse_imap_folder:           'INBOX',
  abuse_imap_senders:          'leaseweb.com',
  abuse_imap_require_dkim:     'true',
  abuse_ticket_subject:        'Abuse report for {ip} – action required by {client_deadline}',
  abuse_ticket_template: `Dear customer,

Our upstream network provider has received an abuse complaint about your server **{ip}** ({hostname}, service #{service_id}).

- **Type:** {abuse_type}
- **Report reference:** {provider} #{report_id}

Please stop the reported activity and reply to this ticket with the cause and the steps you have taken **before {client_deadline}**.

If we do not receive a satisfactory reply by then, the server will be **suspended automatically** without further notice to protect our network. Repeated complaints may lead to termination under our Terms of Service.

If you believe this report is incorrect, reply to this ticket before the deadline with your explanation.

The full report is included below.

{report_body}`,
  abuse_suspend_template: `The deadline for abuse report {provider} #{report_id} on {ip} has passed without resolution, so the server has been suspended.

Reply to this ticket with the cause of the abuse and the steps taken to prevent it, and we will review reactivation.`,
};

export async function getAbuseConfig() {
  const rows = await query("SELECT `key`, value FROM settings WHERE `key` LIKE 'abuse_%'");
  const raw = { ...ABUSE_DEFAULTS };
  for (const r of rows) if (r.value !== null && r.value !== '') raw[r.key] = r.value;
  const num = (k, min) => {
    const n = parseFloat(raw[k]);
    return Number.isFinite(n) && n >= min ? n : parseFloat(ABUSE_DEFAULTS[k]);
  };
  return {
    raw,
    enabled:            raw.abuse_enabled === 'true',
    autoSuspend:        raw.abuse_auto_suspend === 'true',
    ratio:              Math.min(num('abuse_client_ratio', 0.05), 0.95),
    minClientHours:     num('abuse_min_client_hours', 0),
    marginHours:        num('abuse_suspend_margin_hours', 0),
    defaultWindowHours: num('abuse_default_window_hours', 1),
    maxSuspendsPerHour: num('abuse_max_suspends_per_hour', 0), // 0 = no limit
    deptId:             raw.abuse_whmcs_deptid,
    adminUsername:      raw.abuse_whmcs_admin_username,
    providerUpdates:    raw.abuse_provider_updates === 'true',
    imap: {
      host:   raw.abuse_imap_host,
      port:   parseInt(raw.abuse_imap_port) || 993,
      secure: raw.abuse_imap_secure !== 'false',
      user:   raw.abuse_imap_user,
      pass:   raw.abuse_imap_pass,
      folder: raw.abuse_imap_folder || 'INBOX',
    },
    senders:     raw.abuse_imap_senders.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean),
    requireDkim: raw.abuse_imap_require_dkim !== 'false',
    templates: {
      subject: raw.abuse_ticket_subject,
      ticket:  raw.abuse_ticket_template,
      suspend: raw.abuse_suspend_template,
    },
  };
}

// The client gets `ratio` of the provider's remaining window (never less than
// minClientHours), but the deadline always falls at least marginHours before the
// provider's, so there is time left to suspend and report back.
export function computeClientDeadline(now, providerDeadline, cfg) {
  const provider = providerDeadline instanceof Date && !isNaN(providerDeadline)
    ? providerDeadline
    : new Date(now.getTime() + cfg.defaultWindowHours * H);
  const windowMs = provider.getTime() - now.getTime();
  const target = now.getTime() + Math.max(windowMs * cfg.ratio, cfg.minClientHours * H);
  const latest = provider.getTime() - cfg.marginHours * H;
  return new Date(Math.max(Math.min(target, latest), now.getTime()));
}

export const fmtUtc = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'n/a');
const render = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
const toDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
const fingerprint = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8);
const providerName = (p) => (p === 'leaseweb' ? 'Leaseweb' : p);

async function saveSetting(key, value) {
  await query('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [key, value, value]);
}

async function updateCase(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await query(`UPDATE abuse_cases SET ${keys.map(k => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...keys.map(k => fields[k]), id]);
}

async function alertAdmin(subject, message) {
  console.warn(`[abuse] ${subject} — ${message}`);
  try {
    await callWhmcs('SendAdminEmail', {
      customsubject: `[Zenith Abuse] ${subject}`,
      custommessage: String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
      type:          'system',
    });
  } catch (err) {
    console.warn('[abuse] admin alert email failed:', err.message);
  }
}

export async function loadCase(id) {
  return queryOne(
    `SELECT c.*, r.provider, r.external_id, r.source, r.api_pool_id, r.subject AS report_subject,
            r.abuse_type, r.body AS report_body, r.reported_ips, r.provider_status, r.provider_deadline,
            r.reported_at, v.hostname, v.uuid AS vps_uuid, v.status AS vps_status,
            v.whmcs_service_id AS vps_service_id, u.email AS user_email
     FROM abuse_cases c
     JOIN abuse_reports r ON r.id = c.report_id
     LEFT JOIN vps v   ON v.id = c.vps_id
     LEFT JOIN users u ON u.id = v.user_id
     WHERE c.id = ?`,
    [id]
  );
}

async function toReview(c, reason) {
  await updateCase(c.id, { status: 'review', last_error: reason });
  await alertAdmin(`Needs review: ${providerName(c.provider)} #${c.external_id} (${c.ip_address || 'no IP'})`,
    `${reason}\n\nVPS: ${c.hostname || '—'} (id ${c.vps_id || '—'})\nClient: ${c.user_email || '—'}`);
  return { status: 'review', reason };
}

export async function providerKeyForCase(c) {
  if (c.provider !== 'leaseweb' || c.source !== 'api' || !c.api_pool_id) return null;
  const pool = await queryOne('SELECT leaseweb_api_key FROM ip_pools WHERE id = ?', [c.api_pool_id]);
  return pool?.leaseweb_api_key || null;
}

// Reports that came in by email can't be answered through the API; the admin replies in
// the Leaseweb portal instead. Failures here must never block the client-side flow.
async function postProviderUpdate(c, cfg, text) {
  if (!cfg.providerUpdates) return;
  try {
    const key = await providerKeyForCase(c);
    if (key) await lsw.postMessage(key, c.external_id, text);
  } catch (err) {
    console.warn(`[abuse] posting update to ${c.provider} #${c.external_id} failed:`, err.message);
  }
}

function caseVars(c, extra = {}) {
  const body = String(c.report_body || '').slice(0, 20000).replace(/```/g, "'''");
  return {
    ip:                c.ip_address,
    hostname:          c.hostname || c.ip_address,
    provider:          providerName(c.provider),
    report_id:         c.external_id,
    subject:           c.report_subject || '',
    abuse_type:        c.abuse_type || 'Not specified',
    service_id:        c.vps_service_id || c.whmcs_service_id || '',
    client_deadline:   fmtUtc(c.client_deadline),
    provider_deadline: fmtUtc(c.provider_deadline),
    report_body:       '```\n' + body + '\n```',
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------------------

export async function ingestReport(r) {
  const ips = [...new Set((r.ips || []).map(ip => String(ip).trim()).filter(Boolean))];
  const existing = await queryOne('SELECT id, source FROM abuse_reports WHERE provider = ? AND external_id = ?', [r.provider, r.externalId]);
  let reportId;
  let created = false;

  if (existing) {
    reportId = existing.id;
    // The API copy is authoritative (full body, detected IPs, replyable); upgrade an
    // email-sourced report when the API later sees it. Anything else is a duplicate.
    if (r.source !== 'api' || existing.source === 'api') return { reportId, created: false, cases: 0 };
    await query(
      `UPDATE abuse_reports SET source = 'api', api_pool_id = ?, subject = ?, abuse_type = ?, body = ?,
              reported_ips = ?, provider_status = ?, provider_deadline = ? WHERE id = ?`,
      [r.apiPoolId || null, r.subject || null, r.abuseType || null, r.body || null, JSON.stringify(ips),
       r.providerStatus || null, r.providerDeadline || null, reportId]
    );
  } else {
    const res = await query(
      `INSERT INTO abuse_reports (provider, external_id, source, api_pool_id, subject, abuse_type, body,
                                  reported_ips, provider_status, provider_deadline, reported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.provider, r.externalId, r.source, r.apiPoolId || null, r.subject || null, r.abuseType || null,
       r.body || null, JSON.stringify(ips), r.providerStatus || null, r.providerDeadline || null, r.reportedAt || null]
    );
    reportId = res.insertId;
    created = true;
  }

  const cases = await createCases(reportId, r, ips);
  return { reportId, created, cases };
}

async function createCases(reportId, r, ips) {
  const label = `${providerName(r.provider)} #${r.externalId}`;
  if (!ips.length) {
    const res = await query(`INSERT IGNORE INTO abuse_cases (report_id, ip_address, status, last_error) VALUES (?, '', 'unmatched', ?)`,
      [reportId, 'No IP address could be found in the report']);
    if (res.affectedRows) await alertAdmin(`Unmatched report ${label}`, 'No IP address could be found in the report. Review it manually.');
    return 0;
  }

  const rows = await query(`SELECT ip_address, vps_id FROM ip_addresses WHERE ip_address IN (${ips.map(() => '?').join(',')})`, ips);
  const vpsByIp = new Map(rows.filter(x => x.vps_id).map(x => [x.ip_address, x.vps_id]));
  const matchedVps = new Set();
  const unmatched = [];
  let created = 0;

  for (const ip of ips) {
    const vpsId = vpsByIp.get(ip);
    if (!vpsId) { unmatched.push(ip); continue; }
    if (matchedVps.has(vpsId)) continue;
    matchedVps.add(vpsId);
    // One case per VPS per report, even if a later source lists a different IP of it.
    if (await queryOne('SELECT id FROM abuse_cases WHERE report_id = ? AND vps_id = ?', [reportId, vpsId])) continue;
    const res = await query(`INSERT IGNORE INTO abuse_cases (report_id, vps_id, ip_address, status) VALUES (?, ?, ?, 'pending')`, [reportId, vpsId, ip]);
    created += res.affectedRows;
  }

  // API/manual reports list only the provider's own customer IPs, so an unknown one is
  // meaningful (e.g. a dedicated server outside Zenith). An email body also mentions
  // victim and relay IPs, so there we only flag it when nothing matched at all.
  if (unmatched.length && (r.source !== 'email' || !matchedVps.size)) {
    const flagged = r.source === 'email' ? [''] : unmatched;
    let fresh = 0;
    for (const ip of flagged) {
      const res = await query(`INSERT IGNORE INTO abuse_cases (report_id, ip_address, status, last_error) VALUES (?, ?, 'unmatched', ?)`,
        [reportId, ip, `Not assigned to any VPS in Zenith: ${unmatched.join(', ')}`]);
      fresh += res.affectedRows;
    }
    if (fresh) await alertAdmin(`Unmatched report ${label}`, `These reported IPs are not assigned to any VPS in Zenith: ${unmatched.join(', ')}. They may belong to a dedicated server — handle manually.`);
  }
  return created;
}

async function pollLeaseweb(summary) {
  const pools = await query("SELECT id, name, leaseweb_api_key FROM ip_pools WHERE leaseweb_api_key IS NOT NULL AND leaseweb_api_key <> ''");
  const byKey = new Map();
  for (const p of pools) {
    if (!byKey.has(p.leaseweb_api_key)) byKey.set(p.leaseweb_api_key, { poolId: p.id, pools: [] });
    byKey.get(p.leaseweb_api_key).pools.push(p.name);
  }

  const apiStatus = [];
  const openIds = new Set();
  for (const [key, info] of byKey) {
    const entry = { key: fingerprint(key), pools: info.pools, checkedAt: new Date().toISOString() };
    try {
      const reports = await lsw.listOpenReports(key);
      entry.ok = true;
      entry.open = reports.length;
      for (const s of reports) {
        openIds.add(s.id);
        const known = await queryOne("SELECT id, source FROM abuse_reports WHERE provider = 'leaseweb' AND external_id = ?", [s.id]);
        if (known?.source === 'api') {
          await query('UPDATE abuse_reports SET provider_status = ?, provider_deadline = ? WHERE id = ?', [s.status || null, toDate(s.deadline), known.id]);
          continue;
        }
        const d = await lsw.getReport(key, s.id);
        const res = await ingestReport({
          provider:         'leaseweb',
          source:           'api',
          externalId:       s.id,
          apiPoolId:        info.poolId,
          subject:          d.subject,
          abuseType:        d.abuseType,
          body:             d.body,
          ips:              d.detectedIpAddresses?.length ? d.detectedIpAddresses : extractIps(d.body),
          providerDeadline: toDate(d.deadline),
          providerStatus:   d.status,
          reportedAt:       toDate(d.reportedAt),
        });
        if (res.created) summary.ingested++;
      }
    } catch (err) {
      entry.ok = false;
      entry.http = err.status || null;
      entry.error = err.status === 401 || err.status === 403
        ? 'Abuse API access is not enabled for this key — ask Leaseweb to enable it'
        : err.message;
    }
    apiStatus.push(entry);
  }

  // Reports we still hold as open but that dropped out of every open list were closed
  // (or changed status) at Leaseweb — refresh them one by one.
  const held = await query("SELECT id, external_id, api_pool_id FROM abuse_reports WHERE provider = 'leaseweb' AND source = 'api' AND (provider_status IS NULL OR UPPER(provider_status) <> 'CLOSED')");
  for (const r of held) {
    if (openIds.has(r.external_id)) continue;
    const key = pools.find(p => p.id === r.api_pool_id)?.leaseweb_api_key;
    if (!key || !apiStatus.find(a => a.key === fingerprint(key))?.ok) continue;
    try {
      const d = await lsw.getReport(key, r.external_id);
      await query('UPDATE abuse_reports SET provider_status = ?, provider_deadline = ? WHERE id = ?', [d.status || null, toDate(d.deadline), r.id]);
    } catch (err) {
      console.warn(`[abuse] refreshing leaseweb #${r.external_id} failed:`, err.message);
    }
  }

  await saveSetting('abuse_api_status', JSON.stringify(apiStatus));
  return apiStatus;
}

async function pollMailbox(cfg, summary) {
  if (!cfg.imap.host || !cfg.imap.user) return { configured: false };
  const status = { configured: true, checkedAt: new Date().toISOString(), scanned: 0, ingested: 0, untrusted: 0 };
  try {
    status.scanned = await scanMailbox(cfg.imap, cfg.senders, async (mail) => {
      const seenKey = MAIL_SEEN_PREFIX + crypto.createHash('sha1').update(String(mail.messageId || mail.subject + mail.date)).digest('hex');
      if (await redis.exists(seenKey)) return;

      const from = mail.from?.value?.[0]?.address || '';
      const auth = [].concat(mail.headers.get('authentication-results') || [])[0];
      if (!isTrustedSender(from, cfg.senders, auth, cfg.requireDkim)) {
        status.untrusted++;
        console.warn(`[abuse] ignoring mail from ${from} ("${mail.subject}"): sender or DKIM check failed`);
      } else {
        const parsed = parseAbuseEmail({ from, subject: mail.subject, text: mail.text, html: mail.html, date: mail.date, messageId: mail.messageId });
        if (parsed.isAbuse) {
          const res = await ingestReport({ ...parsed, source: 'email' });
          if (res.created) { status.ingested++; summary.ingested++; }
        }
      }
      await redis.set(seenKey, '1', 'EX', 7 * 86400);
    });
    status.ok = true;
  } catch (err) {
    status.ok = false;
    status.error = err.message;
  }
  return status;
}

export async function createManualReport({ ip, provider, reference, subject, body, providerDeadline }) {
  const ips = extractIps(ip);
  if (!ips.length) throw new Error('Enter a valid IPv4 address');
  return ingestReport({
    provider:         String(provider || 'manual').trim().toLowerCase() || 'manual',
    source:           'manual',
    externalId:       String(reference || '').trim() || `manual-${Date.now()}`,
    subject:          subject || `Manual abuse case for ${ips.join(', ')}`,
    body:             body || '',
    ips,
    providerDeadline: toDate(providerDeadline),
    providerStatus:   'OPEN',
    reportedAt:       new Date(),
  });
}

// ---------------------------------------------------------------------------------------
// Client notification, deadlines, suspension
// ---------------------------------------------------------------------------------------

export async function notifyCase(caseId, { cfg, hours = null, actorId = null } = {}) {
  cfg = cfg || await getAbuseConfig();
  const c = await loadCase(caseId);
  if (!c) throw new Error('Case not found');
  if (!['pending', 'review'].includes(c.status)) throw new Error(`Case is ${c.status}; only pending or review cases can be notified`);
  if (c.notified_at) throw new Error('The client was already notified — extend the deadline instead');
  if (!c.vps_id) return toReview(c, 'The reported IP is not assigned to a VPS in Zenith');
  if (!c.vps_service_id) return toReview(c, 'This VPS is not linked to a WHMCS service, so no ticket can be opened — contact the client manually');
  if (!cfg.deptId) throw new Error('Set the WHMCS support department for abuse tickets in Settings → Abuse');

  const now = new Date();
  const providerDeadline = toDate(c.provider_deadline);
  let clientDeadline;
  if (hours) {
    clientDeadline = new Date(now.getTime() + hours * H);
  } else {
    if (providerDeadline && providerDeadline <= now) {
      return toReview(c, `The provider deadline (${fmtUtc(providerDeadline)}) had already passed, so the client was not notified automatically`);
    }
    clientDeadline = computeClientDeadline(now, providerDeadline, cfg);
  }

  const products = await callWhmcs('GetClientsProducts', { serviceid: c.vps_service_id });
  const product = products?.products?.product?.[0];
  if (!product?.clientid) return toReview(c, `WHMCS service #${c.vps_service_id} was not found`);

  const vars = caseVars(c, { client_deadline: fmtUtc(clientDeadline), service_id: c.vps_service_id });
  const ticket = await callWhmcs('OpenTicket', {
    deptid:    cfg.deptId,
    clientid:  product.clientid,
    serviceid: c.vps_service_id,
    subject:   render(cfg.templates.subject, vars),
    message:   render(cfg.templates.ticket, vars),
    priority:  'High',
    markdown:  true,
    admin:     true,
  });

  await updateCase(c.id, {
    status:           'notified',
    whmcs_service_id: c.vps_service_id,
    whmcs_client_id:  product.clientid,
    whmcs_ticket_id:  ticket.id,
    whmcs_ticket_tid: ticket.tid,
    client_deadline:  clientDeadline,
    notified_at:      now,
    last_error:       null,
  });

  await postProviderUpdate(c, cfg,
    `IP ${c.ip_address} is assigned to a customer virtual server. The customer was notified at ${fmtUtc(now)} and must resolve the issue by ${fmtUtc(clientDeadline)}; the server will be suspended if they do not.`);
  logWhmcsActivity(`Zenith: abuse ticket #${ticket.tid} opened for service #${c.vps_service_id} (${providerName(c.provider)} report ${c.external_id}), deadline ${fmtUtc(clientDeadline)}`);
  await logAction(actorId, 'abuse_client_notified', 'vps', c.vps_id,
    { case_id: c.id, report: `${c.provider}#${c.external_id}`, ticket: ticket.tid, client_deadline: clientDeadline }, null);
  return { status: 'notified', ticket: ticket.tid, clientDeadline };
}

export async function suspendCase(caseId, { cfg, actor = 'admin', actorId = null } = {}) {
  cfg = cfg || await getAbuseConfig();
  const c = await loadCase(caseId);
  if (!c) throw new Error('Case not found');
  if (!c.vps_id) throw new Error('No VPS is linked to this case');
  if (c.status === 'suspended') return { via: 'already suspended' };

  let via = 'already suspended';
  if (c.vps_status !== 'suspended') {
    via = null;
    // Through WHMCS first so the billing side shows the service as suspended (WHMCS then
    // calls Zenith's suspend endpoint); straight to the queue if WHMCS can't do it.
    if (c.vps_service_id) {
      try {
        await callWhmcs('ModuleSuspend', { serviceid: c.vps_service_id, suspendreason: `Abuse: ${providerName(c.provider)} report ${c.external_id}` });
        via = 'whmcs';
      } catch (err) {
        console.warn(`[abuse] WHMCS ModuleSuspend for service ${c.vps_service_id} failed, suspending directly:`, err.message);
      }
    }
    if (!via) {
      const task = await query('INSERT INTO tasks (vps_id, user_id, type, status) VALUES (?, ?, "suspend_vps", "pending")', [c.vps_id, actorId]);
      await addVpsJob('suspend_vps', { vpsId: c.vps_id, taskId: task.insertId });
      via = 'zenith';
    }
  }

  const now = new Date();
  await updateCase(c.id, { status: 'suspended', suspended_at: now, suspended_by: actor, last_error: null });

  if (c.whmcs_ticket_id) {
    try {
      await callWhmcs('AddTicketReply', {
        ticketid:      c.whmcs_ticket_id,
        message:       render(cfg.templates.suspend, caseVars(c)),
        markdown:      true,
        adminusername: cfg.adminUsername || undefined,
      });
    } catch (err) {
      console.warn(`[abuse] ticket reply on #${c.whmcs_ticket_tid} failed:`, err.message);
    }
  }
  await postProviderUpdate(c, cfg, `The customer did not resolve the issue in time. The virtual server using ${c.ip_address} was suspended at ${fmtUtc(now)}.`);
  await logAction(actorId, 'abuse_vps_suspended', 'vps', c.vps_id, { case_id: c.id, report: `${c.provider}#${c.external_id}`, by: actor, via }, null);
  if (actor === 'auto') {
    await alertAdmin(`VPS suspended: ${c.hostname} (${c.ip_address})`,
      `The client deadline ${fmtUtc(c.client_deadline)} passed for ${providerName(c.provider)} report #${c.external_id}; the VPS was suspended (via ${via}).\nProvider deadline: ${fmtUtc(c.provider_deadline)}\nClient: ${c.user_email || '—'}`);
  }
  return { via };
}

export async function unsuspendCase(caseId, { note, actorId = null } = {}) {
  const c = await loadCase(caseId);
  if (!c) throw new Error('Case not found');
  if (!c.vps_id) throw new Error('No VPS is linked to this case');
  let via = 'not suspended';
  if (c.vps_status === 'suspended') {
    via = null;
    if (c.vps_service_id) {
      try { await callWhmcs('ModuleUnsuspend', { serviceid: c.vps_service_id }); via = 'whmcs'; }
      catch (err) { console.warn('[abuse] WHMCS ModuleUnsuspend failed, unsuspending directly:', err.message); }
    }
    if (!via) {
      const task = await query('INSERT INTO tasks (vps_id, user_id, type, status) VALUES (?, ?, "unsuspend_vps", "pending")', [c.vps_id, actorId]);
      await addVpsJob('unsuspend_vps', { vpsId: c.vps_id, taskId: task.insertId });
      via = 'zenith';
    }
  }
  await updateCase(c.id, { status: 'resolved', resolved_at: new Date(), resolution_note: note || 'Unsuspended by admin', last_error: null });
  await logAction(actorId, 'abuse_vps_unsuspended', 'vps', c.vps_id, { case_id: c.id, via }, null);
  return { via };
}

export async function extendCase(caseId, hours, { actorId = null } = {}) {
  const c = await loadCase(caseId);
  if (!c) throw new Error('Case not found');
  if (!c.notified_at || !['notified', 'review'].includes(c.status)) throw new Error('Only a case whose client was notified can be extended');
  const h = parseFloat(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 720) throw new Error('Hours must be between 0 and 720');
  const base = Math.max(Date.now(), toDate(c.client_deadline)?.getTime() || 0);
  const clientDeadline = new Date(base + h * H);
  await updateCase(c.id, { status: 'notified', client_deadline: clientDeadline, last_error: null });
  await logAction(actorId, 'abuse_deadline_extended', 'vps', c.vps_id, { case_id: c.id, client_deadline: clientDeadline }, null);
  const providerDeadline = toDate(c.provider_deadline);
  return {
    clientDeadline,
    warning: providerDeadline && clientDeadline > providerDeadline
      ? `The new deadline is after the provider's (${fmtUtc(providerDeadline)}) — ask the provider for an extension`
      : null,
  };
}

export async function resolveCase(caseId, { note, actorId = null } = {}) {
  const c = await loadCase(caseId);
  if (!c) throw new Error('Case not found');
  await updateCase(c.id, { status: 'resolved', resolved_at: new Date(), resolution_note: note || null, last_error: null });
  await logAction(actorId, 'abuse_case_resolved', 'vps', c.vps_id, { case_id: c.id, note }, null);
}

async function processPending(cfg, summary) {
  const rows = await query("SELECT id, last_error FROM abuse_cases WHERE status = 'pending' ORDER BY id LIMIT 50");
  for (const r of rows) {
    try {
      const res = await notifyCase(r.id, { cfg });
      if (res.status === 'notified') summary.notified++;
    } catch (err) {
      await updateCase(r.id, { last_error: `Notification failed: ${err.message}` });
      // Alert once per failure streak, not every five minutes.
      if (!r.last_error) {
        const c = await loadCase(r.id);
        await alertAdmin(`Could not notify client for ${providerName(c.provider)} #${c.external_id}`, `${err.message}\n\nZenith retries every 5 minutes.`);
      }
    }
  }
}

async function syncTickets() {
  const rows = await query("SELECT id, whmcs_ticket_id, whmcs_ticket_tid, client_last_reply FROM abuse_cases WHERE status IN ('notified','review') AND whmcs_ticket_id IS NOT NULL LIMIT 100");
  for (const r of rows) {
    try {
      const t = await callWhmcs('GetTicket', { ticketid: r.whmcs_ticket_id });
      const replies = [].concat(t?.replies?.reply || []);
      // replies[0] is the opening message we posted; client replies carry no admin name.
      const lastClient = replies.slice(1).reverse().find(x => !x.admin);
      const lastReply = lastClient?.date || null;
      await updateCase(r.id, { whmcs_ticket_status: t.status || null, client_last_reply: lastReply });
      if (lastReply && lastReply !== r.client_last_reply) {
        const c = await loadCase(r.id);
        await alertAdmin(`Client replied on abuse ticket #${r.whmcs_ticket_tid}`,
          `${c.user_email || 'The client'} replied about ${c.ip_address}. Automatic suspension is still scheduled for ${fmtUtc(c.client_deadline)} — extend the deadline or resolve the case in Zenith if they have fixed it.`);
      }
    } catch (err) {
      console.warn(`[abuse] GetTicket ${r.whmcs_ticket_id} failed:`, err.message);
    }
  }
}

async function closeResolvedByProvider() {
  await query(
    `UPDATE abuse_cases c JOIN abuse_reports r ON r.id = c.report_id
     SET c.status = 'resolved', c.resolved_at = ?, c.resolution_note = 'Report closed by the provider'
     WHERE UPPER(r.provider_status) = 'CLOSED' AND c.status IN ('pending','notified')`,
    [new Date()]
  );
}

async function enforceDeadlines(cfg, summary) {
  const rows = await query("SELECT id, client_deadline FROM abuse_cases WHERE status = 'notified'");
  const now = Date.now();
  for (const r of rows) {
    if (!r.client_deadline || new Date(r.client_deadline).getTime() > now) continue;
    const c = await loadCase(r.id);
    if (!cfg.autoSuspend) { await toReview(c, 'The client deadline passed and automatic suspension is off — suspend or extend manually'); continue; }
    if (!c.vps_id) { await toReview(c, 'The client deadline passed but the VPS no longer exists'); continue; }
    if (cfg.maxSuspendsPerHour > 0) {
      const [{ n }] = await query("SELECT COUNT(*) AS n FROM abuse_cases WHERE suspended_by = 'auto' AND suspended_at >= ?", [new Date(now - H)]);
      if (n >= cfg.maxSuspendsPerHour) {
        await toReview(c, `The client deadline passed, but the safety limit of ${cfg.maxSuspendsPerHour} automatic suspensions per hour was reached`);
        continue;
      }
    }
    try {
      await suspendCase(c.id, { cfg, actor: 'auto' });
      summary.suspended++;
    } catch (err) {
      await updateCase(c.id, { last_error: `Automatic suspension failed: ${err.message}` });
    }
  }
}

export async function runAbuseCycle({ manual = false } = {}) {
  const token = crypto.randomUUID();
  if (!(await redis.set(LOCK_KEY, token, 'PX', 10 * 60 * 1000, 'NX'))) {
    return { skipped: 'Another abuse cycle is already running' };
  }
  try {
    const cfg = await getAbuseConfig();
    if (!cfg.enabled && !manual) return { skipped: 'Automation is disabled' };

    const summary = { startedAt: new Date().toISOString(), manual, ingested: 0, notified: 0, suspended: 0, errors: [] };
    const step = async (name, fn) => {
      try { return await fn(); }
      catch (err) { summary.errors.push(`${name}: ${err.message}`); console.error(`[abuse] ${name} failed:`, err); }
    };

    await step('leaseweb', () => pollLeaseweb(summary));
    summary.mailbox = await step('mailbox', () => pollMailbox(cfg, summary));
    await step('provider-closed', closeResolvedByProvider);
    if (cfg.enabled) {
      await step('notify', () => processPending(cfg, summary));
      await step('tickets', syncTickets);
      await step('deadlines', () => enforceDeadlines(cfg, summary));
    } else {
      summary.note = 'Automation is disabled: reports were fetched, but no clients were notified and nothing was suspended';
    }
    summary.finishedAt = new Date().toISOString();
    await saveSetting('abuse_last_run', JSON.stringify(summary));
    return summary;
  } finally {
    if ((await redis.get(LOCK_KEY)) === token) await redis.del(LOCK_KEY);
  }
}
