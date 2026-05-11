import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../config/database.js';
import { authenticate } from '../../middleware/authenticate.js';
import { generateSecret, verifyToken as verifyTotp, generateQRCode } from '../../utils/totp.js';

export default async function profileRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/', async (req, reply) => {
    const u = req.user;
    return reply.send({ success: true, data: { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, totp_enabled: u.totp_enabled, role: u.role } });
  });

  fastify.put('/', async (req, reply) => {
    const { first_name, last_name, email } = req.body || {};
    await query('UPDATE users SET first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name), email=COALESCE(?,email) WHERE id=?', [first_name, last_name, email, req.user.id]);
    return reply.send({ success: true });
  });

  fastify.post('/change-password', async (req, reply) => {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return reply.status(400).send({ success: false, error: 'current_password and new_password required' });
    const user = await queryOne('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (!(await bcrypt.compare(current_password, user.password))) return reply.status(401).send({ success: false, error: 'Current password incorrect' });
    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id]);
    return reply.send({ success: true });
  });

  fastify.post('/2fa/setup', async (req, reply) => {
    const user = await queryOne('SELECT email FROM users WHERE id = ?', [req.user.id]);
    const { base32, otpauth_url } = generateSecret(user.email);
    await query('UPDATE users SET totp_secret = ? WHERE id = ?', [base32, req.user.id]);
    const qrCode = await generateQRCode(otpauth_url);
    return reply.send({ success: true, data: { secret: base32, qrCode } });
  });

  fastify.post('/2fa/enable', async (req, reply) => {
    const { code } = req.body || {};
    const user = await queryOne('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
    if (!user.totp_secret) return reply.status(400).send({ success: false, error: 'Run /2fa/setup first' });
    if (!verifyTotp(user.totp_secret, code)) return reply.status(401).send({ success: false, error: 'Invalid code' });
    await query('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.user.id]);
    return reply.send({ success: true });
  });

  fastify.post('/2fa/disable', async (req, reply) => {
    const { code } = req.body || {};
    const user = await queryOne('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
    if (!verifyTotp(user.totp_secret, code)) return reply.status(401).send({ success: false, error: 'Invalid code' });
    await query('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.user.id]);
    return reply.send({ success: true });
  });

  fastify.get('/apikey', async (req, reply) => {
    const user = await queryOne('SELECT api_key FROM users WHERE id = ?', [req.user.id]);
    return reply.send({ success: true, data: { api_key: user.api_key } });
  });

  fastify.post('/apikey', async (req, reply) => {
    const key = uuidv4().replace(/-/g, '');
    await query('UPDATE users SET api_key = ? WHERE id = ?', [key, req.user.id]);
    return reply.send({ success: true, data: { api_key: key } });
  });
}
