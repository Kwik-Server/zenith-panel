import { query } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

export default async function taskRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const { status, vps_id } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND t.status = ?'; params.push(status); }
    if (vps_id) { where += ' AND t.vps_id = ?'; params.push(vps_id); }
    const rows = await query(
      `SELECT t.*, v.hostname as vps_hostname FROM tasks t LEFT JOIN vps v ON t.vps_id = v.id ${where} ORDER BY t.created_at DESC LIMIT 100`,
      params
    );
    return reply.send({ success: true, data: rows });
  });

  fastify.delete('/:id/cancel', async (req, reply) => {
    await query('UPDATE tasks SET status = "cancelled" WHERE id = ? AND status = "pending"', [req.params.id]);
    return reply.send({ success: true });
  });
}
