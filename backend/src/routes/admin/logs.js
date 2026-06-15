import { query } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

export default async function logRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const { page = 1, limit = 50, action, user_id, search } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (action)  { where += ' AND l.action LIKE ?';  params.push(`%${action}%`); }
    if (user_id) { where += ' AND l.user_id = ?';    params.push(user_id); }
    if (search)  { where += ' AND (u.email LIKE ? OR l.action LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(l.details, "$.hostname")) LIKE ?)';
                   params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const rows = await query(
      `SELECT l.*, u.email as user_email FROM audit_logs l
       LEFT JOIN users u ON l.user_id = u.id
       ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM audit_logs l LEFT JOIN users u ON l.user_id = u.id ${where}`,
      params
    );
    return reply.send({ success: true, data: { logs: rows, total, page: parseInt(page), limit: parseInt(limit) } });
  });
}
