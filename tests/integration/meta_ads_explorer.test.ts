import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const VALID_TOKEN = 'EAAB_valid_explorer_token_xyz';
const EXPIRED_TOKEN = 'EAAB_expired_explorer_token_xyz';

const AD_PAGE_1 = [
  {
    id: 'ad_1',
    name: 'Diwali Sale - Video 1',
    effective_status: 'ACTIVE',
    campaign: { name: 'Diwali Sale' },
    adset: { name: 'Broad - IN' },
    adcreatives: {
      data: [
        {
          thumbnail_url: 'https://cdn.example.com/thumb1.jpg',
          image_url: 'https://cdn.example.com/full1.jpg',
          object_story_spec: { link_data: { link: 'https://store.example.com/p/1' } },
        },
      ],
    },
  },
  {
    id: 'ad_2',
    name: 'Diwali Sale - Video 2 (no creative)',
    effective_status: 'PAUSED',
    campaign: { name: 'Diwali Sale' },
    adset: { name: 'Broad - IN' },
    adcreatives: { data: [] },
  },
];

const AD_PAGE_2 = [
  {
    id: 'ad_3',
    name: 'Clearance - Static (no URL)',
    effective_status: 'ACTIVE',
    campaign: { name: 'Clearance' },
    adset: { name: 'Retargeting' },
    adcreatives: {
      data: [{ thumbnail_url: 'https://cdn.example.com/thumb3.jpg', video_id: 'v3' }],
    },
  },
];

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
        data: [{ id: 'act_111', name: 'Sid Store Ads', account_status: 1, currency: 'INR', timezone_name: 'Asia/Kolkata' }],
      });
    }
    if (u.pathname.endsWith('/me')) {
      return jsonResponse({ id: 'user_1', name: 'Sid Merchant' });
    }
    if (u.pathname.includes('/act_111/ads')) {
      const after = u.searchParams.get('after');
      if (!after) {
        return jsonResponse({
          data: AD_PAGE_1,
          paging: { next: 'https://graph.facebook.com/v21.0/act_111/ads?after=PAGE2&access_token=' + token },
        });
      }
      return jsonResponse({ data: AD_PAGE_2, paging: {} });
    }
    return jsonResponse({ error: { message: 'Not stubbed', type: 'Exception', code: 1 } }, 500);
  });
}

describe('Meta Ads Explorer (cached creative explorer)', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let tokenA: string;
  let tokenB: string;

  async function connectStore(storeId: string, jwt: string, accessToken: string = VALID_TOKEN) {
    return request(app)
      .post(`/api/v1/dashboard/${storeId}/meta-ads/config`)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ access_token: accessToken });
  }

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

  it('1. GET /explorer/ads before any sync returns an empty, never-synced state (no mock data)', async () => {
    await connectStore(STORE_A_ID, tokenA);

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/ads`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ads).toEqual([]);
    expect(res.body.data.count).toBe(0);
    expect(res.body.data.synced).toBe(false);
    expect(res.body.data.lastSyncAt).toBeNull();
  });

  it('2. POST /explorer/sync paginates Meta, caches ads with creatives, and records lastSyncAt', async () => {
    await connectStore(STORE_A_ID, tokenA);

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.synced).toBe(true);
    expect(res.body.data.adsFetched).toBe(3);
    expect(res.body.data.adAccountId).toBe('111');
    expect(res.body.data.lastSyncAt).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(VALID_TOKEN);

    const stored = await db.query('SELECT * FROM meta_ads_explorer_cache WHERE store_id = $1 ORDER BY ad_id', [STORE_A_ID]);
    expect(stored.rows).toHaveLength(3);

    const ad1 = stored.rows.find((r: any) => r.ad_id === 'ad_1');
    expect(ad1.name).toBe('Diwali Sale - Video 1');
    expect(ad1.status).toBe('ACTIVE');
    expect(ad1.campaign_name).toBe('Diwali Sale');
    expect(ad1.adset_name).toBe('Broad - IN');
    expect(ad1.thumbnail_url).toBe('https://cdn.example.com/full1.jpg');
    expect(ad1.creative_url).toBe('https://cdn.example.com/full1.jpg');
    expect(ad1.destination_url).toBe('https://store.example.com/p/1');
    expect(ad1.last_synced_at).toBeTruthy();

    const ad2 = stored.rows.find((r: any) => r.ad_id === 'ad_2');
    expect(ad2.thumbnail_url).toBeNull();
    expect(ad2.destination_url).toBeNull();

    const ad3 = stored.rows.find((r: any) => r.ad_id === 'ad_3');
    expect(ad3.thumbnail_url).toBe('https://cdn.example.com/thumb3.jpg');
    expect(ad3.creative_url).toBeNull();
    expect(ad3.destination_url).toBeNull();
  });

  it('3. GET /explorer/ads serves the cache without calling Meta again', async () => {
    await connectStore(STORE_A_ID, tokenA);
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    const fetchMock = vi.mocked(global.fetch);
    const callsBefore = fetchMock.mock.calls.length;

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/ads`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(3);
    expect(res.body.data.synced).toBe(true);
    expect(res.body.data.lastSyncAt).toBeTruthy();
    const ad1 = res.body.data.ads.find((a: any) => a.ad_id === 'ad_1');
    expect(ad1).toMatchObject({ ad_id: 'ad_1', status: 'ACTIVE' });
    // Cache serve must not hit the Meta API.
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('4. re-sync removes stale ads that no longer exist in the account', async () => {
    await connectStore(STORE_A_ID, tokenA);
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    // Manually plant a stale row, then re-sync: it must disappear.
    await db.query(
      `INSERT INTO meta_ads_explorer_cache (store_id, ad_account_id, ad_id, name, status)
       VALUES ($1, '111', 'ad_stale', 'Old Ad', 'ARCHIVED')`,
      [STORE_A_ID]
    );

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(1);

    const stored = await db.query('SELECT ad_id FROM meta_ads_explorer_cache WHERE store_id = $1', [STORE_A_ID]);
    expect(stored.rows.map((r: any) => r.ad_id).sort()).toEqual(['ad_1', 'ad_2', 'ad_3']);
  });

  it('5. tenant isolation: store B cannot read or sync store A cache', async () => {
    await connectStore(STORE_A_ID, tokenA);
    await connectStore(STORE_B_ID, tokenB);
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    // Store B's cache is empty (never synced) even though store A synced.
    const resB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/meta-ads/explorer/ads`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.count).toBe(0);
    expect(resB.body.data.synced).toBe(false);

    // Cross-store access is blocked by enforceStoreAccess.
    const cross = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/ads`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(cross.status).toBe(403);
  });

  it('6. sync without a Meta connection returns a merchant-safe 400', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Connect your Meta access token first');
  });

  it('7. sync with an expired token flags the connection and returns a safe message', async () => {
    await connectStore(STORE_A_ID, tokenA, EXPIRED_TOKEN);

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toContain(EXPIRED_TOKEN);

    // The failed connect flags the stored connection row as errored (no token is ever stored).
    const flagged = await db.query('SELECT status, last_error, encrypted_access_token FROM meta_ads_configs WHERE store_id = $1', [STORE_A_ID]);
    expect(flagged.rows).toHaveLength(1);
    expect(flagged.rows[0].status).toBe('error');
    expect(flagged.rows[0].last_error).toMatch(/expired/i);
    expect(flagged.rows[0].encrypted_access_token).toBeNull();
  });

  it('8. sync accepts an explicit ad_account_id override', async () => {
    await connectStore(STORE_A_ID, tokenA);

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ad_account_id: 'act_111' });

    expect(res.status).toBe(200);
    expect(res.body.data.adAccountId).toBe('111');
  });

  it('9. disconnect clears the explorer cache', async () => {
    await connectStore(STORE_A_ID, tokenA);
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/sync`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/config`)
      .set('Authorization', `Bearer ${tokenA}`);

    const stored = await db.query('SELECT * FROM meta_ads_explorer_cache WHERE store_id = $1', [STORE_A_ID]);
    expect(stored.rows).toHaveLength(0);
  });
});
