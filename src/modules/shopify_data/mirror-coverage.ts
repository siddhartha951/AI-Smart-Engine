/**
 * How far back the synced orders are complete. While the history import is still running,
 * totals for older periods would be too low, so callers say so (or ask Shopify live).
 */
import { IDatabaseClient } from '../../database/client';
import { SyncStateRepository } from './sync-state.repository';

const FRESH_MS = 20 * 60 * 1000;

export interface MirrorCoverage {
  /** The live pass ran recently: today's orders are in */
  fresh: boolean;
  /** Orders are complete back to this instant ('all' = the whole import window) */
  completeFrom: string | 'all' | null;
}

export async function mirrorCoverage(db: IDatabaseClient, storeId: string): Promise<MirrorCoverage> {
  const s = await new SyncStateRepository(db).get(storeId, 'orders').catch(() => null);
  if (!s || s.status === 'blocked' || !s.last_success_at) return { fresh: false, completeFrom: null };
  const fresh = Date.now() - new Date(s.last_success_at).getTime() < FRESH_MS && Boolean(s.details?.live_cursor);
  const before = s.details?.history_before;
  const completeFrom = before === 'done' ? 'all' : typeof before === 'string' ? before : null;
  return { fresh, completeFrom };
}

/** True when synced orders are complete for everything from `fromIso` until now. */
export function covers(c: MirrorCoverage, fromIso: string): boolean {
  if (!c.fresh || !c.completeFrom) return false;
  return c.completeFrom === 'all' || c.completeFrom <= fromIso;
}

/** Plain note for the merchant / AI when a period is not fully imported yet, else null. */
export async function coverageNote(db: IDatabaseClient, storeId: string, fromIso: string): Promise<string | null> {
  const c = await mirrorCoverage(db, storeId);
  if (covers(c, fromIso)) return null;
  if (!c.fresh) return 'Shopify orders have not synced in the last 20 minutes, so the newest orders may be missing.';
  const reached = c.completeFrom && c.completeFrom !== 'all' ? new Date(c.completeFrom).toISOString().slice(0, 10) : null;
  return `Order history is still importing${reached ? ` (complete back to ${reached})` : ''}; totals for this period are incomplete until it finishes.`;
}
