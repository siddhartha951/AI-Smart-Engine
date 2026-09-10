import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Full-Store Auto-Tracking & Admin Feature Control', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let tokenSuperAdmin: string;
  let storeId: string;
  let visitorId: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();
    app = createApp({ db });

    // Super Admin login
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@platform.com', password: 'password123' });
    tokenSuperAdmin = loginRes.body.token;

    // Get seeded store
    const storeRes = await db.query('SELECT id, live_tracking_enabled FROM stores LIMIT 1');
    storeId = storeRes.rows[0].id;

    // Create visitor
    const visRes = await db.query(
      'INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id',
      [storeId, 'anon_test_autotrack']
    );
    visitorId = visRes.rows[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('1. Default store state has live_tracking_enabled: true', async () => {
    const res = await request(app)
      .get('/api/v1/widget/config')
      .set('X-Widget-Key', storeId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.features).toBeDefined();
    expect(res.body.data.features.live_tracking_enabled).toBe(true);
  });

  it('2. Admin can toggle live_tracking_enabled to false via PATCH /stores/:storeId/features', async () => {
    const patchRes = await request(app)
      .patch(`/api/v1/admin/stores/${storeId}/features`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ live_tracking_enabled: false });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.success).toBe(true);
    expect(patchRes.body.data.live_tracking_enabled).toBe(false);

    // Widget config should now return live_tracking_enabled: false
    const cfgRes = await request(app)
      .get('/api/v1/widget/config')
      .set('X-Widget-Key', storeId);

    expect(cfgRes.status).toBe(200);
    expect(cfgRes.body.data.features.live_tracking_enabled).toBe(false);

    // Audit log should capture the toggle
    const auditRes = await db.query(
      "SELECT * FROM audit_logs WHERE action = 'TOGGLE_STORE_LIVE_TRACKING' AND store_id = $1",
      [storeId]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });

  it('3. Admin can toggle live_tracking_enabled back to true', async () => {
    // Disable first
    await request(app)
      .patch(`/api/v1/admin/stores/${storeId}/features`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ live_tracking_enabled: false });

    // Enable back
    const reEnableRes = await request(app)
      .patch(`/api/v1/admin/stores/${storeId}/features`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ live_tracking_enabled: true });

    expect(reEnableRes.status).toBe(200);
    expect(reEnableRes.body.data.live_tracking_enabled).toBe(true);

    const cfgRes = await request(app)
      .get('/api/v1/widget/config')
      .set('X-Widget-Key', storeId);

    expect(cfgRes.body.data.features.live_tracking_enabled).toBe(true);
  });

  it('4. Full-store auto-tracking accepts page_view and storefront add_to_cart events', async () => {
    // Page View event
    const pvRes = await request(app)
      .post('/api/v1/widget/events')
      .send({
        widget_key: storeId,
        visitor_id: visitorId,
        type: 'page_view',
        payload: {
          path: '/collections/summer-edition',
          title: 'Summer Collection | Brand',
          referrer: 'https://google.com'
        }
      });
    expect(pvRes.status).toBe(200);
    expect(pvRes.body.success).toBe(true);

    // Storefront Add to Cart event (from theme interceptor)
    const atcRes = await request(app)
      .post('/api/v1/widget/events')
      .send({
        widget_key: storeId,
        visitor_id: visitorId,
        type: 'add_to_cart',
        payload: {
          title: 'Storefront Jacket',
          price: '89.99',
          currency: 'USD',
          source: 'storefront_theme'
        }
      });
    expect(atcRes.status).toBe(200);
    expect(atcRes.body.success).toBe(true);

    // Verify events in database
    const events = await db.query(
      'SELECT type, payload FROM events WHERE store_id = $1 ORDER BY created_at DESC LIMIT 2',
      [storeId]
    );
    expect(events.rows.length).toBe(2);
    expect(events.rows[0].type).toBe('add_to_cart');
    expect(events.rows[1].type).toBe('page_view');
  });

  it('5. Dashboard live analytics endpoint returns live_tracking_enabled status', async () => {
    // Login merchant
    const merchLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    const merchToken = merchLogin.body.token;

    const liveRes = await request(app)
      .get(`/api/v1/dashboard/${storeId}/analytics/live`)
      .set('Authorization', `Bearer ${merchToken}`);

    expect(liveRes.status).toBe(200);
    expect(liveRes.body.success).toBe(true);
    expect(liveRes.body.data.live_tracking_enabled).toBe(true);
    expect(Array.isArray(liveRes.body.data.feed)).toBe(true);
  });
});
