/**
 * Mirrors every store's Shopify orders into shopify_orders, newest first.
 *
 * Every run does two passes:
 *  1. Live:     orders created or changed since the last run (updated_at, oldest first), so
 *               today's numbers are right from the very first run.
 *  2. History:  going back in time from now (created_at, newest first) until 365 days ago
 *               (Shopify gives 60 days unless the token has read_all_orders). The point
 *               reached is saved after every page, so the next run continues from there.
 *
 * The shop's timezone is recorded too, so "today" matches Shopify admin.
 * A 403 means the token lacks read_orders: the feed is marked "blocked" with that scope.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';
import { AdminCredentials, AdminResponse, adminGet, getAdminCredentials } from '../../providers/shopify/admin-client';
import { ORDER_SYNC_FIELDS, mapShopifyOrder } from './order-mapper';
import { ShopifyOrdersRepository } from './orders.repository';
import { SyncState, SyncStateRepository } from './sync-state.repository';

const PAGE_SIZE = 250;
const DAY = 24 * 60 * 60 * 1000;
/** Live pass: pages per run (x250 changed orders). */
const LIVE_PAGES_PER_RUN = 20;
/** History pass: pages per run (x250 orders). The next run continues from the saved point. */
const HISTORY_PAGES_PER_RUN = 24;
const HISTORY_DAYS = 365;
/** First live window: a little overlap so nothing between two runs is ever missed. */
const FIRST_LIVE_WINDOW_DAYS = 3;

export type OrdersFetcher = (creds: AdminCredentials, path: string, params: Record<string, string>) => Promise<AdminResponse>;

export interface OrdersSyncResult {
  status: 'ok' | 'blocked' | 'error' | 'not_connected';
  synced: number;
  complete: boolean;
  blocked_scope?: string;
  message?: string;
}

type PassOutcome =
  | { kind: 'ok'; synced: number; more: boolean }
  | { kind: 'blocked' }
  | { kind: 'token' }
  | { kind: 'error'; message: string };

/** One Shopify call, retried once after a 429 (rate limit). */
async function fetchPage(fetcher: OrdersFetcher, creds: AdminCredentials, params: Record<string, string>): Promise<AdminResponse> {
  let res = await fetcher(creds, 'orders.json', params);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetcher(creds, 'orders.json', params);
  }
  return res;
}

function failure(res: AdminResponse): PassOutcome | null {
  if (res.status === 403) return { kind: 'blocked' };
  if (res.status === 401) return { kind: 'token' };
  if (!res.ok) return { kind: 'error', message: res.status === null ? 'Shopify could not be reached (network timeout).' : `Shopify answered HTTP ${res.status}.` };
  return null;
}

async function recordShopTimezone(db: IDatabaseClient, storeId: string, creds: AdminCredentials, fetcher: OrdersFetcher, state: SyncStateRepository): Promise<void> {
  const res = await fetcher(creds, 'shop.json', { fields: 'iana_timezone,currency' }).catch(() => null);
  const zone = res?.ok ? res.body?.shop?.iana_timezone : null;
  if (typeof zone !== 'string' || !zone) return;
  const current = await state.get(storeId, 'orders');
  await state.save(storeId, 'orders', { details: { ...(current?.details || {}), shop_timezone: zone } });
  await db.query('UPDATE stores SET timezone = $2 WHERE id = $1', [storeId, zone.slice(0, 50)]).catch(() => undefined);
}

export async function syncStoreOrders(
  storeId: string,
  opts: { db?: IDatabaseClient; fetcher?: OrdersFetcher; maxPages?: number; now?: Date; skipHistory?: boolean } = {}
): Promise<OrdersSyncResult> {
  const db = opts.db || getDatabaseClient();
  const fetcher = opts.fetcher || adminGet;
  const state = new SyncStateRepository(db);
  const orders = new ShopifyOrdersRepository(db);
  const nowDate = opts.now || new Date();
  const now = nowDate.toISOString();

  const creds = await getAdminCredentials(storeId, db);
  if (!creds) {
    await state.save(storeId, 'orders', { status: 'error', last_error: 'Shopify is not connected for this store.', last_run_at: now });
    return { status: 'not_connected', synced: 0, complete: false, message: 'Shopify is not connected.' };
  }

  if (!(await state.get(storeId, 'orders'))?.details?.shop_timezone) {
    await recordShopTimezone(db, storeId, creds, fetcher, state);
  }
  const previous: SyncState | null = await state.get(storeId, 'orders');
  const details = { ...(previous?.details || {}) } as Record<string, any>;

  const saveProgress = async (patch: Partial<SyncState> = {}) => {
    await state.save(storeId, 'orders', { details: { ...details }, records_synced: await orders.count(storeId), ...patch });
  };

  // ---------- 1. Live pass: everything created or changed since the last run ----------
  let liveCursor: string = details.live_cursor
    || new Date(nowDate.getTime() - FIRST_LIVE_WINDOW_DAYS * DAY).toISOString();
  let synced = 0;
  let pageInfo: string | null = null;
  const livePages = opts.maxPages ?? LIVE_PAGES_PER_RUN;
  let live: PassOutcome = { kind: 'ok', synced: 0, more: false };
  for (let page = 0; page < livePages; page++) {
    const params: Record<string, string> = pageInfo
      ? { limit: String(PAGE_SIZE), fields: ORDER_SYNC_FIELDS, page_info: pageInfo }
      : { limit: String(PAGE_SIZE), fields: ORDER_SYNC_FIELDS, status: 'any', order: 'updated_at asc', updated_at_min: liveCursor };
    const res = await fetchPage(fetcher, creds, params);
    const failed = failure(res);
    if (failed) {
      live = failed;
      break;
    }
    for (const raw of Array.isArray(res.body?.orders) ? res.body.orders : []) {
      const row = mapShopifyOrder(raw);
      if (!row) continue;
      await orders.upsert(storeId, row);
      synced += 1;
      if (row.updated_at_shop && row.updated_at_shop > liveCursor) liveCursor = row.updated_at_shop;
    }
    details.live_cursor = liveCursor;
    await saveProgress({ cursor_updated_at: liveCursor });
    pageInfo = res.nextPageInfo;
    live = { kind: 'ok', synced, more: Boolean(pageInfo) };
    if (!pageInfo) break;
  }
  if (!details.live_cursor) details.live_cursor = liveCursor;

  if (live.kind === 'blocked') {
    await state.save(storeId, 'orders', {
      status: 'blocked',
      blocked_scope: 'read_orders',
      last_error: 'Shopify refused the orders request: the access token does not have the read_orders permission.',
      last_run_at: now,
    });
    return { status: 'blocked', synced, complete: false, blocked_scope: 'read_orders' };
  }
  if (live.kind === 'token') {
    await state.save(storeId, 'orders', { status: 'error', last_error: 'Shopify rejected the access token (invalid or revoked). Update the token in Settings.', last_run_at: now });
    return { status: 'error', synced, complete: false, message: 'Token rejected' };
  }
  if (live.kind === 'error') {
    await saveProgress({ status: 'error', last_error: live.message, last_run_at: now });
    return { status: 'error', synced, complete: false, message: live.message };
  }

  // ---------- 2. History pass: back in time from where it stopped ----------
  let complete = Boolean(previous?.backfill_done && details.history_before === 'done');
  if (!complete && opts.skipHistory) {
    // Quick live-only run (every minute): keep today current, leave the history for the full run
    await saveProgress({ status: 'ok', blocked_scope: null, last_error: null, last_run_at: now, last_success_at: now, cursor_updated_at: liveCursor });
    return { status: 'ok', synced, complete: false };
  }
  if (!complete) {
    const floor = details.history_floor || new Date(nowDate.getTime() - HISTORY_DAYS * DAY).toISOString();
    details.history_floor = floor;
    let before: string = details.history_before && details.history_before !== 'done' ? details.history_before : now;
    pageInfo = null;
    const historyPages = opts.maxPages ?? HISTORY_PAGES_PER_RUN;
    complete = false;
    for (let page = 0; page < historyPages; page++) {
      const params: Record<string, string> = pageInfo
        ? { limit: String(PAGE_SIZE), fields: ORDER_SYNC_FIELDS, page_info: pageInfo }
        : { limit: String(PAGE_SIZE), fields: ORDER_SYNC_FIELDS, status: 'any', order: 'created_at desc', created_at_max: before, created_at_min: floor };
      const res = await fetchPage(fetcher, creds, params);
      const failed = failure(res);
      if (failed) {
        // The live pass already worked: keep the dashboard current, retry history next run
        const message = failed.kind === 'error' ? failed.message : 'Order history could not be read.';
        await saveProgress({ status: 'ok', last_error: `History import paused: ${message}`, last_run_at: now, last_success_at: now });
        return { status: 'ok', synced, complete: false, message };
      }
      let oldest = before;
      for (const raw of Array.isArray(res.body?.orders) ? res.body.orders : []) {
        const row = mapShopifyOrder(raw);
        if (!row) continue;
        await orders.upsert(storeId, row);
        synced += 1;
        if (row.created_at_shop < oldest) oldest = row.created_at_shop;
      }
      pageInfo = res.nextPageInfo;
      // Resume point: the oldest order imported so far (pages are newest first)
      before = oldest;
      details.history_before = pageInfo ? before : 'done';
      await saveProgress();
      if (!pageInfo) {
        complete = true;
        break;
      }
    }
  }

  await saveProgress({
    status: 'ok',
    blocked_scope: null,
    last_error: null,
    backfill_done: complete,
    last_run_at: now,
    last_success_at: now,
    cursor_updated_at: liveCursor,
  });
  return { status: 'ok', synced, complete };
}

/** Every store with Shopify credentials, one after another (called by the scheduler). */
export async function syncAllStoresOrders(db: IDatabaseClient = getDatabaseClient(), opts: { skipHistory?: boolean } = {}): Promise<void> {
  const res = await db.query(
    `SELECT s.id FROM stores s JOIN store_credentials c ON c.store_id = s.id
     WHERE s.status = 'active' AND c.encrypted_admin_token IS NOT NULL`
  );
  for (const row of res.rows) {
    try {
      const result = await syncStoreOrders(row.id, { db, skipHistory: opts.skipHistory });
      if (result.synced > 0) logger.info(`Orders sync: store ${row.id} mirrored ${result.synced} orders (${result.status})`);
    } catch (err) {
      logger.warn(`Orders sync failed for store ${row.id}: ${(err as Error)?.message || err}`);
    }
  }
}
