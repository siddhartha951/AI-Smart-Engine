/**
 * Mirrors every store's Shopify orders into shopify_orders.
 *
 * One mechanism for both the first import and later updates: orders sorted by updated_at,
 * starting after the newest update already mirrored (first run: the last 365 days; Shopify
 * returns only 60 days unless the token has read_all_orders). The cursor is saved after
 * every page, so a run that stops half-way resumes where it left off.
 *
 * A 403 means the token lacks read_orders: the feed is marked "blocked" with that scope so
 * Settings can tell the merchant exactly what to tick in Shopify.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';
import { AdminCredentials, AdminResponse, adminGet, getAdminCredentials } from '../../providers/shopify/admin-client';
import { ORDER_SYNC_FIELDS, mapShopifyOrder } from './order-mapper';
import { ShopifyOrdersRepository } from './orders.repository';
import { SyncStateRepository } from './sync-state.repository';

const PAGE_SIZE = 250;
/** Pages per run (x250 orders). The next run continues from the saved cursor. */
const MAX_PAGES_PER_RUN = 12;
const FIRST_IMPORT_DAYS = 365;

export type OrdersFetcher = (creds: AdminCredentials, path: string, params: Record<string, string>) => Promise<AdminResponse>;

export interface OrdersSyncResult {
  status: 'ok' | 'blocked' | 'error' | 'not_connected';
  synced: number;
  complete: boolean;
  blocked_scope?: string;
  message?: string;
}

export async function syncStoreOrders(
  storeId: string,
  opts: { db?: IDatabaseClient; fetcher?: OrdersFetcher; maxPages?: number } = {}
): Promise<OrdersSyncResult> {
  const db = opts.db || getDatabaseClient();
  const fetcher = opts.fetcher || adminGet;
  const state = new SyncStateRepository(db);
  const orders = new ShopifyOrdersRepository(db);
  const now = new Date().toISOString();

  const creds = await getAdminCredentials(storeId, db);
  if (!creds) {
    await state.save(storeId, 'orders', { status: 'error', last_error: 'Shopify is not connected for this store.', last_run_at: now });
    return { status: 'not_connected', synced: 0, complete: false, message: 'Shopify is not connected.' };
  }

  const previous = await state.get(storeId, 'orders');
  let cursor = previous?.cursor_updated_at
    || new Date(Date.now() - FIRST_IMPORT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let total = previous?.records_synced || 0;
  let synced = 0;
  let pageInfo: string | null = null;
  const maxPages = opts.maxPages ?? MAX_PAGES_PER_RUN;

  for (let page = 0; page < maxPages; page++) {
    // With page_info Shopify only accepts limit + fields; the first request sets the filter and sort
    const params: Record<string, string> = pageInfo
      ? { limit: String(PAGE_SIZE), fields: ORDER_SYNC_FIELDS, page_info: pageInfo }
      : { limit: String(PAGE_SIZE), fields: ORDER_SYNC_FIELDS, status: 'any', order: 'updated_at asc', updated_at_min: cursor };
    const res = await fetcher(creds, 'orders.json', params);

    if (res.status === 403) {
      await state.save(storeId, 'orders', {
        status: 'blocked',
        blocked_scope: 'read_orders',
        last_error: 'Shopify refused the orders request: the access token does not have the read_orders permission.',
        last_run_at: now,
      });
      return { status: 'blocked', synced, complete: false, blocked_scope: 'read_orders' };
    }
    if (res.status === 401) {
      await state.save(storeId, 'orders', { status: 'error', last_error: 'Shopify rejected the access token (invalid or revoked). Update the token in Settings.', last_run_at: now });
      return { status: 'error', synced, complete: false, message: 'Token rejected' };
    }
    if (!res.ok) {
      const message = res.status === null ? 'Shopify could not be reached (network timeout).' : `Shopify answered HTTP ${res.status}.`;
      await state.save(storeId, 'orders', { status: 'error', last_error: message, last_run_at: now, records_synced: total, cursor_updated_at: cursor });
      return { status: 'error', synced, complete: false, message };
    }

    const rawOrders: any[] = Array.isArray(res.body?.orders) ? res.body.orders : [];
    for (const raw of rawOrders) {
      const row = mapShopifyOrder(raw);
      if (!row) continue;
      await orders.upsert(storeId, row);
      synced += 1;
      if (row.updated_at_shop && row.updated_at_shop > cursor) cursor = row.updated_at_shop;
    }
    total = await orders.count(storeId);
    await state.save(storeId, 'orders', { cursor_updated_at: cursor, records_synced: total });

    pageInfo = res.nextPageInfo;
    if (!pageInfo) {
      await state.save(storeId, 'orders', {
        status: 'ok',
        blocked_scope: null,
        last_error: null,
        backfill_done: true,
        last_run_at: now,
        last_success_at: now,
        records_synced: total,
        cursor_updated_at: cursor,
      });
      return { status: 'ok', synced, complete: true };
    }
  }

  // More pages remain: the next run continues from the saved cursor
  await state.save(storeId, 'orders', {
    status: 'ok',
    blocked_scope: null,
    last_error: null,
    last_run_at: now,
    last_success_at: now,
    records_synced: total,
    cursor_updated_at: cursor,
  });
  return { status: 'ok', synced, complete: false };
}

/** Every store with Shopify credentials, one after another (called by the worker). */
export async function syncAllStoresOrders(db: IDatabaseClient = getDatabaseClient()): Promise<void> {
  const res = await db.query(
    `SELECT s.id FROM stores s JOIN store_credentials c ON c.store_id = s.id
     WHERE s.status = 'active' AND c.encrypted_admin_token IS NOT NULL`
  );
  for (const row of res.rows) {
    try {
      const result = await syncStoreOrders(row.id, { db });
      if (result.synced > 0) logger.info(`Orders sync: store ${row.id} mirrored ${result.synced} orders (${result.status})`);
    } catch (err) {
      logger.warn(`Orders sync failed for store ${row.id}: ${(err as Error)?.message || err}`);
    }
  }
}
