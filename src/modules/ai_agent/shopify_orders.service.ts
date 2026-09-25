/**
 * Minimal Shopify Admin REST order fetcher for the Merchant AI Agent.
 *
 * Reuses the same encrypted credential pattern as LiveShopifyAdapter
 * (store_credentials table + decryptString). Always tenant-scoped by storeId.
 * Only order-level fields needed for summaries — no customer PII is retained.
 */
import { getDatabaseClient } from '../../database/client';
import { decryptString } from '../../utils/crypto';
import { TenantIsolationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { shopifyApiVersion } from '../../providers/shopify/admin-client';

export interface ShopifyOrderSummary {
  id: string;
  name: string;
  created_at: string;
  total_price: number;
  currency: string;
  financial_status: string;
  line_item_count: number;
  top_items: Array<{ title: string; quantity: number; price: number }>;
}

export interface FetchOrdersOptions {
  createdAtMin?: string; // ISO date
  createdAtMax?: string; // ISO date
  limit?: number;
  financialStatus?: string;
}

const REQUEST_TIMEOUT_MS = 20000;

async function getAdminCredentials(storeId: string): Promise<{ adminToken: string; shopDomain: string }> {
  if (!storeId) {
    throw new TenantIsolationError('store_id is required');
  }
  const db = getDatabaseClient();
  const res = await db.query(
    `SELECT c.encrypted_admin_token, c.encryption_iv, s.shop_domain
     FROM store_credentials c
     JOIN stores s ON s.id = c.store_id
     WHERE c.store_id = $1`,
    [storeId]
  );
  if (res.rows.length === 0) {
    throw new TenantIsolationError(`Store credentials not found for ${storeId}`);
  }
  const { encrypted_admin_token, encryption_iv, shop_domain } = res.rows[0];
  return {
    adminToken: decryptString(encrypted_admin_token, encryption_iv),
    shopDomain: shop_domain,
  };
}

/**
 * Fetches orders from the Shopify Admin REST API for a single store.
 * Returns an empty array (never throws for missing data) when the store
 * has no Shopify connection — the caller decides how to surface that.
 */
export async function fetchShopifyOrders(
  storeId: string,
  opts: FetchOrdersOptions = {}
): Promise<{ connected: boolean; orders: ShopifyOrderSummary[]; currency: string }> {
  let creds: { adminToken: string; shopDomain: string };
  try {
    creds = await getAdminCredentials(storeId);
  } catch (err) {
    // No credentials row = Shopify simply isn't connected for this store.
    // (An empty storeId is still a hard isolation violation — rethrown.)
    if (!storeId) throw err;
    logger.warn('AI agent: Shopify not connected for store', { storeId });
    return { connected: false, orders: [], currency: '' };
  }

  const params = new URLSearchParams({
    status: 'any',
    limit: String(Math.min(Math.max(opts.limit || 50, 1), 250)),
    fields: 'id,name,created_at,total_price,currency,financial_status,line_items',
  });
  if (opts.createdAtMin) params.set('created_at_min', opts.createdAtMin);
  if (opts.createdAtMax) params.set('created_at_max', opts.createdAtMax);
  if (opts.financialStatus) params.set('financial_status', opts.financialStatus);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://${creds.shopDomain}/admin/api/${shopifyApiVersion()}/orders.json?${params.toString()}`,
      {
        headers: {
          'X-Shopify-Access-Token': creds.adminToken,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }
    );
    if (res.status === 401 || res.status === 403) {
      logger.warn('AI agent: Shopify token rejected for store', { storeId });
      return { connected: false, orders: [], currency: '' };
    }
    if (!res.ok) {
      logger.warn('AI agent: Shopify orders request failed', { storeId, status: res.status });
      return { connected: true, orders: [], currency: '' };
    }
    const body = (await res.json()) as { orders?: Array<Record<string, unknown>> };
    const rawOrders = Array.isArray(body.orders) ? body.orders : [];
    const orders: ShopifyOrderSummary[] = rawOrders.map((o) => {
      const items = Array.isArray(o.line_items) ? o.line_items : [];
      return {
        id: String(o.id || ''),
        name: String(o.name || ''),
        created_at: String(o.created_at || ''),
        total_price: parseFloat(String(o.total_price || '0')) || 0,
        currency: String(o.currency || ''),
        financial_status: String(o.financial_status || ''),
        line_item_count: items.length,
        top_items: items.slice(0, 5).map((li: Record<string, unknown>) => ({
          title: String(li.title || li.name || 'Item'),
          quantity: parseInt(String(li.quantity || '1'), 10) || 1,
          price: parseFloat(String(li.price || '0')) || 0,
        })),
      };
    });
    return {
      connected: true,
      orders,
      currency: orders[0]?.currency || '',
    };
  } catch {
    logger.warn('AI agent: Shopify orders fetch failed', { storeId });
    return { connected: true, orders: [], currency: '' };
  } finally {
    clearTimeout(timer);
  }
}
