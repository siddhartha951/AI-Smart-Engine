/**
 * Keeps every store's data fresh without the merchant pressing anything:
 *   - Shopify orders: new and changed orders every minute; order history import every 5 minutes
 *   - Meta ad spend:  every hour (last 30 days, for ROAS)
 *   - Webhooks:       every 6 hours, re-registers any that are missing
 *
 * Runs inside the web process (always deployed). Every step is idempotent, so a second
 * instance only repeats work, it never corrupts data. Only active with the real Shopify
 * adapter; tests and local fake mode never call Shopify.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';
import { syncAllStoresOrders } from './orders-sync.service';
import { syncAllStoresMetaSpend } from './meta-spend-sync';
import { ensureWebhooks } from './webhooks.service';
import { SyncStateRepository } from './sync-state.repository';

const MINUTE = 60 * 1000;

export class ShopifyDataScheduler {
  private timers: NodeJS.Timeout[] = [];
  private busy = new Set<string>();

  constructor(private db: IDatabaseClient = getDatabaseClient()) {}

  static shouldRun(): boolean {
    if (process.env.DISABLE_SHOPIFY_DATA_SYNC === 'true') return false;
    try {
      const env = getEnvConfig();
      return env.NODE_ENV !== 'test' && env.SHOPIFY_ADAPTER_MODE === 'real';
    } catch {
      return false;
    }
  }

  start(): void {
    const ordersEvery = parseInt(process.env.SHOPIFY_ORDERS_SYNC_INTERVAL_MS || String(MINUTE), 10);
    // Every tick brings in new/changed orders; every 5th tick also continues the history import.
    // One job name, so a live run and a history run never write the same store at the same time.
    let tick = 0;
    this.every('orders', ordersEvery, () => {
      tick += 1;
      return syncAllStoresOrders(this.db, { skipHistory: tick % 5 !== 0 });
    });
    this.every('meta_spend', 60 * MINUTE, () => syncAllStoresMetaSpend(this.db));
    this.every('webhooks', 6 * 60 * MINUTE, () => this.repairWebhooks());
    // First pass shortly after boot, so a fresh deploy fills the dashboard quickly
    const kick = setTimeout(() => {
      this.run('orders', () => syncAllStoresOrders(this.db));
      this.run('webhooks', () => this.repairWebhooks());
      this.run('meta_spend', () => syncAllStoresMetaSpend(this.db));
    }, 30 * 1000);
    kick.unref();
    this.timers.push(kick);
    logger.info(`[ShopifyDataScheduler] Started (orders every ${Math.round(ordersEvery / 1000)}s)`);
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private every(name: string, ms: number, job: () => Promise<void>): void {
    const t = setInterval(() => this.run(name, job), ms);
    t.unref();
    this.timers.push(t);
  }

  /** A slow run is never overlapped by the next tick of the same job. */
  private async run(name: string, job: () => Promise<void>): Promise<void> {
    if (this.busy.has(name)) return;
    this.busy.add(name);
    try {
      await job();
    } catch (err) {
      logger.warn(`[ShopifyDataScheduler] ${name} run failed: ${(err as Error)?.message || err}`);
    } finally {
      this.busy.delete(name);
    }
  }

  private async repairWebhooks(): Promise<void> {
    const res = await this.db.query(
      `SELECT s.id FROM stores s JOIN store_credentials c ON c.store_id = s.id
       WHERE s.status = 'active' AND c.encrypted_admin_token IS NOT NULL`
    );
    const state = new SyncStateRepository(this.db);
    for (const row of res.rows) {
      const current = await state.get(row.id, 'webhooks').catch(() => null);
      if (current?.status === 'ok') continue;
      await ensureWebhooks(row.id, { db: this.db }).catch(() => undefined);
    }
  }
}
