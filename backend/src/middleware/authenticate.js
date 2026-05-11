import { verifyToken } from '../utils/jwt.js';
import { queryOne } from '../config/database.js';

export async function authenticate(request, reply) {
  try {
    // API Key auth
    const apiKey = request.headers['x-api-key'];
    if (apiKey) {
      const user = await queryOne('SELECT * FROM users WHERE api_key = ? AND is_active = 1', [apiKey]);
      if (!user) return reply.status(401).send({ success: false, error: 'Invalid API key' });
      request.user = user;
      return;
    }

    // JWT Bearer auth (header or query param for WebSocket)
    const auth = request.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : request.query?.token;
    if (!token) return reply.status(401).send({ success: false, error: 'Unauthorized' });
    const payload = verifyToken(token);
    const user = await queryOne('SELECT * FROM users WHERE id = ? AND is_active = 1', [payload.id]);
    if (!user) return reply.status(401).send({ success: false, error: 'User not found' });

    request.user = user;
  } catch {
    return reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
}

export async function adminOnly(request, reply) {
  await authenticate(request, reply);
  if (reply.sent) return;
  if (request.user?.role !== 'admin') {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }
}

export async function whmcsAuth(request, reply) {
  const key = request.headers['x-whmcs-key'];
  const setting = await queryOne('SELECT value FROM settings WHERE `key` = "whmcs_api_key"').catch(() => null);
  if (!key || !setting || key !== setting.value) {
    return reply.status(401).send({ success: false, error: 'Invalid WHMCS API key' });
  }
}
