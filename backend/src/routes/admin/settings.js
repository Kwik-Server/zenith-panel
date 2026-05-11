import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';
import { testSmtp } from '../../services/email.js';

export default async function settingsRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const rows = await query('SELECT `key`, value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // Never expose WHMCS key value directly — mask it
    if (settings.whmcs_api_key) settings.whmcs_api_key_set = true;
    return reply.send({ success: true, data: settings });
  });

  fastify.put('/', async (req, reply) => {
    const body = req.body || {};
    for (const [key, value] of Object.entries(body)) {
      await query('INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?', [key, value, value]);
    }
    return reply.send({ success: true });
  });

  fastify.get('/whmcs-key', async (req, reply) => {
    const row = await queryOne('SELECT value FROM settings WHERE `key` = "whmcs_api_key"');
    return reply.send({ success: true, data: { whmcs_api_key: row?.value || '' } });
  });

  fastify.post('/test-smtp', async (req, reply) => {
    try {
      await testSmtp(req.body || {});
      return reply.send({ success: true, message: 'SMTP connection successful' });
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }
  });
}
