import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';

import authRoutes from './routes/auth.js';
import adminDashboard from './routes/admin/dashboard.js';
import adminNodes from './routes/admin/nodes.js';
import adminVps from './routes/admin/vps.js';
import adminUsers from './routes/admin/users.js';
import adminPlans from './routes/admin/plans.js';
import adminTemplates from './routes/admin/templates.js';
import adminIpPools from './routes/admin/ippools.js';
import adminTasks from './routes/admin/tasks.js';
import adminLogs from './routes/admin/logs.js';
import adminSettings from './routes/admin/settings.js';
import clientVps from './routes/client/vps.js';
import clientProfile from './routes/client/profile.js';
import whmcsRoutes from './routes/whmcs.js';
import adminAbuse from './routes/admin/abuse.js';

export async function buildApp() {
  const app = Fastify({ logger: true, trustProxy: true });

  // The WHMCS module sends `Content-Type: application/json` on every request, including
  // bodiless POSTs (suspend, unsuspend, start, stop, restart). Fastify rejects those with
  // FST_ERR_CTP_EMPTY_JSON_BODY (400), which is how WHMCS's automatic suspension failed
  // for every overdue VPS. Treat an empty JSON body as {}; anything else still goes
  // through Fastify's own parser, so malformed JSON and prototype poisoning stay rejected.
  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (body.trim() === '') return done(null, {});
    defaultJsonParser(req, body, done);
  });

  await app.register(cors, { origin: process.env.FRONTEND_URL || '*', credentials: true });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(websocket);

  app.get('/health', async () => ({ status: 'ok', version: '1.0.0' }));

  await app.register(authRoutes,      { prefix: '/api/v1/auth' });
  await app.register(adminDashboard,  { prefix: '/api/v1/admin' });
  await app.register(adminNodes,      { prefix: '/api/v1/admin/nodes' });
  await app.register(adminVps,        { prefix: '/api/v1/admin/vps' });
  await app.register(adminUsers,      { prefix: '/api/v1/admin/users' });
  await app.register(adminPlans,      { prefix: '/api/v1/admin/plans' });
  await app.register(adminTemplates,  { prefix: '/api/v1/admin/templates' });
  await app.register(adminIpPools,    { prefix: '/api/v1/admin/ippools' });
  await app.register(adminTasks,      { prefix: '/api/v1/admin/tasks' });
  await app.register(adminLogs,       { prefix: '/api/v1/admin/logs' });
  await app.register(adminSettings,   { prefix: '/api/v1/admin/settings' });
  await app.register(adminAbuse,      { prefix: '/api/v1/admin/abuse' });
  await app.register(clientVps,       { prefix: '/api/v1/client/vps' });
  await app.register(clientProfile,   { prefix: '/api/v1/client/profile' });
  await app.register(whmcsRoutes,     { prefix: '/api/v1/whmcs' });

  app.setErrorHandler((error, request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({ success: false, error: error.message || 'Internal Server Error' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ success: false, error: 'Route not found' });
  });

  return app;
}
