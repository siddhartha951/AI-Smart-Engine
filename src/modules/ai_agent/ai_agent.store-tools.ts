/**
 * Ask AI tools over the store's whole Shopify picture: sales trend, orders, one order,
 * products, customers, coupons, payments, inventory, funnel and Growth Copilot actions.
 *
 * They read the mirrored shopify_orders (kept fresh by the orders sync), so answers are fast
 * and every number is real. Customers are shown as anonymous refs (C-1a2b3c), never by email.
 * When orders are not synced (or a Shopify permission is missing) the tool says so plainly.
 */
import { getDatabaseClient } from '../../database/client';
import { AnalyticsRepository } from '../analytics/analytics.repository';
import { getDataStatus } from '../shopify_data/data-status.service';
import { ShopifyOrdersRepository } from '../shopify_data/orders.repository';
import {
  customerInsights,
  dailySeries,
  discountPerformance,
  loadRecentOrders,
  paymentSummary,
  productPerformance,
  salesTotals,
} from '../shopify_data/order-analytics';
import { adminGraphql, getAdminCredentials, graphqlAccessDenied } from '../../providers/shopify/admin-client';
import { fetchOrderCardById } from '../order_assist/order-lookup.service';
import { AgentToolResult } from './ai_agent.types';

export type StoreToolName =
  | 'get_sales_trend'
  | 'search_orders'
  | 'get_order_details'
  | 'get_product_performance'
  | 'get_customer_insights'
  | 'get_discount_performance'
  | 'get_payments_summary'
  | 'get_inventory_alerts'
  | 'get_funnel_summary'
  | 'get_growth_actions';

type Args = Record<string, unknown>;

const DAYS_PARAM = { type: 'integer', description: 'Days back from today (7, 14, 30, 90 or 365; default 30)' };

export const STORE_TOOLS: Array<{ name: StoreToolName; description: string; parameters: Record<string, unknown> }> = [
  {
    name: 'get_sales_trend',
    description: 'Daily Shopify sales (orders, revenue after refunds) for a period, with totals, average order value, discounts, refunds and the change vs the previous period of the same length. Use for trends, growth, "how are sales", comparisons.',
    parameters: { type: 'object', properties: { days: DAYS_PARAM }, additionalProperties: false },
  },
  {
    name: 'search_orders',
    description: 'List recent orders (number, date, total, payment and fulfilment status, item count). Filter: unfulfilled, pending_payment, refunded, cancelled or any. Use for "which orders are not shipped", "pending COD", "latest orders".',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['any', 'unfulfilled', 'pending_payment', 'refunded', 'cancelled'] },
        limit: { type: 'integer', description: 'Max orders (default 15, max 50)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_order_details',
    description: 'Full details of one order by its number (e.g. 1234 or #1234): status, items, totals, discounts, payment gateway, fulfilment and tracking.',
    parameters: { type: 'object', properties: { order_number: { type: 'string' } }, required: ['order_number'], additionalProperties: false },
  },
  {
    name: 'get_product_performance',
    description: 'Best and worst selling products for a period (units, revenue, orders) with stock status, plus in-stock products that did not sell at all. Use for best sellers, slow movers, what to promote or restock.',
    parameters: { type: 'object', properties: { days: DAYS_PARAM, limit: { type: 'integer', description: 'Products per list (default 10)' } }, additionalProperties: false },
  },
  {
    name: 'get_customer_insights',
    description: 'Customers in a period: number of buyers, returning-customer share, revenue per customer, guest orders and the top customers (anonymous refs). Use for retention, loyalty, repeat purchase questions.',
    parameters: { type: 'object', properties: { days: DAYS_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_discount_performance',
    description: 'Coupon / discount code usage for a period (orders, revenue, discount given per code, share of orders with a code) plus the discount codes currently set up in Shopify. Use for coupon and promotion questions.',
    parameters: { type: 'object', properties: { days: DAYS_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_payments_summary',
    description: 'Payments for a period: orders and amount by payment status (paid, pending, refunded...) and by gateway (COD, Razorpay, Shopify Payments...), refunded amount, and paid orders not yet shipped.',
    parameters: { type: 'object', properties: { days: DAYS_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_inventory_alerts',
    description: 'Stock problems: best sellers (last 30 days) that are out of stock, and how many catalogue products are out of stock.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_funnel_summary',
    description: 'Storefront funnel for a period: visitors, assistant chats, product views, add to cart, checkout, purchases and drop-off at each step.',
    parameters: { type: 'object', properties: { days: DAYS_PARAM }, additionalProperties: false },
  },
  {
    name: 'get_growth_actions',
    description: "The Growth Copilot's current prioritised actions for this store (title, priority, reason, estimated opportunity) and the merchant's primary goal.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function days(args: Args, fallback = 30): number {
  const n = parseInt(String(args.days ?? fallback), 10);
  return Math.max(1, Math.min(Number.isFinite(n) ? n : fallback, 365));
}

/** Honest note when orders are not in yet, naming the blocking permission if there is one. */
async function ordersUnavailable(storeId: string): Promise<AgentToolResult> {
  const status = await getDataStatus(storeId).catch(() => null);
  const feed = status?.feeds.find((f) => f.key === 'orders');
  let note = 'Shopify orders are not synced for this store yet. Tell the merchant to open Settings → Shopify connection → "Sync orders now".';
  if (!status?.connection.connected) note = 'Shopify is not connected for this store. Tell the merchant to paste the Admin API access token in Settings → Shopify connection.';
  else if (feed?.status === 'blocked') note = `Orders are blocked because the Shopify access token is missing the ${feed.missing_required.join(', ')} permission. Tell the merchant to add it in Shopify (custom app → Admin API scopes) and re-check in Settings → Shopify connection.`;
  return { ok: false, note };
}

async function withOrders(storeId: string, periodDays: number) {
  return loadRecentOrders(getDatabaseClient(), storeId, periodDays);
}

async function salesTrend(storeId: string, args: Args): Promise<AgentToolResult> {
  const d = days(args);
  const { available, orders } = await withOrders(storeId, d * 2);
  if (!available) return ordersUnavailable(storeId);
  const cut = Date.now() - d * 24 * 60 * 60 * 1000;
  const current = orders.filter((o) => new Date(o.created_at_shop).getTime() >= cut);
  const previous = orders.filter((o) => new Date(o.created_at_shop).getTime() < cut);
  const cur = salesTotals(current);
  const prev = salesTotals(previous);
  const change = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  return {
    ok: true,
    data: {
      period_days: d,
      currency: current.find((o) => o.currency)?.currency || null,
      totals: cur,
      previous_period: prev,
      change_pct: { revenue: change(cur.revenue, prev.revenue), orders: change(cur.orders, prev.orders), aov: change(cur.average_order_value, prev.average_order_value) },
      daily: d <= 31 ? dailySeries(current, d) : undefined,
    },
  };
}

async function searchOrders(storeId: string, args: Args): Promise<AgentToolResult> {
  const repo = new ShopifyOrdersRepository(getDatabaseClient());
  if (!(await repo.count(storeId))) return ordersUnavailable(storeId);
  const limit = Math.max(1, Math.min(parseInt(String(args.limit || 15), 10) || 15, 50));
  const filter = String(args.filter || 'any');
  let rows = await repo.recent(storeId, {
    limit: filter === 'any' ? limit : 100,
    financialStatus: filter === 'pending_payment' ? 'pending' : filter === 'refunded' ? 'refunded' : undefined,
    fulfillmentStatus: filter === 'unfulfilled' ? 'unfulfilled' : undefined,
  });
  if (filter === 'cancelled') rows = (await repo.recent(storeId, { limit: 100 })).filter((o) => o.cancelled_at);
  return {
    ok: true,
    data: {
      filter,
      orders: rows.slice(0, limit).map((o) => ({
        order: o.name,
        date: o.created_at_shop,
        total: o.total_price,
        currency: o.currency,
        payment: o.financial_status,
        fulfilment: o.fulfillment_status || 'unfulfilled',
        items: o.item_count,
        cancelled: Boolean(o.cancelled_at),
      })),
    },
  };
}

async function orderDetails(storeId: string, args: Args): Promise<AgentToolResult> {
  const db = getDatabaseClient();
  const ref = String(args.order_number || '').trim();
  if (!ref) return { ok: false, note: 'Ask the merchant for the order number.' };
  const repo = new ShopifyOrdersRepository(db);
  const o = await repo.findByReference(storeId, ref);
  if (!o) {
    if (!(await repo.count(storeId))) return ordersUnavailable(storeId);
    return { ok: false, note: `No order ${ref} was found in the synced Shopify orders.` };
  }
  const live = await fetchOrderCardById(storeId, o.shopify_order_id, { db }).catch(() => null);
  return {
    ok: true,
    data: {
      order: o.name,
      placed: o.created_at_shop,
      status: live?.status_label || null,
      payment: o.financial_status,
      fulfilment: o.fulfillment_status || 'unfulfilled',
      cancelled_at: o.cancelled_at,
      total: o.total_price,
      discounts: o.total_discounts,
      shipping: o.total_shipping,
      refunded: o.total_refunded,
      currency: o.currency,
      discount_codes: o.discount_codes,
      gateways: o.payment_gateways,
      items: o.line_items.map((li) => ({ title: li.title, variant: li.variant_title, quantity: li.quantity, price: li.price })),
      tracking: live?.tracking || [],
      ship_to: [o.shipping_city, o.shipping_country].filter(Boolean).join(', ') || null,
      source: o.source_name,
      customer_ref: o.customer_id ? `C-${o.customer_id.slice(-6)}` : 'guest',
      customer_order_count: o.customer_orders_count,
    },
  };
}

async function productStock(storeId: string): Promise<Map<string, boolean>> {
  const res = await getDatabaseClient().query('SELECT shopify_id, in_stock FROM products WHERE store_id = $1', [storeId]).catch(() => ({ rows: [] as any[] }));
  return new Map(res.rows.map((p: any) => [String(p.shopify_id || '').replace(/\D/g, ''), p.in_stock !== false]));
}

async function productPerformanceTool(storeId: string, args: Args): Promise<AgentToolResult> {
  const d = days(args);
  const limit = Math.max(3, Math.min(parseInt(String(args.limit || 10), 10) || 10, 25));
  const { available, orders } = await withOrders(storeId, d);
  if (!available) return ordersUnavailable(storeId);
  const perf = productPerformance(orders);
  const stock = await productStock(storeId);
  const withStock = (p: (typeof perf)[number]) => ({ ...p, in_stock: p.product_id ? stock.get(String(p.product_id).replace(/\D/g, '')) ?? null : null });
  const sold = new Set(perf.map((p) => String(p.product_id || '').replace(/\D/g, '')));
  const catalog = await getDatabaseClient().query(
    `SELECT shopify_id, title FROM products WHERE store_id = $1 AND in_stock = true AND COALESCE(is_active, true) = true ORDER BY title LIMIT 500`,
    [storeId]
  ).catch(() => ({ rows: [] as any[] }));
  const notSelling = catalog.rows.filter((p: any) => !sold.has(String(p.shopify_id || '').replace(/\D/g, ''))).slice(0, limit).map((p: any) => p.title);
  return {
    ok: true,
    data: {
      period_days: d,
      best_sellers: perf.slice(0, limit).map(withStock),
      lowest_sellers: perf.slice(-Math.min(limit, Math.max(0, perf.length - limit))).reverse().map(withStock),
      in_stock_not_sold: notSelling,
      products_sold: perf.length,
    },
  };
}

async function customerTool(storeId: string, args: Args): Promise<AgentToolResult> {
  const d = days(args, 90);
  const { available, orders } = await withOrders(storeId, d);
  if (!available) return ordersUnavailable(storeId);
  return { ok: true, data: { period_days: d, ...customerInsights(orders) } };
}

async function liveDiscountCodes(storeId: string): Promise<{ codes?: Array<{ title: string; status: string; codes: string[]; ends_at: string | null }>; note?: string }> {
  const creds = await getAdminCredentials(storeId);
  if (!creds) return { note: 'Shopify is not connected.' };
  const res = await adminGraphql(creds, `{ codeDiscountNodes(first: 20, reverse: true) { nodes { codeDiscount {
    ... on DiscountCodeBasic { title status endsAt codes(first: 3) { nodes { code } } }
    ... on DiscountCodeBxgy { title status endsAt codes(first: 3) { nodes { code } } }
    ... on DiscountCodeFreeShipping { title status endsAt codes(first: 3) { nodes { code } } } } } } }`);
  if (res.status === 403 || graphqlAccessDenied(res.body)) return { note: 'The list of discount codes needs the read_discounts permission on the Shopify token.' };
  const nodes: any[] = res.body?.data?.codeDiscountNodes?.nodes || [];
  return {
    codes: nodes.map((n) => n?.codeDiscount).filter(Boolean).map((c) => ({
      title: c.title,
      status: c.status,
      codes: (c.codes?.nodes || []).map((x: any) => x.code),
      ends_at: c.endsAt || null,
    })),
  };
}

async function discountTool(storeId: string, args: Args): Promise<AgentToolResult> {
  const d = days(args);
  const { available, orders } = await withOrders(storeId, d);
  if (!available) return ordersUnavailable(storeId);
  const live = await liveDiscountCodes(storeId).catch(() => ({ note: 'Could not read discount codes from Shopify right now.' }));
  return { ok: true, data: { period_days: d, usage: discountPerformance(orders), shopify_discount_codes: live } };
}

async function paymentsTool(storeId: string, args: Args): Promise<AgentToolResult> {
  const d = days(args);
  const { available, orders } = await withOrders(storeId, d);
  if (!available) return ordersUnavailable(storeId);
  return { ok: true, data: { period_days: d, ...paymentSummary(orders) } };
}

async function inventoryTool(storeId: string): Promise<AgentToolResult> {
  const db = getDatabaseClient();
  const counts = await db.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE in_stock = false) AS out_of_stock FROM products WHERE store_id = $1 AND COALESCE(is_active, true) = true`,
    [storeId]
  ).catch(() => ({ rows: [{ total: 0, out_of_stock: 0 }] }));
  const { available, orders } = await withOrders(storeId, 30);
  const stock = await productStock(storeId);
  const soldOut = available
    ? productPerformance(orders).slice(0, 20).filter((p) => p.product_id && stock.get(String(p.product_id).replace(/\D/g, '')) === false)
    : [];
  return {
    ok: true,
    data: {
      catalog_products: Number(counts.rows[0]?.total || 0),
      out_of_stock_products: Number(counts.rows[0]?.out_of_stock || 0),
      best_sellers_out_of_stock: soldOut.map((p) => ({ title: p.title, units_last_30_days: p.units, revenue_last_30_days: p.revenue })),
      note: available ? 'Stock comes from the last Catalog Sync.' : 'Orders are not synced, so best-seller stock alerts are unavailable.',
    },
  };
}

async function funnelTool(storeId: string, args: Args): Promise<AgentToolResult> {
  const funnel = await new AnalyticsRepository(getDatabaseClient()).getConversionFunnel(storeId, days(args, 7));
  return { ok: true, data: funnel };
}

async function growthActionsTool(storeId: string): Promise<AgentToolResult> {
  // Imported lazily: the Growth Copilot pulls in the AI layer, which the tools must not load eagerly
  const { GrowthService } = await import('../growth/growth.service');
  const svc = new GrowthService();
  const [goal, actions] = await Promise.all([svc.getGoal(storeId), svc.getTodayActions(storeId)]);
  return {
    ok: true,
    data: {
      primary_goal: goal.primary_goal,
      actions: actions.filter((a) => a.status === 'pending' || a.status === 'in_progress').slice(0, 10).map((a) => ({
        title: a.title,
        priority: a.priority,
        reason: a.reason,
        estimated_opportunity: Number(a.estimated_opportunity || 0),
        open_in: a.target_module,
      })),
    },
  };
}

export const STORE_EXECUTORS: Record<StoreToolName, (storeId: string, args: Args) => Promise<AgentToolResult>> = {
  get_sales_trend: salesTrend,
  search_orders: searchOrders,
  get_order_details: orderDetails,
  get_product_performance: productPerformanceTool,
  get_customer_insights: customerTool,
  get_discount_performance: discountTool,
  get_payments_summary: paymentsTool,
  get_inventory_alerts: (storeId) => inventoryTool(storeId),
  get_funnel_summary: funnelTool,
  get_growth_actions: (storeId) => growthActionsTool(storeId),
};
