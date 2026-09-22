/**
 * Shopify Connection Health Check — integration tests.
 *
 * Covers: scope detection via mocked 401/403/200 per endpoint, wrong-store
 * detection, feature_map (unlocks) correctness, auto-check on connect, the
 * AI-agent health summary helper, tenant isolation, and that the raw token
 * never leaks into any response.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { encryptString } from '../../src/utils/crypto';
import { ShopifyHealthService } from '../../src/modules/shopify_health/shopify_health.service';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DOMAIN_A = 'london-eco.myshopify.com';
const FAKE_TOKEN = 'shpat_test_token_abcdef123456';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

type Scenario = 'all-ok' | 'orders-missing' | 'token-invalid' | 'unreachable' | 'wrong-store' | 'connect-ok';

function shopifyFetchStub(scenario: Scenario) {
  const shopDomain = scenario === 'connect-ok' ? 'test-connect.myshopify.com' : DOMAIN_A;
  return vi.fn(async (url: string, init?: any) => {
    const u = new URL(String(url));
    const path = u.pathname;
    const tokenHeader = init?.headers?.['X-Shopify-Access-Token'] || '';

    // The token must travel in the header, never in the URL.
    expect(String(url)).not.toContain(FAKE_TOKEN);
    expect(tokenHeader).toBe(FAKE_TOKEN);

    if (scenario === 'unreachable' && path.endsWith('/shop.json')) {
      throw new Error('network down');
    }
    if (path.endsWith('/shop.json')) {
      if (scenario === 'token-invalid') {
        return jsonResponse({ errors: 'Invalid API key or access token' }, 401);
      }
      return jsonResponse(
        {
          shop: {
            name: scenario === 'connect-ok' ? 'Test Store' : 'London Eco',
            myshopify_domain: scenario === 'wrong-store' ? 'other-store.myshopify.com' : shopDomain,
          },
        },
        200,
        { 'x-shopify-shop-api-call-limit': '12/40' }
      );
    }
    if (path.endsWith('/orders.json')) {
      if (scenario === 'orders-missing') {
        return jsonResponse({ errors: 'Forbidden' }, 403);
      }
      return jsonResponse({ orders: [] }, 200);
    }
    if (path.endsWith('/products.json')) {
      return jsonResponse({ products: [] }, 200);
    }
    if (path.endsWith('/customers.json')) {
      return jsonResponse({ customers: [] }, 200);
    }
    return jsonResponse({ errors: 'not stubbed' }, 500);
  });
}

describe('Shopify Connection Health Check', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let tokenA: string;
  let tokenB: string;

  async function seedShopifyCreds(storeId: string, token: string = FAKE_TOKEN) {
    const enc = encryptString(token);
    await db.query(
      `INSERT INTO store_credentials (store_id, encrypted_admin_token, encrypted_storefront_token, encryption_iv)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (store_id) DO UPDATE SET
         encrypted_admin_token = EXCLUDED.encrypted_admin_token,
         encrypted_storefront_token = EXCLUDED.encrypted_storefront_token,
         encryption_iv = EXCLUDED.encryption_iv,
         updated_at = NOW()`,
      [storeId, enc.encryptedString, enc.encryptedString, enc.iv]
    );
  }

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    tokenB = resB.body.token;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await db.close();
  });

  it('1. GET /shopify/health before any check returns {checked:false} (no mock data)', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/shopify/health`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ checked: false });
  });

  it('2. POST /shopify/health/check with no credentials returns down/not_connected with fix steps', async () => {
    await db.query('DELETE FROM store_credentials WHERE store_id = $1', [STORE_A_ID]);
    vi.stubGlobal('fetch', shopifyFetchStub('all-ok'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.overall_status).toBe('down');
    expect(res.body.data.reason).toBe('not_connected');
    expect(res.body.data.token_valid).toBe(false);
    expect(res.body.data.fix_steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_TOKEN);

    const stored = await db.query('SELECT overall_status, reason FROM shopify_health_checks WHERE store_id = $1', [STORE_A_ID]);
    expect(stored.rows[0].overall_status).toBe('down');
  });

  it('3. all scopes ok -> healthy, store_match true, rate limit captured', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('all-ok'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.overall_status).toBe('healthy');
    expect(data.reason).toBe('ok');
    expect(data.token_valid).toBe(true);
    expect(data.store_match).toBe(true);
    expect(data.shop_name).toBe('London Eco');
    expect(data.rate_limit).toBe('12/40');
    expect(data.scopes).toHaveLength(3);
    for (const s of data.scopes) {
      expect(s.status).toBe('ok');
      expect(s.unlocks).toBeTruthy();
    }
    expect(data.fix_steps).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_TOKEN);

    // Cached GET serves the stored check without hitting Shopify again.
    const fetchMock = vi.mocked(global.fetch);
    const callsBefore = fetchMock.mock.calls.length;
    const cached = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/shopify/health`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(cached.body.data.overall_status).toBe('healthy');
    expect(cached.body.data.checked_at).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('4. orders.json 403 -> degraded with read_orders missing + unlocks feature map', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('orders-missing'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    const data = res.body.data;
    expect(data.overall_status).toBe('degraded');
    expect(data.reason).toBe('scopes_missing');
    expect(data.token_valid).toBe(true);

    const orders = data.scopes.find((s: any) => s.scope === 'read_orders');
    expect(orders.status).toBe('missing');
    expect(orders.tested_endpoint).toBe('orders.json');
    expect(orders.unlocks).toContain('AI Agent');
    expect(orders.detail).toContain('403');

    const products = data.scopes.find((s: any) => s.scope === 'read_products');
    expect(products.status).toBe('ok');

    expect(data.fix_steps.join(' ')).toContain('read_orders');
    expect(data.fix_steps.join(' ').toLowerCase()).toContain('regenerate');
  });

  it('5. shop.json 401 -> down/token_invalid, scopes unchecked', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('token-invalid'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    const data = res.body.data;
    expect(data.overall_status).toBe('down');
    expect(data.reason).toBe('token_invalid');
    expect(data.token_valid).toBe(false);
    expect(data.scopes.every((s: any) => s.status === 'unchecked')).toBe(true);
    expect(data.fix_steps.join(' ')).toContain('expired');
  });

  it('6. shop.json network failure -> down/unreachable', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('unreachable'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.body.data.overall_status).toBe('down');
    expect(res.body.data.reason).toBe('unreachable');
  });

  it('7. myshopify_domain mismatch -> degraded/wrong_store with store_match false', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('wrong-store'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    const data = res.body.data;
    expect(data.overall_status).toBe('degraded');
    expect(data.reason).toBe('wrong_store');
    expect(data.store_match).toBe(false);
    expect(data.fix_steps.join(' ')).toContain('other-store.myshopify.com');
  });

  it('8. tenant isolation: store B cannot check store A, and sees its own empty state', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('all-ok'));

    const forbidden = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({});
    expect(forbidden.status).toBe(403);

    const other = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/shopify/health`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(other.body.data).toEqual({ checked: false });
  });

  it('9. auto-check runs after a successful Shopify connect (onboarding step2)', async () => {
    const onboardingToken = 'c0ffee00-1234-4abc-8def-1234567890ab';
    const merchantId = '33333333-3333-3333-3333-333333333333';
    const newStoreId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    await db.query(
      `INSERT INTO merchants (id, name, contact_email, onboarding_token, onboarding_expires_at, status)
       VALUES ($1, 'Test Merchant', 'test@shop.com', $2, NOW() + INTERVAL '7 days', 'pending')`,
      [merchantId, onboardingToken]
    );
    await db.query(
      `INSERT INTO stores (id, merchant_id, shop_domain, brand_name, status)
       VALUES ($1, $2, $3, 'Test Store', 'active')`,
      [newStoreId, merchantId, 'test-connect.myshopify.com']
    );

    vi.stubGlobal('fetch', shopifyFetchStub('connect-ok'));

    const res = await request(app)
      .post('/api/v1/onboarding/step2-shopify')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({ store_id: newStoreId, admin_token: FAKE_TOKEN, storefront_token: 'storefront_test' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const stored = await db.query('SELECT overall_status, reason, shop_name FROM shopify_health_checks WHERE store_id = $1', [newStoreId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].overall_status).toBe('healthy');
    expect(stored.rows[0].shop_name).toBe('Test Store');
  });

  it('10. GET /shopify (connection info) now includes the cached health summary', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('orders-missing'));
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/shopify`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.credentials_configured).toBe(true);
    expect(res.body.data.health.overall_status).toBe('degraded');
    expect(res.body.data.health.checked_at).toBeTruthy();
  });

  it('11. getShopifyHealthSummary guides the AI agent (missing scope / healthy / not connected)', async () => {
    const svc = new ShopifyHealthService();

    // No check cached yet -> null (agent must not live-probe).
    await seedShopifyCreds(STORE_A_ID);
    expect(await svc.getShopifyHealthSummary(STORE_A_ID)).toBeNull();

    // Degraded check cached -> scope guidance with fix steps.
    vi.stubGlobal('fetch', shopifyFetchStub('orders-missing'));
    await svc.checkHealth(STORE_A_ID);
    const guidance = await svc.getShopifyHealthSummary(STORE_A_ID);
    expect(guidance).toContain('read_orders');
    expect(guidance!.toLowerCase()).toContain('regenerate');

    // Healthy check cached -> null again.
    vi.stubGlobal('fetch', shopifyFetchStub('all-ok'));
    await svc.checkHealth(STORE_A_ID);
    expect(await svc.getShopifyHealthSummary(STORE_A_ID)).toBeNull();

    // No credentials at all -> connect guidance.
    await db.query('DELETE FROM store_credentials WHERE store_id = $1', [STORE_B_ID]);
    const notConnected = await svc.getShopifyHealthSummary(STORE_B_ID);
    expect(notConnected).toContain('not connected');
    expect(notConnected).toContain('Connections');
  });

  it('12. corrupting the credential row degrades to not_connected instead of crashing', async () => {
    await db.query(
      `INSERT INTO store_credentials (store_id, encrypted_admin_token, encrypted_storefront_token, encryption_iv)
       VALUES ($1, 'garbage-not-encrypted', 'garbage', 'iv')
       ON CONFLICT (store_id) DO UPDATE SET encrypted_admin_token = 'garbage-not-encrypted', updated_at = NOW()`,
      [STORE_B_ID]
    );
    vi.stubGlobal('fetch', shopifyFetchStub('all-ok'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_B_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.overall_status).toBe('down');
    expect(res.body.data.reason).toBe('not_connected');
  });
});
