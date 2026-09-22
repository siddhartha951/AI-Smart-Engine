/**
 * Shopify token management — Reconnect + Disconnect integration tests.
 *
 * Covers: reconnect validates the new token BEFORE saving (invalid token never
 * replaces the old one), timeout/unreachable handling, auto health check after
 * reconnect, disconnect clears credentials + health cache but keeps store data,
 * tenant isolation (403 cross-store), input validation, and that the raw token
 * never leaks into any response.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { encryptString, decryptString } from '../../src/utils/crypto';
import { ShopifyHealthService } from '../../src/modules/shopify_health/shopify_health.service';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DOMAIN_A = 'london-eco.myshopify.com';
const OLD_TOKEN = 'shpat_old_working_token_aaa';
const NEW_TOKEN = 'shpat_new_regenerated_token_bbb';
const BAD_TOKEN = 'shpat_invalid_token_ccc';
const STOREFRONT_TOKEN = 'storefront_token_keep_me';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

type Scenario = 'new-ok' | 'bad-token' | 'unreachable';

function shopifyFetchStub(scenario: Scenario) {
  return vi.fn(async (url: string, init?: any) => {
    const u = new URL(String(url));
    const path = u.pathname;
    const tokenHeader = init?.headers?.['X-Shopify-Access-Token'] || '';

    // The token must travel in the header, never in the URL.
    expect(String(url)).not.toContain(NEW_TOKEN);
    expect(String(url)).not.toContain(BAD_TOKEN);
    expect(String(url)).not.toContain(OLD_TOKEN);

    if (scenario === 'unreachable' && path.endsWith('/shop.json')) {
      throw new Error('network down');
    }
    if (path.endsWith('/shop.json')) {
      if (scenario === 'bad-token' || tokenHeader === BAD_TOKEN) {
        return jsonResponse({ errors: 'Invalid API key or access token' }, 401);
      }
      return jsonResponse({
        shop: { name: 'London Eco', myshopify_domain: DOMAIN_A },
      });
    }
    if (path.endsWith('/orders.json')) return jsonResponse({ orders: [] });
    if (path.endsWith('/products.json')) return jsonResponse({ products: [] });
    if (path.endsWith('/customers.json')) return jsonResponse({ customers: [] });
    return jsonResponse({ errors: 'not stubbed' }, 500);
  });
}

describe('Shopify token management (reconnect + disconnect)', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let tokenA: string;
  let tokenB: string;

  async function seedShopifyCreds(storeId: string, adminToken: string = OLD_TOKEN) {
    const encAdmin = encryptString(adminToken);
    const encStorefront = encryptString(STOREFRONT_TOKEN);
    await db.query(
      `INSERT INTO store_credentials (store_id, encrypted_admin_token, encrypted_storefront_token, encryption_iv)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (store_id) DO UPDATE SET
         encrypted_admin_token = EXCLUDED.encrypted_admin_token,
         encrypted_storefront_token = EXCLUDED.encrypted_storefront_token,
         encryption_iv = EXCLUDED.encryption_iv,
         updated_at = NOW()`,
      [storeId, encAdmin.encryptedString, encStorefront.encryptedString, encAdmin.iv]
    );
  }

  async function readAdminToken(storeId: string): Promise<string | null> {
    const res = await db.query(
      'SELECT encrypted_admin_token, encryption_iv FROM store_credentials WHERE store_id = $1',
      [storeId]
    );
    if (res.rows.length === 0) return null;
    return decryptString(res.rows[0].encrypted_admin_token, res.rows[0].encryption_iv);
  }

  async function readStorefrontToken(storeId: string): Promise<string | null> {
    const res = await db.query(
      'SELECT encrypted_storefront_token, encryption_iv FROM store_credentials WHERE store_id = $1',
      [storeId]
    );
    if (res.rows.length === 0) return null;
    return decryptString(res.rows[0].encrypted_storefront_token, res.rows[0].encryption_iv);
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

  it('1. reconnect with a valid token replaces it and auto-runs the health check', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('new-ok'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/reconnect`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ admin_token: NEW_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reconnected).toBe(true);
    expect(res.body.data.health.overall_status).toBe('healthy');
    expect(res.body.data.health.shop_name).toBe('London Eco');

    // The raw token must never appear in the response.
    expect(JSON.stringify(res.body)).not.toContain(NEW_TOKEN);

    // The new token is stored (encrypted), the old one is gone.
    expect(await readAdminToken(STORE_A_ID)).toBe(NEW_TOKEN);

    // The storefront token is preserved, not wiped.
    expect(await readStorefrontToken(STORE_A_ID)).toBe(STOREFRONT_TOKEN);

    // Health check was cached for the new token.
    const health = await new ShopifyHealthService().getLastHealth(STORE_A_ID);
    expect(health?.overall_status).toBe('healthy');

    // GET /shopify still reports credentials configured.
    const info = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/shopify`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(info.body.data.credentials_configured).toBe(true);
  });

  it('2. reconnect with an invalid token (401) is rejected and the old token is kept', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('bad-token'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/reconnect`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ admin_token: BAD_TOKEN });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SHOPIFY_TOKEN_INVALID');
    // Merchant-safe guidance, no raw Shopify error, no token leak.
    expect(res.body.error.message).not.toContain(BAD_TOKEN);
    expect(JSON.stringify(res.body)).not.toContain(BAD_TOKEN);

    // Old token untouched.
    expect(await readAdminToken(STORE_A_ID)).toBe(OLD_TOKEN);
  });

  it('3. reconnect when Shopify is unreachable (timeout) keeps the old token', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('unreachable'));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/reconnect`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ admin_token: NEW_TOKEN });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SHOPIFY_UNREACHABLE');
    expect(JSON.stringify(res.body)).not.toContain(NEW_TOKEN);
    expect(await readAdminToken(STORE_A_ID)).toBe(OLD_TOKEN);
  });

  it('4. reconnect validates input (missing / too-short token -> 400)', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('new-ok'));

    const missing = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/reconnect`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(missing.status).toBe(400);

    const short = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/reconnect`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ admin_token: 'abc' });
    expect(short.status).toBe(400);

    // Nothing changed.
    expect(await readAdminToken(STORE_A_ID)).toBe(OLD_TOKEN);
  });

  it('5. disconnect removes credentials + health cache but keeps store data', async () => {
    await seedShopifyCreds(STORE_A_ID);
    await seedShopifyCreds(STORE_B_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('new-ok'));

    // Seed a health check for store A first.
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/health/check`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(await new ShopifyHealthService().getLastHealth(STORE_A_ID)).not.toBeNull();

    const res = await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/shopify/connection`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.disconnected).toBe(true);

    // Store A's credentials are gone…
    expect(await readAdminToken(STORE_A_ID)).toBeNull();
    // …and its cached health check is cleared.
    expect(await new ShopifyHealthService().getLastHealth(STORE_A_ID)).toBeNull();
    const cached = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/shopify/health`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(cached.body.data).toEqual({ checked: false });

    // …but the store itself and its other data survive.
    const storeRes = await db.query('SELECT id, shop_domain FROM stores WHERE id = $1', [STORE_A_ID]);
    expect(storeRes.rows).toHaveLength(1);
    expect(storeRes.rows[0].shop_domain).toBeTruthy();

    // …and store B (another tenant) is completely untouched.
    expect(await readAdminToken(STORE_B_ID)).toBe(OLD_TOKEN);

    // GET /shopify now honestly reports no credentials.
    const info = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/shopify`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(info.body.data.credentials_configured).toBe(false);
  });

  it('6. tenant isolation: store B cannot reconnect or disconnect store A (403)', async () => {
    await seedShopifyCreds(STORE_A_ID);
    vi.stubGlobal('fetch', shopifyFetchStub('new-ok'));

    const reconnect = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/reconnect`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ admin_token: NEW_TOKEN });
    expect(reconnect.status).toBe(403);

    const disconnect = await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/shopify/connection`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(disconnect.status).toBe(403);

    // Store A's credentials untouched.
    expect(await readAdminToken(STORE_A_ID)).toBe(OLD_TOKEN);
  });

  it('7. probeTokenValidity classifies valid / invalid / unreachable without touching storage', async () => {
    const svc = new ShopifyHealthService();

    vi.stubGlobal('fetch', shopifyFetchStub('new-ok'));
    const ok = await svc.probeTokenValidity(DOMAIN_A, NEW_TOKEN);
    expect(ok.valid).toBe(true);
    expect(ok.reason).toBe('ok');
    expect(ok.shopName).toBe('London Eco');

    vi.stubGlobal('fetch', shopifyFetchStub('bad-token'));
    const bad = await svc.probeTokenValidity(DOMAIN_A, BAD_TOKEN);
    expect(bad.valid).toBe(false);
    expect(bad.reason).toBe('invalid');

    vi.stubGlobal('fetch', shopifyFetchStub('unreachable'));
    const down = await svc.probeTokenValidity(DOMAIN_A, NEW_TOKEN);
    expect(down.valid).toBe(false);
    expect(down.reason).toBe('unreachable');
  });
});
