import { IDatabaseClient } from '../../database/client';

/**
 * Home dashboard metrics. Every number on Home comes from here and uses the SAME time window,
 * so revenue, orders, conversion, AI sales and ROAS always agree with each other.
 */

export const HOME_RANGES = ['today', '7d', '30d'] as const;
export type HomeRange = (typeof HOME_RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<HomeRange, number> = { today: 1, '7d': 7, '30d': 30 };

export interface TimeWindow {
  from: Date;
  to: Date;
  /** Calendar days in the merchant's timezone (for DATE columns such as ad_spend.spend_date). */
  fromDate: string;
  toDate: string;
}

export interface Metric {
  value: number;
  previous: number;
  /** Percent change vs the previous window; null when the previous value was 0. */
  change_pct: number | null;
}

export interface HomeMetrics {
  range: HomeRange;
  currency: string;
  window: { from: string; to: string };
  previous_window: { from: string; to: string };
  /** shopify = the store's real Shopify orders (synced); orders = attribution ledger; storefront_events = widget events */
  revenue_source: 'shopify' | 'orders' | 'storefront_events';
  kpis: {
    revenue: Metric;
    orders: Metric;
    average_order_value: Metric;
    conversion_rate: Metric;
    ai_assisted_revenue: Metric;
    ad_spend: Metric;
    /** null when there was no ad spend in the window (nothing to divide by). */
    roas: { value: number | null; previous: number | null; change_pct: number | null };
  };
  activity: {
    visitors: Metric;
    chats: Metric;
    new_leads: Metric;
    opt_ins: Metric;
    recommendations: Metric;
    add_to_carts: Metric;
    recovery_emails_sent: Metric;
  };
  agent_active: boolean;
  has_ad_spend_history: boolean;
  /** False until the Shopify checkout pixel sends events: conversion cannot be measured per shopper */
  conversion_tracking: boolean;
}

/** Normalises the browser's getTimezoneOffset() value (minutes, UTC minus local). */
export function normalizeTzOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 14 * 60) return 0;
  return Math.round(n);
}

function localDateString(instant: Date, tzOffsetMinutes: number): string {
  return new Date(instant.getTime() - tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}

/**
 * Current window: from local midnight (range days back) until now.
 * Previous window: the same length immediately before it, so "today so far" compares with
 * "yesterday until the same time".
 */
export function resolveWindows(range: HomeRange, tzOffsetMinutes: number, now: Date = new Date()) {
  const days = RANGE_DAYS[range];
  const localNowMs = now.getTime() - tzOffsetMinutes * 60000;
  const localMidnightMs = Math.floor(localNowMs / DAY_MS) * DAY_MS;
  const from = new Date(localMidnightMs + tzOffsetMinutes * 60000 - (days - 1) * DAY_MS);
  const shift = days * DAY_MS;
  const make = (f: Date, t: Date): TimeWindow => ({
    from: f,
    to: t,
    fromDate: localDateString(f, tzOffsetMinutes),
    toDate: localDateString(t, tzOffsetMinutes),
  });
  return {
    current: make(from, now),
    previous: make(new Date(from.getTime() - shift), new Date(now.getTime() - shift)),
  };
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function metric(value: number, previous: number): Metric {
  return {
    value: round(value),
    previous: round(previous),
    change_pct: previous > 0 ? round(((value - previous) / previous) * 100, 1) : null,
  };
}

interface WindowTotals {
  revenue: number;
  orders: number;
  aiRevenue: number;
  visitors: number;
  purchasers: number;
  spend: number;
  chats: number;
  leads: number;
  optIns: number;
  recommendations: number;
  addToCarts: number;
  emailsSent: number;
}

async function count(db: IDatabaseClient, sql: string, params: unknown[]): Promise<number> {
  const res = await db.query(sql, params);
  return Number(res.rows[0]?.n || 0);
}

async function windowTotals(
  db: IDatabaseClient,
  storeId: string,
  w: TimeWindow,
  source: HomeMetrics['revenue_source']
): Promise<WindowTotals> {
  const range = [storeId, w.from.toISOString(), w.to.toISOString()];
  const between = (col: string) => `${col} >= $2::timestamptz AND ${col} <= $3::timestamptz`;

  const ordersQuery =
    source === 'shopify'
      ? db.query(
          `SELECT COUNT(*) AS orders,
                  COALESCE(SUM(total_price - total_refunded), 0) AS revenue,
                  0 AS ai_revenue
           FROM shopify_orders
           WHERE store_id = $1 AND cancelled_at IS NULL AND is_test = false AND ${between('created_at_shop')}`,
          range
        )
      : source === 'orders'
      ? db.query(
          `SELECT COUNT(*) AS orders,
                  COALESCE(SUM(order_revenue), 0) AS revenue,
                  COALESCE(SUM(CASE WHEN is_ai_assisted THEN order_revenue ELSE 0 END), 0) AS ai_revenue
           FROM order_attributions
           WHERE store_id = $1 AND ${between('COALESCE(order_created_at, created_at)')}`,
          range
        )
      : db.query(
          `SELECT COUNT(*) AS orders,
                  COALESCE(SUM(CAST(payload->>'total_price' AS NUMERIC)), 0) AS revenue,
                  0 AS ai_revenue
           FROM events
           WHERE store_id = $1 AND type = 'purchase_completed' AND ${between('created_at')}`,
          range
        );

  const [orders, funnel, spend, chats, leads, optIns, recs, carts, emails] = await Promise.all([
    ordersQuery,
    db.query(
      `SELECT COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(DISTINCT CASE WHEN type = 'purchase_completed' THEN visitor_id END) AS purchasers
       FROM events WHERE store_id = $1 AND ${between('created_at')}`,
      range
    ),
    db.query(
      `SELECT COALESCE(SUM(spend_amount), 0) AS n FROM ad_spend
       WHERE store_id = $1 AND spend_date >= $2::date AND spend_date <= $3::date`,
      [storeId, w.fromDate, w.toDate]
    ),
    count(db, `SELECT COUNT(*) AS n FROM chat_sessions WHERE store_id = $1 AND ${between('started_at')}`, range),
    count(db, `SELECT COUNT(*) AS n FROM visitors WHERE store_id = $1 AND email IS NOT NULL AND ${between('created_at')}`, range),
    count(db, `SELECT COUNT(*) AS n FROM marketing_consents WHERE store_id = $1 AND opted_in = true AND ${between('captured_at')}`, range),
    count(db, `SELECT COUNT(*) AS n FROM recommendations WHERE store_id = $1 AND ${between('created_at')}`, range),
    count(db, `SELECT COUNT(*) AS n FROM events WHERE store_id = $1 AND type = 'add_to_cart' AND ${between('created_at')}`, range),
    count(db, `SELECT COUNT(*) AS n FROM email_campaign_events WHERE store_id = $1 AND status = 'sent' AND ${between('sent_at')}`, range),
  ]);

  const o = orders.rows[0] || {};
  const f = funnel.rows[0] || {};
  // Shopify totals are complete; AI-assisted revenue still comes from the attribution ledger
  let aiRevenue = Number(o.ai_revenue || 0);
  if (source === 'shopify') {
    const ai = await db.query(
      `SELECT COALESCE(SUM(order_revenue), 0) AS n FROM order_attributions
       WHERE store_id = $1 AND is_ai_assisted = true AND ${between('COALESCE(order_created_at, created_at)')}`,
      range
    );
    aiRevenue = Number(ai.rows[0]?.n || 0);
  }
  return {
    revenue: Number(o.revenue || 0),
    orders: Number(o.orders || 0),
    aiRevenue,
    visitors: Number(f.visitors || 0),
    // Tracked shoppers who bought (checkout pixel / webhook-matched), over tracked shoppers
    purchasers: Number(f.purchasers || 0),
    spend: Number(spend.rows[0]?.n || 0),
    chats,
    leads,
    optIns,
    recommendations: recs,
    addToCarts: carts,
    emailsSent: emails,
  };
}

export async function getHomeMetrics(
  db: IDatabaseClient,
  storeId: string,
  range: HomeRange,
  tzOffsetMinutes: number,
  now: Date = new Date()
): Promise<HomeMetrics> {
  const { current, previous } = resolveWindows(range, tzOffsetMinutes, now);

  const [storeRes, shopifyOrderCount, attributionCount, spendHistory, assistant, pixelEvents] = await Promise.all([
    db.query('SELECT currency FROM stores WHERE id = $1', [storeId]),
    count(db, 'SELECT COUNT(*) AS n FROM shopify_orders WHERE store_id = $1', [storeId]).catch(() => 0),
    count(db, 'SELECT COUNT(*) AS n FROM order_attributions WHERE store_id = $1', [storeId]),
    count(db, 'SELECT COUNT(*) AS n FROM ad_spend WHERE store_id = $1', [storeId]),
    db.query('SELECT is_active FROM assistant_settings WHERE store_id = $1', [storeId]),
    db.query(`SELECT 1 FROM events WHERE store_id = $1 AND payload->>'source' = 'shopify_pixel' LIMIT 1`, [storeId]).catch(() => ({ rows: [] as any[] })),
  ]);

  // One revenue source per store (never mixed between windows), matching the Growth Copilot
  const source: HomeMetrics['revenue_source'] =
    shopifyOrderCount > 0 ? 'shopify' : attributionCount > 0 ? 'orders' : 'storefront_events';
  const [cur, prev] = await Promise.all([
    windowTotals(db, storeId, current, source),
    windowTotals(db, storeId, previous, source),
  ]);

  const aov = (t: WindowTotals) => (t.orders > 0 ? t.revenue / t.orders : 0);
  const conv = (t: WindowTotals) => (t.visitors > 0 ? Math.min(100, (t.purchasers / t.visitors) * 100) : 0);
  const roas = (t: WindowTotals) => (t.spend > 0 ? round(t.revenue / t.spend) : null);
  const curRoas = roas(cur);
  const prevRoas = roas(prev);

  return {
    range,
    currency: storeRes.rows[0]?.currency || 'INR',
    window: { from: current.from.toISOString(), to: current.to.toISOString() },
    previous_window: { from: previous.from.toISOString(), to: previous.to.toISOString() },
    revenue_source: source,
    kpis: {
      revenue: metric(cur.revenue, prev.revenue),
      orders: metric(cur.orders, prev.orders),
      average_order_value: metric(aov(cur), aov(prev)),
      conversion_rate: metric(conv(cur), conv(prev)),
      ai_assisted_revenue: metric(cur.aiRevenue, prev.aiRevenue),
      ad_spend: metric(cur.spend, prev.spend),
      roas: {
        value: curRoas,
        previous: prevRoas,
        change_pct: curRoas !== null && prevRoas !== null && prevRoas > 0 ? round(((curRoas - prevRoas) / prevRoas) * 100, 1) : null,
      },
    },
    activity: {
      visitors: metric(cur.visitors, prev.visitors),
      chats: metric(cur.chats, prev.chats),
      new_leads: metric(cur.leads, prev.leads),
      opt_ins: metric(cur.optIns, prev.optIns),
      recommendations: metric(cur.recommendations, prev.recommendations),
      add_to_carts: metric(cur.addToCarts, prev.addToCarts),
      recovery_emails_sent: metric(cur.emailsSent, prev.emailsSent),
    },
    agent_active: assistant.rows[0]?.is_active !== false,
    has_ad_spend_history: spendHistory > 0,
    conversion_tracking: pixelEvents.rows.length > 0,
  };
}
