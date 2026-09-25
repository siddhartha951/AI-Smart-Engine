/**
 * Did a Growth Copilot action work? When the merchant marks an action done we save the
 * last 7 days' revenue and orders; 7 days later we compare the next 7 days with it.
 * Action types that were followed by growth get a small priority boost next time.
 *
 * This shows correlation, not proof (a sale or season can move numbers too); the UI says so.
 */
import { IDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';

const DAY = 24 * 60 * 60 * 1000;
const MEASURE_AFTER_DAYS = 7;

export interface WindowSales {
  revenue: number;
  orders: number;
}

async function salesBetween(db: IDatabaseClient, storeId: string, from: Date, to: Date): Promise<WindowSales> {
  const params = [storeId, from.toISOString(), to.toISOString()];
  try {
    const mirrored = await db.query('SELECT 1 FROM shopify_orders WHERE store_id = $1 LIMIT 1', [storeId]);
    const shop = await db.query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total_price - total_refunded), 0) AS revenue
       FROM shopify_orders WHERE store_id = $1 AND cancelled_at IS NULL AND is_test = false
         AND created_at_shop >= $2::timestamptz AND created_at_shop < $3::timestamptz`,
      params
    );
    if (mirrored.rows.length > 0) {
      return { revenue: Number(shop.rows[0]?.revenue || 0), orders: Number(shop.rows[0]?.orders || 0) };
    }
  } catch {
    // shopify_orders missing: fall back to the attribution ledger
  }
  const res = await db.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(order_revenue), 0) AS revenue FROM order_attributions
     WHERE store_id = $1 AND order_created_at >= $2::timestamptz AND order_created_at < $3::timestamptz`,
    params
  );
  return { revenue: Number(res.rows[0]?.revenue || 0), orders: Number(res.rows[0]?.orders || 0) };
}

/** Called when an action is marked completed. */
export async function recordCompletionBaseline(db: IDatabaseClient, storeId: string, actionId: string, now = new Date()): Promise<void> {
  const before = await salesBetween(db, storeId, new Date(now.getTime() - MEASURE_AFTER_DAYS * DAY), now);
  await db.query(
    `UPDATE growth_actions SET completed_at = $3::timestamptz, baseline_metrics = $4::jsonb, outcome = NULL
     WHERE store_id = $1 AND id = $2`,
    [storeId, actionId, now.toISOString(), JSON.stringify({ ...before, window_days: MEASURE_AFTER_DAYS })]
  );
}

function pct(after: number, before: number): number | null {
  return before > 0 ? Math.round(((after - before) / before) * 1000) / 10 : null;
}

/** Measures every completed action whose 7 days have passed. Returns how many were measured. */
export async function measureDueOutcomes(db: IDatabaseClient, storeId: string, now = new Date()): Promise<number> {
  let res;
  try {
    res = await db.query(
      `SELECT id, completed_at, baseline_metrics FROM growth_actions
       WHERE store_id = $1 AND status = 'completed' AND outcome IS NULL AND completed_at IS NOT NULL AND completed_at <= $2::timestamptz`,
      [storeId, new Date(now.getTime() - MEASURE_AFTER_DAYS * DAY).toISOString()]
    );
  } catch {
    return 0; // columns missing before migration 040
  }
  let measured = 0;
  for (const row of res.rows) {
    try {
      const baseline = typeof row.baseline_metrics === 'string' ? JSON.parse(row.baseline_metrics) : row.baseline_metrics || {};
      const start = new Date(row.completed_at);
      const after = await salesBetween(db, storeId, start, new Date(start.getTime() + MEASURE_AFTER_DAYS * DAY));
      const outcome = {
        before: { revenue: Number(baseline.revenue || 0), orders: Number(baseline.orders || 0) },
        after,
        revenue_change_pct: pct(after.revenue, Number(baseline.revenue || 0)),
        orders_change_pct: pct(after.orders, Number(baseline.orders || 0)),
        measured_at: now.toISOString(),
      };
      await db.query('UPDATE growth_actions SET outcome = $3::jsonb WHERE store_id = $1 AND id = $2', [storeId, row.id, JSON.stringify(outcome)]);
      measured += 1;
    } catch (err) {
      logger.warn(`Growth outcome measurement failed for action ${row.id}: ${(err as Error)?.message || err}`);
    }
  }
  return measured;
}

/** Action types whose measured results were mostly positive (revenue up > 5%). */
export async function provenActionTypes(db: IDatabaseClient, storeId: string): Promise<Set<string>> {
  try {
    const res = await db.query(
      `SELECT action_type, outcome FROM growth_actions WHERE store_id = $1 AND outcome IS NOT NULL`,
      [storeId]
    );
    const tally = new Map<string, { up: number; total: number }>();
    for (const r of res.rows) {
      const o = typeof r.outcome === 'string' ? JSON.parse(r.outcome) : r.outcome || {};
      const t = tally.get(r.action_type) || { up: 0, total: 0 };
      t.total += 1;
      if (Number(o.revenue_change_pct) > 5) t.up += 1;
      tally.set(r.action_type, t);
    }
    return new Set([...tally.entries()].filter(([, t]) => t.up / t.total >= 0.5).map(([type]) => type));
  } catch {
    return new Set();
  }
}
