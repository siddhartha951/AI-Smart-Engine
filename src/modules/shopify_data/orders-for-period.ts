/**
 * Orders for a period, from the synced mirror when it is complete for that period,
 * otherwise straight from Shopify (all pages). Either way the numbers are built the same
 * way (order total minus refunds, cancelled and test orders left out), so Ask AI, Home
 * and Shopify admin agree.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { AdminResponse, adminGet, getAdminCredentials } from '../../providers/shopify/admin-client';
import { ORDER_SYNC_FIELDS, mapShopifyOrder } from './order-mapper';
import { ShopifyOrdersRepository, StoredOrder, rowToOrder } from './orders.repository';
import { covers, mirrorCoverage } from './mirror-coverage';

const MAX_LIVE_PAGES = 20; // 5,000 orders

export interface PeriodOrders {
  connected: boolean;
  source: 'synced' | 'shopify_live';
  orders: StoredOrder[];
  /** Set when not every order could be read (very large period or a Shopify error) */
  incomplete: boolean;
}

async function liveOrders(db: IDatabaseClient, storeId: string, from: Date, to: Date, get: typeof adminGet): Promise<PeriodOrders> {
  const creds = await getAdminCredentials(storeId, db);
  if (!creds) return { connected: false, source: 'shopify_live', orders: [], incomplete: true };
  const out: StoredOrder[] = [];
  let pageInfo: string | null = null;
  for (let page = 0; page < MAX_LIVE_PAGES; page++) {
    const res: AdminResponse = await get(creds, 'orders.json', pageInfo
      ? { limit: '250', fields: ORDER_SYNC_FIELDS, page_info: pageInfo }
      : { limit: '250', fields: ORDER_SYNC_FIELDS, status: 'any', created_at_min: from.toISOString(), created_at_max: to.toISOString() });
    if (res.status === 401 || res.status === 403) return { connected: false, source: 'shopify_live', orders: out, incomplete: true };
    if (!res.ok) return { connected: true, source: 'shopify_live', orders: out, incomplete: true };
    for (const raw of Array.isArray(res.body?.orders) ? res.body.orders : []) {
      const row = mapShopifyOrder(raw);
      if (row) out.push(rowToOrder({ ...row, line_items: JSON.stringify(row.line_items), discount_codes: JSON.stringify(row.discount_codes), payment_gateways: JSON.stringify(row.payment_gateways) }));
    }
    pageInfo = res.nextPageInfo;
    if (!pageInfo) return { connected: true, source: 'shopify_live', orders: out, incomplete: false };
  }
  return { connected: true, source: 'shopify_live', orders: out, incomplete: true };
}

export async function ordersForPeriod(
  storeId: string,
  from: Date,
  to: Date,
  opts: { db?: IDatabaseClient; get?: typeof adminGet } = {}
): Promise<PeriodOrders> {
  const db = opts.db || getDatabaseClient();
  const coverage = await mirrorCoverage(db, storeId);
  if (covers(coverage, from.toISOString())) {
    const orders = await new ShopifyOrdersRepository(db).listInWindow(storeId, from, to, 20000);
    return { connected: true, source: 'synced', orders, incomplete: false };
  }
  return liveOrders(db, storeId, from, to, opts.get || adminGet);
}
