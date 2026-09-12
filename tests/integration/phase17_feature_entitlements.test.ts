import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';

describe('Phase 17: Admin Feature Entitlements & Guard Enforcement', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let tokenA: string;
  let tokenB: string;
  let adminToken: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    // Merchant A Login
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    // Merchant B Login
    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    tokenB = resB.body.token;

    // Admin Login
    const resAdmin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@platform.com', password: 'password123' });
    adminToken = resAdmin.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  it('1. returns full feature entitlements for a store via dashboard API', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/features`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.store_id).toBe(STORE_A_ID);
    expect(res.body.data.features).toBeDefined();
    expect(res.body.data.features.overview).toBe(true);
    expect(res.body.data.features.catalogue).toBe(true);
    expect(res.body.data.features.email_automation).toBe(true);
    expect(res.body.data.features.smart_reorder).toBe(true);
    expect(res.body.data.features.ad_intelligence).toBe(true);
    expect(res.body.data.features.growth_copilot).toBe(true);
  });

  it('2. allows platform admin to view feature catalog and store entitlements with metadata', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/stores/${STORE_A_ID}/features`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.features)).toBe(true);

    const catalogueFeat = res.body.data.features.find((f: any) => f.key === 'catalogue');
    expect(catalogueFeat).toBeDefined();
    expect(catalogueFeat.name).toBe('Products & Catalogue');
    expect(catalogueFeat.enabled).toBe(true);
    expect(catalogueFeat.category).toBe('core');
  });

  it('3. allows platform admin to disable a feature and records audit log', async () => {
    const putRes = await request(app)
      .put(`/api/v1/admin/stores/${STORE_A_ID}/features/catalogue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);
    expect(putRes.body.data.enabled).toBe(false);

    // Verify audit log entry
    const auditRes = await db.query(
      "SELECT * FROM audit_logs WHERE store_id = $1 AND action = 'UPDATE_FEATURE_ENTITLEMENT'",
      [STORE_A_ID]
    );
    expect(auditRes.rows.length).toBeGreaterThanOrEqual(1);
    const newState = typeof auditRes.rows[0].new_state === 'string' 
      ? JSON.parse(auditRes.rows[0].new_state) 
      : auditRes.rows[0].new_state;
    expect(newState.feature_key).toBe('catalogue');
    expect(newState.enabled).toBe(false);
  });

  it('4. blocks merchant access with 403 when feature is disabled', async () => {
    // Disable catalogue for Store A
    await request(app)
      .put(`/api/v1/admin/stores/${STORE_A_ID}/features/catalogue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });

    // Merchant A attempts to access products catalog
    const resA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/products`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resA.status).toBe(403);
    expect(resA.body.success).toBe(false);
    expect(resA.body.error).toContain('catalogue');
  });

  it('5. enforces strict cross-tenant entitlement isolation (Store B remains unaffected)', async () => {
    // Disable email_automation for Store A only
    await request(app)
      .put(`/api/v1/admin/stores/${STORE_A_ID}/features/email_automation`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });

    // Store A is blocked
    const resA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/email`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resA.status).toBe(403);

    // Store B still has full access
    const resB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/email`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.success).toBe(true);
  });

  it('6. re-enables feature when admin restores access', async () => {
    // Disable then enable
    await request(app)
      .put(`/api/v1/admin/stores/${STORE_A_ID}/features/catalogue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });

    await request(app)
      .put(`/api/v1/admin/stores/${STORE_A_ID}/features/catalogue`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true });

    // Access restored
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/products`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('7. allows bulk updating feature entitlements', async () => {
    const bulkRes = await request(app)
      .post(`/api/v1/admin/stores/${STORE_A_ID}/features/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        entitlements: {
          whatsapp: false,
          ad_creative: false,
        },
      });

    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.success).toBe(true);

    const featRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/features`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(featRes.body.data.features.whatsapp).toBe(false);
    expect(featRes.body.data.features.ad_creative).toBe(false);
    expect(featRes.body.data.features.overview).toBe(true);
  });

  it('8. rejects non-admin users attempting to modify entitlements', async () => {
    const res = await request(app)
      .put(`/api/v1/admin/stores/${STORE_A_ID}/features/catalogue`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ enabled: false });

    expect(res.status).toBe(403);
  });
});
