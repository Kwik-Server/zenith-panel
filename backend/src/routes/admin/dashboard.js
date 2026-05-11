import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

export default async function dashboardRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/dashboard', async (req, reply) => {
    const [vpsStats] = await query('SELECT status, COUNT(*) as cnt FROM vps GROUP BY status');
    const vps = {};
    const rows = await query('SELECT status, COUNT(*) as cnt FROM vps GROUP BY status');
    rows.forEach(r => vps[r.status] = r.cnt);
    vps.total = rows.reduce((s, r) => s + r.cnt, 0);

    const userStats = await queryOne('SELECT COUNT(*) as total, SUM(role="client") as clients, SUM(role="admin") as admins FROM users');
    const nodeStats = await queryOne('SELECT COUNT(*) as total, SUM(is_active=1) as online FROM nodes');
    const taskStats = await queryOne('SELECT SUM(status="pending") as pending, SUM(status="running") as running, SUM(status="failed") as failed FROM tasks WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)');

    const recentTasks = await query('SELECT t.*, v.hostname as vps_hostname FROM tasks t LEFT JOIN vps v ON t.vps_id = v.id ORDER BY t.created_at DESC LIMIT 10');
    const recentLogs  = await query('SELECT l.*, u.email as user_email FROM audit_logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 10');

    return reply.send({ success: true, data: { vps, users: userStats, nodes: nodeStats, tasks: taskStats, recentTasks, recentLogs } });
  });
}
