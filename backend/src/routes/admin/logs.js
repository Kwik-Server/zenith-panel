import { query } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

export default async function logRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const { page = 1, limit = 50, action, user_id } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (action)  { where += ' AND l.action = ?';   params.push(action); }
    if (user_id) { where += ' AND l.user_id = ?';  params.push(user_id); }
    const rows = await query(
      `SELECT l.*, u.email as user_email FROM audit_logs l LEFT JOIN users u ON l.user_id = u.id ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    return reply.send({ success: true, data: rows });
  });
}
