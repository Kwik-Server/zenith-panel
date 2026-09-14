import 'dotenv/config';
import { buildApp } from './app.js';
import { testConnection } from './config/database.js';
import { redis } from './config/redis.js';
import { startWorkers } from './services/workers/vps.worker.js';
import { startAbuseWorker } from './services/workers/abuse.worker.js';

const PORT = parseInt(process.env.PORT || '3001');
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  await testConnection();
  await redis.ping();

  const app = await buildApp();

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Zenith API running on ${HOST}:${PORT}`);

  startWorkers();
  startAbuseWorker().catch((err) => app.log.error(err, 'Abuse worker failed to start'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
