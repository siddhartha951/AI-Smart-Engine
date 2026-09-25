/**
 * The store's own timezone (from Shopify shop.json), so "today" on the dashboard and in
 * Ask AI means the same day as Shopify admin, whatever timezone the merchant's browser is in.
 */
import { IDatabaseClient } from '../../database/client';
import { SyncStateRepository } from './sync-state.repository';

/**
 * Minutes to add to local time to get UTC (same sign as Date#getTimezoneOffset):
 * New York in summer -> 240, India -> -330. Null for an unknown zone.
 */
export function tzOffsetMinutes(ianaZone: string, at: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const atSeconds = Math.floor(at.getTime() / 1000) * 1000;
    return Math.round((atSeconds - asUtc) / 60000);
  } catch {
    return null;
  }
}

/** The Shopify store timezone recorded by the orders sync, if any. */
export async function storeTimezone(db: IDatabaseClient, storeId: string): Promise<string | null> {
  const state = await new SyncStateRepository(db).get(storeId, 'orders').catch(() => null);
  const zone = state?.details?.shop_timezone;
  return typeof zone === 'string' && zone ? zone : null;
}

/**
 * Offset to use for "today": the store's Shopify timezone when known (matches Shopify admin),
 * otherwise the browser offset the dashboard sent.
 */
export async function resolveStoreOffset(db: IDatabaseClient, storeId: string, browserOffset: number): Promise<{ offset: number; timezone: string | null }> {
  const zone = await storeTimezone(db, storeId);
  const offset = zone ? tzOffsetMinutes(zone) : null;
  return offset === null ? { offset: browserOffset, timezone: null } : { offset, timezone: zone };
}
