import { startVpsWorker } from './vps.worker.js';
import { startBackupWorker } from './backup.worker.js';
import { logger } from '../../utils/logger.js';

export async function startWorkers() {
  startVpsWorker();
  startBackupWorker();
  logger.info('All queue workers started');
}

// If run directly
if (process.argv[1].includes('workers/index')) {
  import('dotenv/config').then(() => {
    startWorkers().catch((err) => {
      logger.error(err, 'Worker startup failed');
      process.exit(1);
    });
  });
}
