import { ReplenishmentService } from './replenishment.service';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';

export class ReplenishmentWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private service: ReplenishmentService;

  constructor(deps?: { db?: IDatabaseClient; service?: ReplenishmentService }) {
    const db = deps?.db || getDatabaseClient();
    this.service = deps?.service || new ReplenishmentService({ db });
  }

  start(): void {
    if (this.isRunning) return;
    const intervalMs = parseInt(process.env.REPLENISHMENT_WORKER_INTERVAL_MS || '60000', 10);

    this.isRunning = true;
    this.timer = setInterval(() => this.processDueReminders(), intervalMs);
    logger.info(`[ReplenishmentWorker] Started with interval ${intervalMs}ms`);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[ReplenishmentWorker] Stopped');
  }

  async processDueReminders(): Promise<{
    processed: number;
    sent: number;
    suppressed: number;
    cancelled: number;
  }> {
    try {
      return await this.service.processDueReminders(50);
    } catch (err) {
      logger.error('[ReplenishmentWorker] Failed to process due replenishment reminders', err);
      return { processed: 0, sent: 0, suppressed: 0, cancelled: 0 };
    }
  }
}
