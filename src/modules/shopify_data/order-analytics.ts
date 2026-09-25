/**
 * Numbers derived from the mirrored Shopify orders: sales trend, product performance,
 * customers, coupons and payments. Pure functions over StoredOrder[] (plus one loader),
 * shared by the Growth Copilot and the merchant Ask AI tools, so both always agree.
 */
import { IDatabaseClient } from '../../database/client';
import { ShopifyOrdersRepository, StoredOrder } from './orders.repository';

const DAY = 24 * 60 * 60 * 1000;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function counted(o: StoredOrder): boolean {
  return !o.cancelled_at && !o.is_test;
}

export function salesTotals(orders: StoredOrder[]) {
  const live = orders.filter(counted);
  const revenue = live.reduce((s, o) => s + o.net_revenue, 0);
  const gross = live.reduce((s, o) => s + o.total_price + o.total_discounts, 0);
  const discounts = live.reduce((s, o) => s + o.total_discounts, 0);
  const refunded = live.reduce((s, o) => s + o.total_refunded, 0);
  return {
    orders: live.length,
    revenue: r2(revenue),
    average_order_value: live.length ? r2(revenue / live.length) : 0,
    discounts: r2(discounts),
    discount_share_pct: gross > 0 ? r2((discounts / gross) * 100) : 0,
    refunded: r2(refunded),
    refund_rate_pct: revenue + refunded > 0 ? r2((refunded / (revenue + refunded)) * 100) : 0,
    cancelled: orders.filter((o) => o.cancelled_at && !o.is_test).length,
    single_item_share_pct: live.length ? r2((live.filter((o) => o.item_count <= 1).length / live.length) * 100) : 0,
  };
}

export function dailySeries(orders: StoredOrder[], days: number, now = new Date()): Array<{ date: string; orders: number; revenue: number }> {
  const map = new Map<string, { orders: number; revenue: number }>();
  for (let i = days - 1; i >= 0; i--) {
    map.set(new Date(now.getTime() - i * DAY).toISOString().slice(0, 10), { orders: 0, revenue: 0 });
  }
  for (const o of orders.filter(counted)) {
    const key = o.created_at_shop.slice(0, 10);
    const e = map.get(key);
    if (e) {
      e.orders += 1;
      e.revenue = r2(e.revenue + o.net_revenue);
    }
  }
  return [...map.entries()].map(([date, v]) => ({ date, ...v }));
}

export interface ProductSales {
  product_id: string | null;
  title: string;
  units: number;
  revenue: number;
  orders: number;
}

export function productPerformance(orders: StoredOrder[]): ProductSales[] {
  const map = new Map<string, ProductSales>();
  for (const o of orders.filter(counted)) {
    const seen = new Set<string>();
    for (const li of o.line_items || []) {
      const key = li.product_id || li.title;
      const e = map.get(key) || { product_id: li.product_id || null, title: li.title, units: 0, revenue: 0, orders: 0 };
      e.units += li.quantity;
      e.revenue = r2(e.revenue + li.quantity * li.price);
      if (!seen.has(key)) {
        e.orders += 1;
        seen.add(key);
      }
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export function customerInsights(orders: StoredOrder[]) {
  const byCustomer = new Map<string, { orders: number; revenue: number; last: string; lifetimeOrders: number | null }>();
  let guest = 0;
  for (const o of orders.filter(counted)) {
    const id = o.customer_id || o.customer_email_hash;
    if (!id) {
      guest += 1;
      continue;
    }
    const e = byCustomer.get(id) || { orders: 0, revenue: 0, last: '', lifetimeOrders: null };
    e.orders += 1;
    e.revenue = r2(e.revenue + o.net_revenue);
    if (o.created_at_shop > e.last) e.last = o.created_at_shop;
    if (o.customer_orders_count !== null) e.lifetimeOrders = Math.max(e.lifetimeOrders || 0, o.customer_orders_count);
    byCustomer.set(id, e);
  }
  const customers = [...byCustomer.values()];
  // Returning = more than one order in the period, or Shopify says they had earlier orders
  const returning = customers.filter((c) => c.orders > 1 || (c.lifetimeOrders !== null && c.lifetimeOrders > 1)).length;
  const revenue = customers.reduce((s, c) => s + c.revenue, 0);
  const top = [...byCustomer.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10)
    .map(([id, c], i) => ({ rank: i + 1, customer_ref: `C-${String(id).slice(-6)}`, orders: c.orders, revenue: c.revenue, last_order_at: c.last }));
  return {
    customers: customers.length,
    guest_orders: guest,
    returning_customers: returning,
    repeat_customer_share_pct: customers.length ? r2((returning / customers.length) * 100) : 0,
    revenue_per_customer: customers.length ? r2(revenue / customers.length) : 0,
    top_customers: top,
  };
}

export function discountPerformance(orders: StoredOrder[]) {
  const map = new Map<string, { code: string; orders: number; revenue: number; discount: number }>();
  for (const o of orders.filter(counted)) {
    for (const d of o.discount_codes || []) {
      const code = String(d.code || '').toUpperCase();
      if (!code) continue;
      const e = map.get(code) || { code, orders: 0, revenue: 0, discount: 0 };
      e.orders += 1;
      e.revenue = r2(e.revenue + o.net_revenue);
      e.discount = r2(e.discount + (d.amount || 0));
      map.set(code, e);
    }
  }
  const live = orders.filter(counted);
  const withCode = live.filter((o) => (o.discount_codes || []).length > 0).length;
  return {
    orders_with_code: withCode,
    orders_with_code_pct: live.length ? r2((withCode / live.length) * 100) : 0,
    codes: [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 20),
  };
}

export function paymentSummary(orders: StoredOrder[]) {
  const byStatus: Record<string, { orders: number; amount: number }> = {};
  const byGateway: Record<string, { orders: number; amount: number }> = {};
  for (const o of orders.filter((x) => !x.is_test)) {
    const s = o.financial_status || 'unknown';
    byStatus[s] = byStatus[s] || { orders: 0, amount: 0 };
    byStatus[s].orders += 1;
    byStatus[s].amount = r2(byStatus[s].amount + o.total_price);
    for (const g of o.payment_gateways.length ? o.payment_gateways : ['unknown']) {
      byGateway[g] = byGateway[g] || { orders: 0, amount: 0 };
      byGateway[g].orders += 1;
      byGateway[g].amount = r2(byGateway[g].amount + o.total_price);
    }
  }
  const pending = byStatus.pending || { orders: 0, amount: 0 };
  return {
    by_financial_status: byStatus,
    by_gateway: byGateway,
    pending_payment: pending,
    refunded_amount: r2(orders.filter(counted).reduce((s, o) => s + o.total_refunded, 0)),
    unfulfilled_paid_orders: orders.filter((o) => counted(o) && !o.fulfillment_status && o.financial_status === 'paid').length,
  };
}

/** Last N days of mirrored orders, plus whether the store has any mirrored orders at all. */
export async function loadRecentOrders(db: IDatabaseClient, storeId: string, days: number, now = new Date()) {
  const repo = new ShopifyOrdersRepository(db);
  const total = await repo.count(storeId).catch(() => 0);
  if (!total) return { available: false, orders: [] as StoredOrder[] };
  const orders = await repo.listInWindow(storeId, new Date(now.getTime() - days * DAY), now);
  return { available: true, orders };
}

/** Everything the Growth Copilot rules read from real orders (last 30 days vs the 7-day trend). */
export async function storeOrderTelemetry(db: IDatabaseClient, storeId: string, now = new Date()) {
  const { available, orders } = await loadRecentOrders(db, storeId, 30, now);
  if (!available) return null;
  const last7 = orders.filter((o) => new Date(o.created_at_shop).getTime() >= now.getTime() - 7 * DAY);
  const prev7 = orders.filter((o) => {
    const t = new Date(o.created_at_shop).getTime();
    return t < now.getTime() - 7 * DAY && t >= now.getTime() - 14 * DAY;
  });
  const products = productPerformance(orders);

  // Best sellers that are out of stock right now (products table is refreshed by Catalog Sync)
  const stockRes = await db.query('SELECT shopify_id, title, in_stock FROM products WHERE store_id = $1', [storeId]).catch(() => ({ rows: [] as any[] }));
  const outOfStock = new Set<string>(
    stockRes.rows.filter((p: any) => p.in_stock === false).map((p: any) => String(p.shopify_id || '').replace(/\D/g, ''))
  );
  const soldOut = products.slice(0, 10).filter((p) => p.product_id && outOfStock.has(String(p.product_id).replace(/\D/g, '')));

  return {
    window_days: 30,
    totals: salesTotals(orders),
    last7: salesTotals(last7),
    prev7: salesTotals(prev7),
    customers: customerInsights(orders),
    top_products: products.slice(0, 5),
    sold_out_bestsellers: soldOut.slice(0, 3),
    currency: orders.find((o) => o.currency)?.currency || null,
  };
}

export type StoreOrderTelemetry = NonNullable<Awaited<ReturnType<typeof storeOrderTelemetry>>>;
