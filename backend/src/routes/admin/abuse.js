import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';
import * as abuse from '../../services/abuse.js';
import * as lsw from '../../services/leaseweb-abuse.js';
import { testMailboxConnection } from '../../services/abuse-mailbox.js';

const parseJson = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

export default async function abuseRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  const fail = (reply, err, code = 422) => reply.status(code).send({ success: false, error: err.message || String(err) });

  fastify.get('/', async (req, reply) => {
    const { status, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status === 'open') where += " AND c.status IN ('pending','notified','review')";
    else if (status)       { where += ' AND c.status = ?'; params.push(status); }
    if (search) {
      const like = `%${search}%`;
      where += ' AND (c.ip_address LIKE ? OR r.external_id LIKE ? OR v.hostname LIKE ? OR u.email LIKE ?)';
      params.push(like, like, like, like);
    }
    const cases = await query(
      `SELECT c.id, c.status, c.ip_address, c.vps_id, c.client_deadline, c.notified_at, c.suspended_at,
              c.suspended_by, c.resolved_at, c.whmcs_ticket_id, c.whmcs_ticket_tid, c.whmcs_ticket_status,
              c.client_last_reply, c.last_error, c.created_at,
              r.provider, r.external_id, r.source, r.subject, r.abuse_type, r.provider_deadline, r.provider_status,
              v.hostname, v.status AS vps_status, v.whmcs_service_id, u.email AS user_email
       FROM abuse_cases c
       JOIN abuse_reports r ON r.id = c.report_id
       LEFT JOIN vps v   ON v.id = c.vps_id
       LEFT JOIN users u ON u.id = v.user_id
       ${where} ORDER BY c.created_at DESC LIMIT 500`,
      params
    );
    const counts = await query('SELECT status, COUNT(*) AS n FROM abuse_cases GROUP BY status');
    return reply.send({ success: true, data: { cases, counts: Object.fromEntries(counts.map(x => [x.status, x.n])) } });
  });

  fastify.get('/status', async (req, reply) => {
    const cfg = await abuse.getAbuseConfig();
    const rows = await query("SELECT `key`, value FROM settings WHERE `key` IN ('abuse_api_status','abuse_last_run','whmcs_url')");
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const [{ n }] = await query("SELECT COUNT(DISTINCT leaseweb_api_key) AS n FROM ip_pools WHERE leaseweb_api_key IS NOT NULL AND leaseweb_api_key <> ''");
    const { abuse_ticket_subject, abuse_ticket_template, abuse_suspend_template } = abuse.ABUSE_DEFAULTS;
    return reply.send({ success: true, data: {
      enabled:          cfg.enabled,
      autoSuspend:      cfg.autoSuspend,
      deptConfigured:   !!cfg.deptId,
      imapConfigured:   !!(cfg.imap.host && cfg.imap.user),
      leasewebKeys:     n,
      apiStatus:        parseJson(s.abuse_api_status, []),
      lastRun:          parseJson(s.abuse_last_run, null),
      whmcsUrl:         (s.whmcs_url || '').replace(/\/$/, ''),
      defaults:         { abuse_ticket_subject, abuse_ticket_template, abuse_suspend_template },
    } });
  });

  fastify.post('/poll', async (req, reply) => {
    try { return reply.send({ success: true, data: await abuse.runAbuseCycle({ manual: true }) }); }
    catch (err) { return fail(reply, err, 500); }
  });

  fastify.post('/test-imap', async (req, reply) => {
    const cfg = await abuse.getAbuseConfig();
    if (!cfg.imap.host || !cfg.imap.user) return fail(reply, new Error('Save the mailbox host, user and password first'));
    try { return reply.send({ success: true, data: await testMailboxConnection(cfg.imap) }); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post('/manual', async (req, reply) => {
    try {
      const res = await abuse.createManualReport(req.body || {});
      return reply.send({ success: true, data: res });
    } catch (err) { return fail(reply, err); }
  });

  fastify.get('/:id', async (req, reply) => {
    const c = await abuse.loadCase(req.params.id);
    if (!c) return reply.status(404).send({ success: false, error: 'Case not found' });
    let providerMessages = null;
    let providerError = null;
    const key = await abuse.providerKeyForCase(c);
    if (key) {
      try { providerMessages = await lsw.listMessages(key, c.external_id); }
      catch (err) { providerError = err.message; }
    }
    const others = await query('SELECT id, ip_address, status, vps_id FROM abuse_cases WHERE report_id = ? AND id <> ?', [c.report_id, c.id]);
    return reply.send({ success: true, data: {
      ...c,
      reported_ips:     parseJson(c.reported_ips, []),
      provider_url:     c.provider === 'leaseweb' ? `https://secure.leaseweb.com/abuse-reports/${encodeURIComponent(c.external_id)}` : null,
      provider_api:     !!key,
      providerMessages,
      providerError,
      otherCases:       others,
    } });
  });

  const action = (path, fn) => fastify.post(`/:id/${path}`, async (req, reply) => {
    try { return reply.send({ success: true, data: await fn(req) }); }
    catch (err) { return fail(reply, err); }
  });

  action('notify',    (req) => abuse.notifyCase(req.params.id, { hours: parseFloat(req.body?.hours) || null, actorId: req.user.id }));
  action('extend',    (req) => abuse.extendCase(req.params.id, req.body?.hours, { actorId: req.user.id }));
  action('suspend',   (req) => abuse.suspendCase(req.params.id, { actor: 'admin', actorId: req.user.id }));
  action('unsuspend', (req) => abuse.unsuspendCase(req.params.id, { note: req.body?.note, actorId: req.user.id }));
  action('resolve',   (req) => abuse.resolveCase(req.params.id, { note: req.body?.note, actorId: req.user.id }));

  const withProviderKey = async (req) => {
    const c = await abuse.loadCase(req.params.id);
    if (!c) throw new Error('Case not found');
    const key = await abuse.providerKeyForCase(c);
    if (!key) throw new Error('This report did not come from the Leaseweb API — reply in the Leaseweb portal instead');
    return { c, key };
  };

  action('provider-message', async (req) => {
    const body = String(req.body?.body || '').trim();
    if (!body) throw new Error('Message is empty');
    const { c, key } = await withProviderKey(req);
    return lsw.postMessage(key, c.external_id, body);
  });

  fastify.get('/:id/resolutions', async (req, reply) => {
    try {
      const { c, key } = await withProviderKey(req);
      return reply.send({ success: true, data: await lsw.listResolutions(key, c.external_id) });
    } catch (err) { return fail(reply, err); }
  });

  action('provider-resolve', async (req) => {
    const resolutions = [].concat(req.body?.resolutions || []).filter(Boolean);
    if (!resolutions.length) throw new Error('Pick at least one resolution');
    const { c, key } = await withProviderKey(req);
    // Leaseweb only accepts a message when one of the report's IPs is null routed, and
    // then requires it — so follow its own isMessageRequired flag rather than the form.
    const { isMessageRequired } = await lsw.listResolutions(key, c.external_id);
    const message = String(req.body?.message || '').trim();
    if (isMessageRequired && !message) throw new Error('Leaseweb requires a message for this report because an IP is null routed');
    const res = await lsw.resolveReport(key, c.external_id, resolutions, isMessageRequired ? message : undefined);
    await query("UPDATE abuse_reports SET provider_status = 'CLOSED' WHERE id = ?", [c.report_id]);
    return res;
  });
}
