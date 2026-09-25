/**
 * shopify_sync_state: one row per store per data feed (orders, webhooks, meta_spend, pixel).
 * Every feed reports here so Settings can show what is flowing and what is blocked.
 */
import { IDatabaseClient } from '../../database/client';

export type SyncResource = 'orders' | 'webhooks' | 'meta_spend' | 'pixel';
export type SyncStatus = 'never' | 'ok' | 'blocked' | 'error' | 'running';

export interface SyncState {
  store_id: string;
  resource: SyncResource;
  status: SyncStatus;
  blocked_scope: string | null;
  last_error: string | null;
  cursor_updated_at: string | null;
  backfill_done: boolean;
  records_synced: number;
  last_run_at: string | null;
  last_success_at: string | null;
  details: Record<string, unknown>;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDetails(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v as Record<string, unknown>;
}

export class SyncStateRepository {
  constructor(private db: IDatabaseClient) {}

  async get(storeId: string, resource: SyncResource): Promise<SyncState | null> {
    const res = await this.db.query('SELECT * FROM shopify_sync_state WHERE store_id = $1 AND resource = $2', [storeId, resource]);
    const row = res.rows[0];
    return row ? this.toState(row) : null;
  }

  async list(storeId: string): Promise<SyncState[]> {
    const res = await this.db.query('SELECT * FROM shopify_sync_state WHERE store_id = $1', [storeId]);
    return res.rows.map((r: any) => this.toState(r));
  }

  /** Merges the given fields into the row (creating it on first use). */
  async save(
    storeId: string,
    resource: SyncResource,
    patch: Partial<Omit<SyncState, 'store_id' | 'resource'>>
  ): Promise<void> {
    const current = (await this.get(storeId, resource)) || {
      status: 'never' as SyncStatus,
      blocked_scope: null,
      last_error: null,
      cursor_updated_at: null,
      backfill_done: false,
      records_synced: 0,
      last_run_at: null,
      last_success_at: null,
      details: {},
    };
    const next = { ...current, ...patch };
    await this.db.query(
      `INSERT INTO shopify_sync_state
         (store_id, resource, status, blocked_scope, last_error, cursor_updated_at, backfill_done,
          records_synced, last_run_at, last_success_at, details)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9::timestamptz, $10::timestamptz, $11::jsonb)
       ON CONFLICT (store_id, resource) DO UPDATE SET
         status = EXCLUDED.status,
         blocked_scope = EXCLUDED.blocked_scope,
         last_error = EXCLUDED.last_error,
         cursor_updated_at = EXCLUDED.cursor_updated_at,
         backfill_done = EXCLUDED.backfill_done,
         records_synced = EXCLUDED.records_synced,
         last_run_at = EXCLUDED.last_run_at,
         last_success_at = EXCLUDED.last_success_at,
         details = EXCLUDED.details`,
      [
        storeId,
        resource,
        next.status,
        next.blocked_scope,
        next.last_error ? String(next.last_error).slice(0, 1000) : null,
        next.cursor_updated_at,
        next.backfill_done,
        next.records_synced,
        next.last_run_at,
        next.last_success_at,
        JSON.stringify(next.details || {}),
      ]
    );
  }

  private toState(row: any): SyncState {
    return {
      store_id: row.store_id,
      resource: row.resource,
      status: row.status,
      blocked_scope: row.blocked_scope || null,
      last_error: row.last_error || null,
      cursor_updated_at: toIso(row.cursor_updated_at),
      backfill_done: Boolean(row.backfill_done),
      records_synced: Number(row.records_synced || 0),
      last_run_at: toIso(row.last_run_at),
      last_success_at: toIso(row.last_success_at),
      details: parseDetails(row.details),
    };
  }
}
