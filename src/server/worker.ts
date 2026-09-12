import dotenv from 'dotenv';
dotenv.config();

import { EmailWorker } from '../modules/email/email.worker';
import { ReplenishmentWorker } from '../modules/replenishment/replenishment.worker';

async function main() {
  console.log('[Worker] Starting background email worker...');
  const emailWorker = new EmailWorker();
  emailWorker.start();

  console.log('[Worker] Starting background replenishment worker...');
  const replenishmentWorker = new ReplenishmentWorker();
  replenishmentWorker.start();
  
  // Graceful shutdown
  const shutdown = () => {
    console.log('[Worker] Shutting down...');
    emailWorker.stop();
    replenishmentWorker.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Worker] Fatal Error:', err);
  process.exit(1);
});
