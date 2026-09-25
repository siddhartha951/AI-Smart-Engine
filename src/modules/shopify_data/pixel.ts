/**
 * Shopify "Customer events" custom pixel: the only way to see checkout and thank-you pages,
 * where theme scripts (our widget) never run. The merchant pastes buildPixelSnippet() into
 * Shopify admin → Settings → Customer events → Add custom pixel.
 *
 * Events join the widget's visitor (same ai_visitor_id in the storefront's localStorage),
 * so the funnel follows one shopper from product view to purchase. Purchases already
 * recorded by the order webhook are never counted twice.
 */
import { IDatabaseClient } from '../../database/client';
import { SyncStateRepository } from './sync-state.repository';

export const PIXEL_EVENT_TYPES: Record<string, string> = {
  product_viewed: 'product_view',
  product_added_to_cart: 'add_to_cart',
  checkout_started: 'checkout_started',
  checkout_completed: 'purchase_completed',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** "gid://shopify/Order/123" or "123" -> "123" */
export function numericId(v: unknown): string | null {
  const m = String(v ?? '').match(/(\d{3,})\s*$/);
  return m ? m[1] : null;
}

/** Only the fields the dashboard uses; nothing about the buyer. */
export function pixelPayload(shopifyEvent: string, data: any): Record<string, unknown> {
  const out: Record<string, unknown> = { source: 'shopify_pixel' };
  if (shopifyEvent === 'product_viewed' || shopifyEvent === 'product_added_to_cart') {
    const variant = data?.productVariant || data?.cartLine?.merchandise || {};
    out.product_id = numericId(variant?.product?.id);
    out.variant_id = numericId(variant?.id);
    out.title = String(variant?.product?.title || variant?.title || '').slice(0, 200) || undefined;
    out.price = money(variant?.price?.amount);
    out.currency = variant?.price?.currencyCode || undefined;
    if (shopifyEvent === 'product_added_to_cart') out.quantity = Number(data?.cartLine?.quantity || 1);
  } else {
    const checkout = data?.checkout || {};
    out.total_price = money(checkout?.totalPrice?.amount);
    out.currency = checkout?.currencyCode || checkout?.totalPrice?.currencyCode || undefined;
    if (shopifyEvent === 'checkout_completed') {
      out.order_id = numericId(checkout?.order?.id);
      out.line_items = (Array.isArray(checkout?.lineItems) ? checkout.lineItems : []).slice(0, 50).map((li: any) => ({
        product_id: numericId(li?.variant?.product?.id),
        variant_id: numericId(li?.variant?.id),
        title: String(li?.title || '').slice(0, 200),
        quantity: Number(li?.quantity || 1),
        price: money(li?.variant?.price?.amount),
      }));
    }
  }
  return out;
}

/** The widget's visitor when the pixel could read it, else one pixel visitor per Shopify client id. */
export async function resolvePixelVisitor(db: IDatabaseClient, storeId: string, visitorId: unknown, clientId: unknown): Promise<string | null> {
  if (typeof visitorId === 'string' && UUID_RE.test(visitorId)) {
    const res = await db.query('SELECT id FROM visitors WHERE store_id = $1 AND id = $2', [storeId, visitorId]);
    if (res.rows[0]) return res.rows[0].id;
  }
  const client = String(clientId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90);
  if (!client) return null;
  const anon = `px-${client}`;
  const found = await db.query('SELECT id FROM visitors WHERE store_id = $1 AND anonymous_id = $2', [storeId, anon]);
  if (found.rows[0]) return found.rows[0].id;
  const created = await db.query(
    `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2)
     ON CONFLICT (store_id, anonymous_id) DO UPDATE SET updated_at = NOW() RETURNING id`,
    [storeId, anon]
  );
  return created.rows[0]?.id || null;
}

/** Same purchase already recorded (webhook or an earlier pixel retry) / same cart add from the widget seconds ago */
export async function isDuplicatePixelEvent(db: IDatabaseClient, storeId: string, visitorId: string, type: string, payload: Record<string, unknown>): Promise<boolean> {
  if (type === 'purchase_completed' && payload.order_id) {
    const res = await db.query(
      `SELECT 1 FROM events WHERE store_id = $1 AND type = 'purchase_completed' AND payload->>'order_id' = $2 LIMIT 1`,
      [storeId, String(payload.order_id)]
    );
    return res.rows.length > 0;
  }
  if (type === 'add_to_cart') {
    const res = await db.query(
      `SELECT payload FROM events WHERE store_id = $1 AND visitor_id = $2 AND type = 'add_to_cart'
       AND created_at >= $3::timestamptz ORDER BY created_at DESC LIMIT 5`,
      [storeId, visitorId, new Date(Date.now() - 60 * 1000).toISOString()]
    );
    return res.rows.some((r: any) => {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload || {};
      return !payload.variant_id || String(p.variant_id || '') === String(payload.variant_id) || String(p.product_id || '') === String(payload.product_id);
    });
  }
  return false;
}

const lastNoted = new Map<string, number>();

/** Marks the pixel as working (at most once a minute per store). */
export async function notePixelEvent(db: IDatabaseClient, storeId: string, shopifyEvent: string): Promise<void> {
  const now = Date.now();
  if ((lastNoted.get(storeId) || 0) > now - 60 * 1000) return;
  lastNoted.set(storeId, now);
  const repo = new SyncStateRepository(db);
  const current = await repo.get(storeId, 'pixel');
  const iso = new Date(now).toISOString();
  await repo.save(storeId, 'pixel', {
    status: 'ok',
    last_error: null,
    last_run_at: iso,
    last_success_at: iso,
    details: {
      ...(current?.details || {}),
      last_event_at: iso,
      last_event: shopifyEvent,
      ...(shopifyEvent === 'checkout_completed' ? { last_purchase_at: iso } : {}),
    },
  });
}

/** Code the merchant pastes into Shopify → Settings → Customer events → Add custom pixel. */
export function buildPixelSnippet(apiBase: string, widgetKey: string): string {
  const base = apiBase.replace(/\/+$/, '');
  return `// AI Smart Engine - checkout & product tracking (paste as a Shopify custom pixel)
const AISE_ENDPOINT = ${JSON.stringify(`${base}/api/v1/pixel/events`)};
const AISE_WIDGET_KEY = ${JSON.stringify(widgetKey)};

async function aiseSend(name, event) {
  let visitorId = null;
  try {
    visitorId = (await browser.localStorage.getItem('ai_visitor_id:' + AISE_WIDGET_KEY))
      || (await browser.localStorage.getItem('ai_visitor_id'));
  } catch (e) {}
  try {
    await fetch(AISE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        widget_key: AISE_WIDGET_KEY,
        event: name,
        visitor_id: visitorId,
        client_id: event.clientId,
        data: event.data,
      }),
    });
  } catch (e) {}
}

['product_viewed', 'product_added_to_cart', 'checkout_started', 'checkout_completed'].forEach(function (name) {
  analytics.subscribe(name, function (event) { aiseSend(name, event); });
});
`;
}
