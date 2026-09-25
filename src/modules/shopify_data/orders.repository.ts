/**
 * shopify_orders: the store's real Shopify orders, mirrored by the sync and webhooks.
 * Revenue everywhere = order total minus refunds, excluding cancelled and test orders.
 */
import { IDatabaseClient } from '../../database/client';
import { TenantIsolationError } from '../../utils/errors';
import { ShopifyOrderRow } from './order-mapper';

/** Orders that count as sales */
export const COUNTED_ORDER = `cancelled_at IS NULL AND is_test = false`;

export interface StoredOrder extends ShopifyOrderRow {
  net_revenue: number;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function rowToOrder(r: any): StoredOrder {
  const total = Number(r.total_price || 0);
  const refunded = Number(r.total_refunded || 0);
  return {
    shopify_order_id: String(r.shopify_order_id),
    order_number: r.order_number ?? null,
    name: r.name ?? null,
    created_at_shop: toIso(r.created_at_shop) || '',
    updated_at_shop: toIso(r.updated_at_shop),
    processed_at: toIso(r.processed_at),
    cancelled_at: toIso(r.cancelled_at),
    financial_status: r.financial_status ?? null,
    fulfillment_status: r.fulfillment_status ?? null,
    currency: r.currency ?? null,
    total_price: total,
    subtotal_price: Number(r.subtotal_price || 0),
    total_discounts: Number(r.total_discounts || 0),
    total_tax: Number(r.total_tax || 0),
    total_shipping: Number(r.total_shipping || 0),
    total_refunded: refunded,
    item_count: Number(r.item_count || 0),
    line_items: parseJson(r.line_items, []),
    discount_codes: parseJson(r.discount_codes, []),
    payment_gateways: parseJson(r.payment_gateways, []),
    customer_id: r.customer_id ?? null,
    customer_email_hash: r.customer_email_hash ?? null,
    customer_orders_count: r.customer_orders_count === null || r.customer_orders_count === undefined ? null : Number(r.customer_orders_count),
    source_name: r.source_name ?? null,
    landing_site: r.landing_site ?? null,
    referring_site: r.referring_site ?? null,
    shipping_city: r.shipping_city ?? null,
    shipping_country: r.shipping_country ?? null,
    tags: r.tags ?? null,
    is_test: Boolean(r.is_test),
    net_revenue: Math.round((total - refunded) * 100) / 100,
  };
}

export class ShopifyOrdersRepository {
  constructor(private db: IDatabaseClient) {}

  async upsert(storeId: string, o: ShopifyOrderRow): Promise<void> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    await this.db.query(
      `INSERT INTO shopify_orders (
         store_id, shopify_order_id, order_number, name, created_at_shop, updated_at_shop, processed_at, cancelled_at,
         financial_status, fulfillment_status, currency, total_price, subtotal_price, total_discounts, total_tax,
         total_shipping, total_refunded, item_count, line_items, discount_codes, payment_gateways, customer_id,
         customer_email_hash, customer_orders_count, source_name, landing_site, referring_site, shipping_city,
         shipping_country, tags, is_test, synced_at
       ) VALUES (
         $1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8::timestamptz,
         $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22,
         $23, $24, $25, $26, $27, $28,
         $29, $30, $31, NOW()
       )
       ON CONFLICT (store_id, shopify_order_id) DO UPDATE SET
         order_number = EXCLUDED.order_number, name = EXCLUDED.name,
         created_at_shop = EXCLUDED.created_at_shop, updated_at_shop = EXCLUDED.updated_at_shop,
         processed_at = EXCLUDED.processed_at, cancelled_at = EXCLUDED.cancelled_at,
         financial_status = EXCLUDED.financial_status, fulfillment_status = EXCLUDED.fulfillment_status,
         currency = EXCLUDED.currency, total_price = EXCLUDED.total_price, subtotal_price = EXCLUDED.subtotal_price,
         total_discounts = EXCLUDED.total_discounts, total_tax = EXCLUDED.total_tax,
         total_shipping = EXCLUDED.total_shipping, total_refunded = EXCLUDED.total_refunded,
         item_count = EXCLUDED.item_count, line_items = EXCLUDED.line_items,
         discount_codes = EXCLUDED.discount_codes, payment_gateways = EXCLUDED.payment_gateways,
         customer_id = EXCLUDED.customer_id, customer_email_hash = EXCLUDED.customer_email_hash,
         customer_orders_count = EXCLUDED.customer_orders_count, source_name = EXCLUDED.source_name,
         landing_site = EXCLUDED.landing_site, referring_site = EXCLUDED.referring_site,
         shipping_city = EXCLUDED.shipping_city, shipping_country = EXCLUDED.shipping_country,
         tags = EXCLUDED.tags, is_test = EXCLUDED.is_test, synced_at = NOW()`,
      [
        storeId, o.shopify_order_id, o.order_number, o.name, o.created_at_shop, o.updated_at_shop, o.processed_at, o.cancelled_at,
        o.financial_status, o.fulfillment_status, o.currency, o.total_price, o.subtotal_price, o.total_discounts, o.total_tax,
        o.total_shipping, o.total_refunded, o.item_count, JSON.stringify(o.line_items), JSON.stringify(o.discount_codes),
        JSON.stringify(o.payment_gateways), o.customer_id,
        o.customer_email_hash, o.customer_orders_count, o.source_name, o.landing_site, o.referring_site, o.shipping_city,
        o.shipping_country, o.tags, o.is_test,
      ]
    );
  }

  async count(storeId: string): Promise<number> {
    const res = await this.db.query('SELECT COUNT(*) AS n FROM shopify_orders WHERE store_id = $1', [storeId]);
    return Number(res.rows[0]?.n || 0);
  }

  async latest(storeId: string): Promise<{ created_at: string | null; name: string | null } | null> {
    const res = await this.db.query(
      'SELECT name, created_at_shop FROM shopify_orders WHERE store_id = $1 ORDER BY created_at_shop DESC LIMIT 1',
      [storeId]
    );
    const r = res.rows[0];
    return r ? { created_at: toIso(r.created_at_shop), name: r.name || null } : null;
  }

  /** Orders, net revenue and discounts in [from, to] (counted orders only). */
  async windowTotals(storeId: string, from: Date, to: Date): Promise<{ orders: number; revenue: number; discounts: number }> {
    const res = await this.db.query(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(total_price - total_refunded), 0) AS revenue,
              COALESCE(SUM(total_discounts), 0) AS discounts
       FROM shopify_orders
       WHERE store_id = $1 AND ${COUNTED_ORDER}
         AND created_at_shop >= $2::timestamptz AND created_at_shop <= $3::timestamptz`,
      [storeId, from.toISOString(), to.toISOString()]
    );
    const r = res.rows[0] || {};
    return { orders: Number(r.orders || 0), revenue: Number(r.revenue || 0), discounts: Number(r.discounts || 0) };
  }

  /** Every order in the window (newest first), capped for safety. Includes cancelled/test so callers can report them. */
  async listInWindow(storeId: string, from: Date, to: Date, limit = 5000): Promise<StoredOrder[]> {
    const res = await this.db.query(
      `SELECT * FROM shopify_orders
       WHERE store_id = $1 AND created_at_shop >= $2::timestamptz AND created_at_shop <= $3::timestamptz
       ORDER BY created_at_shop DESC LIMIT $4`,
      [storeId, from.toISOString(), to.toISOString(), Math.max(1, Math.min(limit, 20000))]
    );
    return res.rows.map(rowToOrder);
  }

  async findByReference(storeId: string, ref: string): Promise<StoredOrder | null> {
    const clean = ref.replace(/^#/, '').trim();
    if (!clean) return null;
    const res = await this.db.query(
      `SELECT * FROM shopify_orders
       WHERE store_id = $1 AND (order_number = $2 OR name = $3 OR name = $4 OR LOWER(name) = LOWER($4))
       ORDER BY created_at_shop DESC LIMIT 1`,
      [storeId, clean, `#${clean}`, clean]
    );
    return res.rows[0] ? rowToOrder(res.rows[0]) : null;
  }

  /** Recent orders, optionally filtered by financial / fulfillment status. */
  async recent(
    storeId: string,
    opts: { limit?: number; financialStatus?: string; fulfillmentStatus?: string } = {}
  ): Promise<StoredOrder[]> {
    const params: unknown[] = [storeId];
    let where = 'store_id = $1';
    if (opts.financialStatus) {
      params.push(opts.financialStatus);
      where += ` AND financial_status = $${params.length}`;
    }
    if (opts.fulfillmentStatus === 'unfulfilled') {
      where += ` AND fulfillment_status IS NULL AND ${COUNTED_ORDER}`;
    } else if (opts.fulfillmentStatus) {
      params.push(opts.fulfillmentStatus);
      where += ` AND fulfillment_status = $${params.length}`;
    }
    params.push(Math.max(1, Math.min(opts.limit || 20, 100)));
    const res = await this.db.query(
      `SELECT * FROM shopify_orders WHERE ${where} ORDER BY created_at_shop DESC LIMIT $${params.length}`,
      params
    );
    return res.rows.map(rowToOrder);
  }
}
