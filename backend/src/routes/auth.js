import bcrypt from 'bcryptjs';
import { queryOne, query } from '../config/database.js';
import { signToken, signRefreshToken, signTempToken, verifyToken, verifyRefreshToken } from '../utils/jwt.js';
import { verifyToken as verifyTotp } from '../utils/totp.js';
import { logAction } from '../services/audit.js';

export default async function authRoutes(fastify) {
  fastify.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) return reply.status(400).send({ success: false, error: 'Email and password required' });

    const user = await queryOne('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      await logAction(null, 'login_failed', 'user', null, { email }, req.ip);
      return reply.status(401).send({ success: false, error: 'Invalid credentials' });
    }

    if (user.totp_enabled) {
      const tempToken = signTempToken({ id: user.id, require2FA: true });
      return reply.send({ success: true, data: { require2FA: true, tempToken } });
    }

    await logAction(user.id, 'login', 'user', user.id, null, req.ip);
    return reply.send({ success: true, data: {
      token: signToken({ id: user.id, role: user.role }),
      refreshToken: signRefreshToken({ id: user.id }),
      user: { id: user.id, email: user.email, role: user.role, first_name: user.first_name, last_name: user.last_name },
    }});
  });

  fastify.post('/2fa/verify', async (req, reply) => {
    const { tempToken, code } = req.body || {};
    if (!tempToken || !code) return reply.status(400).send({ success: false, error: 'Token and code required' });

    let payload;
    try { payload = verifyToken(tempToken); } catch { return reply.status(401).send({ success: false, error: 'Invalid temp token' }); }
    if (!payload.require2FA) return reply.status(400).send({ success: false, error: 'Not a 2FA token' });

    const user = await queryOne('SELECT * FROM users WHERE id = ?', [payload.id]);
    if (!user || !verifyTotp(user.totp_secret, code)) {
      return reply.status(401).send({ success: false, error: 'Invalid 2FA code' });
    }

    return reply.send({ success: true, data: {
      token: signToken({ id: user.id, role: user.role }),
      refreshToken: signRefreshToken({ id: user.id }),
      user: { id: user.id, email: user.email, role: user.role },
    }});
  });

  fastify.post('/refresh', async (req, reply) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return reply.status(400).send({ success: false, error: 'Refresh token required' });
    try {
      const payload = verifyRefreshToken(refreshToken);
      const user = await queryOne('SELECT * FROM users WHERE id = ? AND is_active = 1', [payload.id]);
      if (!user) return reply.status(401).send({ success: false, error: 'User not found' });
      return reply.send({ success: true, data: { token: signToken({ id: user.id, role: user.role }) } });
    } catch {
      return reply.status(401).send({ success: false, error: 'Invalid refresh token' });
    }
  });

  fastify.get('/me', { preHandler: [async (req, rep) => { const { authenticate } = await import('../middleware/authenticate.js'); await authenticate(req, rep); } ] }, async (req, reply) => {
    const u = req.user;
    return reply.send({ success: true, data: { id: u.id, email: u.email, role: u.role, first_name: u.first_name, last_name: u.last_name } });
  });
}
