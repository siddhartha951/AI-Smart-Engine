import dotenv from 'dotenv';
dotenv.config();

import { EmailWorker } from '../modules/email/email.worker';

async function main() {
  console.log('[Worker] Starting background email worker...');
  const worker = new EmailWorker();
  
  worker.start();
  
  // Graceful shutdown
  const shutdown = () => {
    console.log('[Worker] Shutting down...');
    worker.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Worker] Fatal Error:', err);
  process.exit(1);
});
