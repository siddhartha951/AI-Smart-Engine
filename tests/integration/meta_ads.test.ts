import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { decryptString } from '../../src/utils/crypto';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const VALID_TOKEN = 'EAAB_valid_meta_token_abc123';
const EXPIRED_TOKEN = 'EAAB_expired_meta_token_xyz';

function metaFetchStub() {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url));
    const token = u.searchParams.get('access_token') || '';

    if (token === EXPIRED_TOKEN) {
      return jsonResponse(
        { error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190 } },
        400
      );
    }

    if (u.pathname.endsWith('/me/adaccounts')) {
      return jsonResponse({
        data: [
          { id: 'act_111', name: 'Sid Store Ads', account_status: 1, currency: 'INR', timezone_name: 'Asia/Kolkata' },
        ],
      });
    }
    if (u.pathname.endsWith('/me')) {
      return jsonResponse({ id: 'user_1', name: 'Sid Merchant' });
    }
    if (u.pathname.includes('/act_111/insights')) {
      return jsonResponse({
        data: [
          {
            campaign_id: 'c1',
            campaign_name: 'Diwali Sale',
            spend: '250.00',
            impressions: '50000',
            clicks: '2500',
            ctr: '5.0',
            cpc: '0.10',
            actions: [{ action_type: 'purchase', value: '25' }],
            action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '12500' }],
          },
          {
            campaign_id: 'c2',
            campaign_name: 'Clearance',
            spend: '50.00',
            impressions: '10000',
            clicks: '200',
            ctr: '2.0',
            cpc: '0.25',
            actions: [],
            action_values: [],
          },
        ],
      });
    }
    return jsonResponse({ error: { message: 'Not stubbed', type: 'Exception', code: 1 } }, 500);
  });
}

describe('Meta Ads Integration (dashboard module)', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    vi.stubGlobal('fetch', metaFetchStub());

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

  it('1. connects with a valid token, encrypts it at rest, and never returns the raw token', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.adAccountId).toBe('111');
    expect(res.body.data.adAccountName).toBe('Sid Store Ads');
    expect(res.body.data.accountCurrency).toBe('INR');
    expect(JSON.stringify(res.body)).not.toContain(VALID_TOKEN);

    // Encrypted at rest (AES-256-GCM round-trip)
    const stored = await db.query('SELECT * FROM meta_ads_configs WHERE store_id = $1', [STORE_A_ID]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].encrypted_access_token).not.toContain(VALID_TOKEN);
    expect(decryptString(stored.rows[0].encrypted_access_token)).toBe(VALID_TOKEN);
  });

  it('2. GET /config returns public status metadata without the token', async () => {
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.status).toBe('connected');
    expect(res.body.data.tokenAgeDays).toBeGreaterThanOrEqual(0);
    expect(res.body.data.tokenExpiringSoon).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(VALID_TOKEN);
  });

  it('3. POST /test validates a token without saving anything', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/test`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.userName).toBe('Sid Merchant');
    expect(res.body.data.accounts).toHaveLength(1);

    const stored = await db.query('SELECT * FROM meta_ads_configs WHERE store_id = $1', [STORE_A_ID]);
    expect(stored.rows).toHaveLength(0);
  });

  it('4. rejects an expired token with a merchant-safe message and stores nothing usable', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: EXPIRED_TOKEN });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('expired');
    expect(JSON.stringify(res.body)).not.toContain(EXPIRED_TOKEN);
  });

  it('5. GET /insights returns campaign rows with spend/CTR/CPC/conversions/ROAS and store attribution', async () => {
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/insights?level=campaign&date_preset=last_30d`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(2);
    const diwali = res.body.data.rows.find((r: any) => r.campaignName === 'Diwali Sale');
    expect(diwali.spend).toBe(250);
    expect(diwali.impressions).toBe(50000);
    expect(diwali.clicks).toBe(2500);
    expect(diwali.ctr).toBe(5);
    expect(diwali.cpc).toBe(0.1);
    expect(diwali.conversions).toBe(25);
    expect(diwali.roas).toBe(50);
    expect(res.body.data.totals.spend).toBe(300);
    expect(res.body.data.accountCurrency).toBe('INR');
    expect(Array.isArray(res.body.data.attribution)).toBe(true);
    expect(typeof res.body.data.attributionNote).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain(VALID_TOKEN);
  });

  it('6. GET /accounts lists ad accounts for the connected store', async () => {
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/accounts`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].accountId).toBe('111');
  });

  it('7. enforces tenant isolation: store B cannot see store A connection', async () => {
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    const resB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.connected).toBe(false);

    const insightsB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/meta-ads/insights`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(insightsB.status).toBe(400);
  });

  it('8. expired token on refresh flags the connection as error with a clear message', async () => {
    // Connect with a valid token first
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    // Overwrite the stored token with an expired one (simulates Meta-side expiry)
    const { encryptString } = await import('../../src/utils/crypto');
    const bad = encryptString(EXPIRED_TOKEN);
    await db.query('UPDATE meta_ads_configs SET encrypted_access_token = $1 WHERE store_id = $2', [
      bad.encryptedString,
      STORE_A_ID,
    ]);

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/insights`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('expired');

    const status = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(status.body.data.status).toBe('error');
    expect(status.body.data.lastError).toContain('expired');
  });

  it('9. DELETE /config disconnects and removes credentials', async () => {
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    const del = await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(del.status).toBe(200);
    expect(del.body.data.disconnected).toBe(true);

    const stored = await db.query('SELECT * FROM meta_ads_configs WHERE store_id = $1', [STORE_A_ID]);
    expect(stored.rows).toHaveLength(0);

    const insights = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/insights`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(insights.status).toBe(400);
  });

  it('10. validates insights query params (bad date format -> 400)', async () => {
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ access_token: VALID_TOKEN });

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/insights?since=not-a-date&until=2026-09-21`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });
});
