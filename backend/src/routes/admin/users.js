import bcrypt from 'bcryptjs';
import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

export default async function userRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const rows = await query('SELECT id, email, first_name, last_name, role, is_active, created_at FROM users ORDER BY created_at DESC');
    return reply.send({ success: true, data: rows });
  });

  fastify.post('/', async (req, reply) => {
    const { email, password, first_name, last_name, role } = req.body || {};
    if (!email || !password) return reply.status(400).send({ success: false, error: 'email and password required' });
    const hash = await bcrypt.hash(password, 12);
    const r = await query('INSERT INTO users (email, password, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      [email, hash, first_name || '', last_name || '', role || 'client']);
    return reply.status(201).send({ success: true, data: { id: r.insertId } });
  });

  fastify.get('/:id', async (req, reply) => {
    const user = await queryOne('SELECT id, email, first_name, last_name, role, is_active, created_at FROM users WHERE id = ?', [req.params.id]);
    if (!user) return reply.status(404).send({ success: false, error: 'User not found' });
    const vps = await query('SELECT id, hostname, status, created_at FROM vps WHERE user_id = ?', [req.params.id]);
    return reply.send({ success: true, data: { ...user, vps } });
  });

  fastify.put('/:id', async (req, reply) => {
    const { email, password, first_name, last_name, role, is_active } = req.body || {};
    let hash = undefined;
    if (password) hash = await bcrypt.hash(password, 12);
    await query(
      'UPDATE users SET email=COALESCE(?,email), password=COALESCE(?,password), first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), role=COALESCE(?,role), is_active=COALESCE(?,is_active) WHERE id=?',
      [email, hash, first_name, last_name, role, is_active, req.params.id]
    );
    return reply.send({ success: true });
  });

  fastify.delete('/:id', async (req, reply) => {
    const inUse = await queryOne('SELECT id FROM vps WHERE user_id = ? LIMIT 1', [req.params.id]);
    if (inUse) return reply.status(409).send({ success: false, error: 'User has active VPS' });
    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    return reply.send({ success: true });
  });

  fastify.post('/:id/suspend',   async (req, reply) => { await query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]); return reply.send({ success: true }); });
  fastify.post('/:id/unsuspend', async (req, reply) => { await query('UPDATE users SET is_active = 1 WHERE id = ?', [req.params.id]); return reply.send({ success: true }); });
}
