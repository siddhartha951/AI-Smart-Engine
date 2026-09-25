import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { encryptString } from '../../src/utils/crypto';
import { syncStoreOrders } from '../../src/modules/shopify_data/orders-sync.service';
import { ensureWebhooks } from '../../src/modules/shopify_data/webhooks.service';
import { executeAgentTool } from '../../src/modules/ai_agent/ai_agent.tools';
import { GrowthService } from '../../src/modules/growth/growth.service';
import { learningContext } from '../../src/modules/learning/learning.service';
import { resetRateLimits } from '../../src/modules/ai_agent/rate_limiter';
import { storeOrderTelemetry } from '../../src/modules/shopify_data/order-analytics';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
const SHOP = 'london-eco.myshopify.com';
const WEBHOOK_SECRET = 'shpss_store_a_custom_app_secret_123';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function shopifyOrder(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `#${id}`,
    order_number: id,
    created_at: daysAgo(2),
    updated_at: daysAgo(1),
    financial_status: 'paid',
    fulfillment_status: null,
    currency: 'INR',
    total_price: '1000.00',
    subtotal_price: '1000.00',
    total_discounts: '0.00',
    total_tax: '0.00',
    line_items: [{ product_id: 11, variant_id: 111, title: 'Dog Food', quantity: 1, price: '1000.00' }],
    discount_codes: [],
    payment_gateway_names: ['razorpay'],
    customer: { id: 900 + id, email: `buyer${id}@example.com` },
    email: `buyer${id}@example.com`,
    shipping_address: { city: 'Pune', country: 'India', phone: '+91 98765 4321' + (id % 10) },
    ...extra,
  };
}

type Handler = (url: URL, init: any) => { status: number; body: unknown; headers?: Record<string, string> } | null;

/** Stands in for Shopify (and anything else): the first handler that answers wins. */
function stubShopify(handlers: Handler[]) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fetchStub = vi.fn(async (input: string, init: any = {}) => {
    const url = new URL(input);
    calls.push({ url: input, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json', ...(r.headers || {}) } });
    }
    return new Response(JSON.stringify({ errors: 'not stubbed' }), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchStub);
  return { calls };
}

const scopesHandler = (handles: string[]): Handler => (url) =>
  url.pathname === '/admin/oauth/access_scopes.json' ? { status: 200, body: { access_scopes: handles.map((handle) => ({ handle })) } } : null;
const shopHandler: Handler = (url) =>
  url.pathname.endsWith('/shop.json') ? { status: 200, body: { shop: { name: 'London Eco', myshopify_domain: SHOP } } } : null;

describe('Shopify data, order tracking in chat, learning and store-wide AI', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let merchantToken: string;

  const login = async (email: string) =>
    (await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' })).body.token;
  const dash = (method: 'get' | 'put' | 'post', path: string, storeId = STORE_A_ID) =>
    (request(app) as any)[method](`/api/v1/dashboard/${storeId}${path}`).set('Authorization', `Bearer ${merchantToken}`);

  async function newSession(anon = `v_${Math.random().toString(36).slice(2)}`) {
    const res = await request(app).post('/api/v1/widget/session').set('x-widget-key', STORE_A_WIDGET_KEY).send({ anonymous_id: anon });
    return res.body.data as { session_id: string; visitor_id: string };
  }
  const chat = (sessionId: string, message: string) =>
    request(app).post('/api/v1/widget/chat/message').set('x-widget-key', STORE_A_WIDGET_KEY).send({ session_id: sessionId, message });

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    merchantToken = await login('merchantA@store.com');
    resetRateLimits();
    await db.query('UPDATE store_credentials SET encrypted_admin_token = $2 WHERE store_id = $1', [STORE_A_ID, encryptString('shpat_store_a_token').encryptedString]);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.close();
  });

  describe('orders sync', () => {
    /** Live pass = order=updated_at asc; history pass = order=created_at desc (newest first, paged) */
    const syncHandlers = (history: Record<string, { orders: any[]; next?: string }>, live: any[] = []): Handler[] => [
      (url) => (url.pathname.endsWith('/shop.json') ? { status: 200, body: { shop: { iana_timezone: 'America/New_York' } } } : null),
      (url) => {
        if (!url.pathname.endsWith('/orders.json')) return null;
        const pageInfo = url.searchParams.get('page_info');
        if (!pageInfo && url.searchParams.get('order') === 'updated_at asc') return { status: 200, body: { orders: live } };
        const key = pageInfo || 'first';
        if (!pageInfo) expect(url.searchParams.get('order')).toBe('created_at desc');
        const page = history[key] || { orders: [] };
        return {
          status: 200,
          body: { orders: page.orders },
          headers: page.next ? { Link: `<https://${SHOP}/admin/api/2025-10/orders.json?limit=250&page_info=${page.next}>; rel="next"` } : {},
        };
      },
    ];
    const syncState = async () => {
      const row = (await db.query(`SELECT * FROM shopify_sync_state WHERE store_id = $1 AND resource = 'orders'`, [STORE_A_ID])).rows[0];
      return { ...row, details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details };
    };

    it('brings in today first, then the whole history newest first, and records the shop timezone', async () => {
      stubShopify(syncHandlers(
        { first: { orders: [shopifyOrder(1002, { created_at: daysAgo(1) }), shopifyOrder(1001, { created_at: daysAgo(2) })], next: 'p2' }, p2: { orders: [shopifyOrder(1000, { created_at: daysAgo(40) })] } },
        [shopifyOrder(1003, { created_at: new Date().toISOString(), updated_at: new Date().toISOString() })],
      ));
      const result = await syncStoreOrders(STORE_A_ID, { db });
      expect(result).toMatchObject({ status: 'ok', synced: 4, complete: true });

      const rows = (await db.query('SELECT shopify_order_id FROM shopify_orders WHERE store_id = $1 ORDER BY shopify_order_id', [STORE_A_ID])).rows;
      expect(rows.map((r: any) => r.shopify_order_id)).toEqual(['1000', '1001', '1002', '1003']);
      const state = await syncState();
      expect(state.status).toBe('ok');
      expect(state.backfill_done).toBe(true);
      expect(state.details.history_before).toBe('done');
      expect(state.details.live_cursor).toBeTruthy();
      expect(state.details.shop_timezone).toBe('America/New_York');
      expect(Number(state.records_synced)).toBe(4);
      expect((await db.query('SELECT timezone FROM stores WHERE id = $1', [STORE_A_ID])).rows[0].timezone).toBe('America/New_York');

      // Running again only updates (no duplicates)
      await syncStoreOrders(STORE_A_ID, { db });
      expect(Number((await db.query('SELECT COUNT(*) AS n FROM shopify_orders WHERE store_id = $1', [STORE_A_ID])).rows[0].n)).toBe(4);
      // Store B is untouched
      expect(Number((await db.query('SELECT COUNT(*) AS n FROM shopify_orders WHERE store_id = $1', [STORE_B_ID])).rows[0].n)).toBe(0);
    });

    it('a live-only run (every minute) brings new orders and leaves the history where it was', async () => {
      stubShopify(syncHandlers({ first: { orders: [shopifyOrder(1202, { created_at: daysAgo(1) })], next: 'x2' } }));
      await syncStoreOrders(STORE_A_ID, { db, maxPages: 1 });
      const before = (await syncState()).details.history_before;

      vi.unstubAllGlobals();
      const { calls } = stubShopify(syncHandlers({}, [shopifyOrder(1203, { created_at: new Date().toISOString(), updated_at: new Date().toISOString() })]));
      const quick = await syncStoreOrders(STORE_A_ID, { db, skipHistory: true });
      expect(quick).toMatchObject({ status: 'ok', synced: 1, complete: false });
      expect(calls.some((c) => c.url.includes('created_at+desc'))).toBe(false);
      expect((await syncState()).details.history_before).toBe(before);
      expect((await db.query(`SELECT 1 FROM shopify_orders WHERE store_id = $1 AND shopify_order_id = '1203'`, [STORE_A_ID])).rows).toHaveLength(1);
    });

    it('a long history continues from where the last run stopped', async () => {
      stubShopify(syncHandlers({
        first: { orders: [shopifyOrder(1102, { created_at: daysAgo(1) })], next: 'h2' },
        h2: { orders: [shopifyOrder(1101, { created_at: daysAgo(10) })], next: 'h3' },
        h3: { orders: [shopifyOrder(1100, { created_at: daysAgo(20) })] },
      }));
      const first = await syncStoreOrders(STORE_A_ID, { db, maxPages: 1 });
      expect(first.complete).toBe(false);
      const mid = await syncState();
      expect(mid.backfill_done).toBe(false);
      // Resume point = the oldest order imported so far
      expect(new Date(mid.details.history_before).getTime()).toBeLessThan(Date.now() - 0.5 * 24 * 3600 * 1000);

      vi.unstubAllGlobals();
      const { calls: seen } = stubShopify(syncHandlers({ first: { orders: [shopifyOrder(1101, { created_at: daysAgo(10) }), shopifyOrder(1100, { created_at: daysAgo(20) })] } }));
      const second = await syncStoreOrders(STORE_A_ID, { db });
      expect(second.complete).toBe(true);
      const historyCall = seen.find((c) => c.url.includes('created_at+desc') || c.url.includes('created_at%20desc'));
      expect(historyCall && new URL(historyCall.url).searchParams.get('created_at_max')).toBe(mid.details.history_before);
      expect(Number((await db.query('SELECT COUNT(*) AS n FROM shopify_orders WHERE store_id = $1', [STORE_A_ID])).rows[0].n)).toBe(3);
    });

    it('a 403 marks orders as blocked by read_orders, and Settings says so', async () => {
      stubShopify([
        (url) => (url.pathname.endsWith('/orders.json') ? { status: 403, body: { errors: 'forbidden' } } : null),
        scopesHandler(['read_products', 'read_customers', 'read_inventory']),
        shopHandler,
      ]);
      const result = await syncStoreOrders(STORE_A_ID, { db });
      expect(result).toMatchObject({ status: 'blocked', blocked_scope: 'read_orders' });

      const status = await dash('get', '/shopify-data/status?refresh=1');
      expect(status.status).toBe(200);
      const feeds = Object.fromEntries(status.body.data.feeds.map((f: any) => [f.key, f]));
      expect(feeds.orders.status).toBe('blocked');
      expect(feeds.orders.missing_required).toContain('read_orders');
      expect(feeds.products.status).toBe('working');
      const ordersScope = status.body.data.scopes.find((s: any) => s.scope === 'read_orders');
      expect(ordersScope.status).toBe('missing');
      expect(status.body.data.fix_steps.join(' ')).toMatch(/read_orders/);
      // Never leaks a secret
      expect(JSON.stringify(status.body)).not.toMatch(/shpat_/);
    });
  });

  describe('Settings → Shopify connection', () => {
    it('saves the webhook secret and storefront token write-only', async () => {
      const bad = await dash('put', '/shopify-data/webhook-secret').send({ secret: 'short' });
      expect(bad.status).toBe(400);
      const ok = await dash('put', '/shopify-data/webhook-secret').send({ secret: WEBHOOK_SECRET });
      expect(ok.status).toBe(200);
      const sf = await dash('put', '/shopify-data/storefront-token').send({ token: 'storefront_token_abcdefghijkl' });
      expect(sf.status).toBe(200);

      stubShopify([scopesHandler(['read_orders', 'read_products']), shopHandler]);
      const status = await dash('get', '/shopify-data/status');
      expect(status.body.data.connection.webhook_secret_saved).toBe(true);
      expect(status.body.data.connection.storefront_token_saved).toBe(true);
      expect(JSON.stringify(status.body)).not.toContain(WEBHOOK_SECRET);
    });

    it('merchants cannot read another store\'s data status', async () => {
      const res = await dash('get', '/shopify-data/status', STORE_B_ID);
      expect(res.status).toBe(403);
    });

    it('gives the checkout pixel code with the store\'s public widget key', async () => {
      const res = await dash('get', '/shopify-data/pixel-snippet');
      expect(res.status).toBe(200);
      expect(res.body.data.snippet).toContain(STORE_A_WIDGET_KEY);
      expect(res.body.data.snippet).toContain('analytics.subscribe');
      expect(res.body.data.snippet).not.toMatch(/shpat_|secret/i);
    });

    it('registers missing webhooks once and reports each topic', async () => {
      const { calls } = stubShopify([
        (url, init) => (url.pathname.endsWith('/webhooks.json') && (init.method || 'GET') === 'GET'
          ? { status: 200, body: { webhooks: [{ topic: 'orders/create', address: 'https://app.example.com/api/v1/shopify/webhooks/orders' }] } }
          : null),
        (url, init) => (url.pathname.endsWith('/webhooks.json') && init.method === 'POST' ? { status: 201, body: { webhook: { id: 1 } } } : null),
      ]);
      const result = await ensureWebhooks(STORE_A_ID, { db, baseUrl: 'https://app.example.com' });
      expect(result.status).toBe('ok');
      expect(result.topics['orders/create']).toBe('ok');
      expect(result.topics['orders/updated']).toBe('created');
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body.webhook.topic)).toEqual(['orders/updated', 'products/update']);
    });
  });

  describe('webhooks signed with the store\'s own secret', () => {
    const send = (path: string, payload: unknown, secret: string) => {
      const raw = JSON.stringify(payload);
      const hmac = crypto.createHmac('sha256', secret).update(raw).digest('base64');
      return request(app)
        .post(`/api/v1/shopify/webhooks/${path}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', hmac)
        .set('X-Shopify-Shop-Domain', SHOP)
        .set('X-Shopify-Topic', 'orders/updated')
        .send(raw);
    };

    it('accepts the store secret, mirrors the order, rejects a wrong signature', async () => {
      await dash('put', '/shopify-data/webhook-secret').send({ secret: WEBHOOK_SECRET });
      const ok = await send('orders-updated', shopifyOrder(2001, { fulfillment_status: 'fulfilled' }), WEBHOOK_SECRET);
      expect(ok.status).toBe(200);
      const row = (await db.query(`SELECT * FROM shopify_orders WHERE store_id = $1 AND shopify_order_id = '2001'`, [STORE_A_ID])).rows[0];
      expect(row.fulfillment_status).toBe('fulfilled');

      const bad = await send('orders-updated', shopifyOrder(2002), 'wrong-secret-value');
      expect(bad.status).toBe(401);
      const state = (await db.query(`SELECT details FROM shopify_sync_state WHERE store_id = $1 AND resource = 'webhooks'`, [STORE_A_ID])).rows[0];
      const details = typeof state.details === 'string' ? JSON.parse(state.details) : state.details;
      expect(details.last_received_at).toBeTruthy();
      expect(details.last_rejected_at).toBeTruthy();
    });
  });

  describe('dashboard numbers from real Shopify orders', () => {
    beforeEach(async () => {
      stubShopify([
        (url) => (url.pathname.endsWith('/orders.json')
          ? { status: 200, body: { orders: [
              shopifyOrder(3001, { created_at: new Date().toISOString(), total_price: '1500.00' }),
              shopifyOrder(3002, { created_at: new Date().toISOString(), total_price: '500.00', refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '100.00' }] }] }),
              shopifyOrder(3003, { created_at: new Date().toISOString(), cancelled_at: new Date().toISOString() }),
            ] } }
          : null),
      ]);
      await syncStoreOrders(STORE_A_ID, { db });
    });

    it('Home uses Shopify orders (refunds out, cancelled excluded)', async () => {
      const res = await dash('get', '/home?range=today&tz=0');
      expect(res.status).toBe(200);
      expect(res.body.data.revenue_source).toBe('shopify');
      expect(res.body.data.kpis.orders.value).toBe(2);
      expect(res.body.data.kpis.revenue.value).toBe(1900);
    });

    it('Home says "syncing", hides comparisons against a half-imported period, and conversion needs the pixel', async () => {
      const done = await dash('get', '/home?range=30d&tz=0');
      expect(done.body.data.sync).toMatchObject({ importing: false, orders_synced: 3 });
      expect(done.body.data.previous_incomplete).toBe(false);
      expect(done.body.data.conversion_tracking).toBe(false);

      // Pretend the history import only reached 10 days ago
      const row = (await db.query(`SELECT details FROM shopify_sync_state WHERE store_id = $1 AND resource = 'orders'`, [STORE_A_ID])).rows[0];
      const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      details.history_before = daysAgo(10);
      await db.query(`UPDATE shopify_sync_state SET details = $2::jsonb, backfill_done = false WHERE store_id = $1 AND resource = 'orders'`, [STORE_A_ID, JSON.stringify(details)]);

      const importing = await dash('get', '/home?range=30d&tz=0');
      expect(importing.body.data.sync.importing).toBe(true);
      expect(importing.body.data.sync.complete_back_to).toBeTruthy();
      expect(importing.body.data.previous_incomplete).toBe(true);
      expect(importing.body.data.kpis.revenue.change_pct).toBeNull();
      expect(importing.body.data.kpis.orders.change_pct).toBeNull();
      expect(importing.body.data.import_note).toMatch(/still importing/);
      // Today is fully imported, so today keeps its comparison
      const today = await dash('get', '/home?range=today&tz=0');
      expect(today.body.data.previous_incomplete).toBe(false);
    });

    it('Growth Copilot totals are exact from the database, not a capped list', async () => {
      const t = await storeOrderTelemetry(db, STORE_A_ID);
      expect(t!.totals).toMatchObject({ orders: 2, revenue: 1900, cancelled: 1, refunded: 100 });
      expect(t!.complete_30d).toBe(true);
    });

    it('Live Pulse shows today\'s Shopify orders', async () => {
      const res = await dash('get', '/analytics/live?tz=0');
      expect(res.body.data.store_today).toMatchObject({ orders: 2, revenue: 1900 });
      const funnel = await dash('get', '/analytics/funnel?days=7');
      expect(funnel.body.data.store_orders).toMatchObject({ orders: 2 });
      expect(funnel.body.data.checkout_tracking).toBe(false);
    });

    it('Ask AI "today" counts every order of the store day (not only paid, no 250 cap)', async () => {
      const today = await executeAgentTool(STORE_A_ID, 'get_today_overview', {});
      expect(today.ok).toBe(true);
      expect((today.data as any).shopify).toMatchObject({ orders_today: 2, revenue_today: 1900, cancelled_today: 1, source: 'synced' });
      const summary = await executeAgentTool(STORE_A_ID, 'get_shopify_summary', {});
      expect((summary.data as any)).toMatchObject({ orders: 2, revenue: 1900 });
    });

    it('Ask AI store tools answer from the synced orders', async () => {
      const trend = await executeAgentTool(STORE_A_ID, 'get_sales_trend', { days: 7 });
      expect(trend.ok).toBe(true);
      expect((trend.data as any).totals).toMatchObject({ orders: 2, revenue: 1900 });
      const payments = await executeAgentTool(STORE_A_ID, 'get_payments_summary', { days: 7 });
      expect((payments.data as any).by_gateway.razorpay.orders).toBe(3);
      const details = await executeAgentTool(STORE_A_ID, 'get_order_details', { order_number: '#3001' });
      expect((details.data as any).order).toBe('#3001');
      expect(JSON.stringify(details)).not.toMatch(/buyer3001@example\.com/);
      // Another store has nothing synced: an honest note, no numbers
      const other = await executeAgentTool(STORE_B_ID, 'get_sales_trend', {});
      expect(other.ok).toBe(false);
    });

    it('Growth Copilot overview uses the last 30 days of Shopify sales', async () => {
      const overview = await new GrowthService({ db }).getOverview(STORE_A_ID);
      expect(overview.revenue_source).toBe('shopify_30d');
      expect(overview.total_orders).toBe(2);
      const brief = await dash('get', '/growth/goal-brief');
      expect(brief.status).toBe(200);
      expect(brief.body.data.goal).toBe('increase_revenue');
      expect(brief.body.data.priorities.length).toBeGreaterThan(0);
    });
  });

  describe('order tracking in the storefront chat', () => {
    const lookupHandlers = (order: any): Handler[] => [
      (url) => (url.pathname.endsWith('/orders.json') && url.searchParams.get('name')
        ? { status: 200, body: { orders: url.searchParams.get('name') === order.name ? [order] : [] } }
        : null),
      (url) => (url.pathname.endsWith(`/orders/${order.id}.json`) ? { status: 200, body: { order } } : null),
    ];

    it('asks for details, verifies email, shows the order card and keeps the order for follow-ups', async () => {
      const order = shopifyOrder(4001, {
        fulfillment_status: 'fulfilled',
        order_status_url: 'https://london-eco.example/orders/abc',
        fulfillments: [{ status: 'success', shipment_status: 'in_transit', tracking_company: 'Delhivery', tracking_numbers: ['DL999'], tracking_urls: ['https://track.example/DL999'] }],
      });
      stubShopify(lookupHandlers(order));
      const s = await newSession();

      const ask = await chat(s.session_id, 'Where is my order?');
      expect(ask.status).toBe(200);
      expect(ask.body.data.message).toMatch(/order number/i);
      expect(ask.body.data.order).toBeNull();

      const found = await chat(s.session_id, '#4001 buyer4001@example.com');
      expect(found.body.data.order).toMatchObject({ name: '#4001', status: 'shipped' });
      expect(found.body.data.order.tracking[0]).toMatchObject({ number: 'DL999' });
      expect(JSON.stringify(found.body.data)).not.toMatch(/buyer4001@example\.com|98765/);

      const lookups = (await db.query('SELECT status, snapshot FROM chat_order_lookups WHERE session_id = $1', [s.session_id])).rows;
      expect(lookups[0].status).toBe('verified');
      expect(JSON.stringify(lookups[0].snapshot)).not.toMatch(/buyer4001@/);
    });

    it('Hinglish question gets a Hinglish reply', async () => {
      stubShopify([]);
      const s = await newSession();
      const res = await chat(s.session_id, 'mera order kab aayega?');
      expect(res.body.data.message).toMatch(/Kripya|bhejiye/);
    });

    it('never reveals an order to the wrong email and locks after repeated failures', async () => {
      stubShopify(lookupHandlers(shopifyOrder(5001)));
      const s = await newSession();
      const wrong = await chat(s.session_id, 'Track order #5001, my email is thief@example.com');
      expect(wrong.body.data.order).toBeNull();
      expect(wrong.body.data.message).toMatch(/does not match/i);
      for (let i = 0; i < 4; i++) await chat(s.session_id, `order #50${10 + i} thief@example.com`);
      const locked = await chat(s.session_id, 'order #5001 buyer5001@example.com');
      expect(locked.body.data.order).toBeNull();
      expect(locked.body.data.message).toMatch(/security/i);
    });

    it('an unrelated question while we wait for details goes to the assistant as usual', async () => {
      stubShopify([]);
      const s = await newSession();
      await chat(s.session_id, 'where is my order');
      const res = await chat(s.session_id, 'Do you have organic cotton shirts?');
      expect(res.status).toBe(200);
      expect(res.body.data.message).not.toMatch(/order number/i);
    });
  });

  describe('checkout pixel', () => {
    it('records product views and purchases once, joined to the widget visitor', async () => {
      const s = await newSession('pixel_visitor');
      const send = (event: string, data: unknown) => request(app).post('/api/v1/pixel/events').send({ widget_key: STORE_A_WIDGET_KEY, event, visitor_id: s.visitor_id, client_id: 'cl_1', data });
      expect((await send('product_viewed', { productVariant: { id: 'gid://shopify/ProductVariant/111', title: '2kg', product: { id: 'gid://shopify/Product/11', title: 'Dog Food' }, price: { amount: '500.0', currencyCode: 'INR' } } })).status).toBe(202);
      const purchase = { checkout: { order: { id: 'gid://shopify/Order/777' }, totalPrice: { amount: '999.00', currencyCode: 'INR' }, lineItems: [] } };
      expect((await send('checkout_completed', purchase)).body.recorded).toBe(true);
      expect((await send('checkout_completed', purchase)).body.duplicate).toBe(true);

      const events = (await db.query(`SELECT type FROM events WHERE store_id = $1 AND visitor_id = $2 ORDER BY created_at`, [STORE_A_ID, s.visitor_id])).rows.map((r: any) => r.type);
      expect(events.filter((t: string) => t === 'purchase_completed')).toHaveLength(1);
      expect(events).toContain('product_view');

      const unknown = await request(app).post('/api/v1/pixel/events').send({ widget_key: '99999999-9999-4999-8999-999999999999', event: 'product_viewed', client_id: 'x' });
      expect(unknown.status).toBe(401);
      const malformed = await request(app).post('/api/v1/pixel/events').send({ widget_key: 'not-a-real-key-123', event: 'product_viewed', client_id: 'x' });
      expect(malformed.status).toBe(400);
      const wrongType = await request(app).post('/api/v1/pixel/events').send({ widget_key: STORE_A_WIDGET_KEY, event: 'delete_everything', client_id: 'x' });
      expect(wrongType.status).toBe(400);
    });
  });

  describe('learning loop', () => {
    it('a 👎 becomes a question to teach; the approved answer reaches the assistant', async () => {
      const s = await newSession();
      const fb = await request(app).post('/api/v1/widget/chat/feedback').set('x-widget-key', STORE_A_WIDGET_KEY)
        .send({ session_id: s.session_id, rating: -1, question: 'Do you ship to Dubai? my email is a@b.com', answer: 'I am not sure.' });
      expect(fb.status).toBe(201);

      const open = await dash('get', '/learning?status=open');
      expect(open.body.data.items).toHaveLength(1);
      const item = open.body.data.items[0];
      expect(item.question).toMatch(/\[email\]/);
      expect(open.body.data.feedback.shopper.down).toBe(1);

      expect((await learningContext(db, STORE_A_ID, 'shopper', 'ship to Dubai?'))).toBe('');
      const approve = await dash('post', `/learning/${item.id}/approve`).send({ answer: 'Yes, we ship to the UAE in 5-7 working days.' });
      expect(approve.status).toBe(200);
      expect(await learningContext(db, STORE_A_ID, 'shopper', 'ship to Dubai?')).toMatch(/UAE in 5-7 working days/);

      // Store B never sees Store A's answers
      expect(await learningContext(db, STORE_B_ID, 'shopper', 'ship to Dubai?')).toBe('');
    });

    it('merchant notes teach Ask AI; 👍/👎 on Ask AI answers are counted', async () => {
      const note = await dash('post', '/learning/notes').send({ surface: 'merchant', question: 'COD orders', answer: 'COD orders are confirmed by phone before shipping.' });
      expect(note.status).toBe(201);
      expect(await learningContext(db, STORE_A_ID, 'merchant', 'how are COD orders doing')).toMatch(/confirmed by phone/);
      const rate = await dash('post', '/learning/feedback').send({ rating: 1, question: 'sales today?', answer: '₹1,900' });
      expect(rate.status).toBe(201);
      const list = await dash('get', '/learning');
      expect(list.body.data.feedback.merchant.up).toBe(1);
    });
  });
});
