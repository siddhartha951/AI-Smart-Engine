import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import crypto from 'crypto';

describe('Phase 10: Shopify Activation & Tracking', () => {
  let app: any;
  let db: any;
  let storeId: string;
  let widgetKey: string;
  let adminToken: string;
  let visitorId: string;

  beforeAll(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();
    app = createApp({ db });

    // Seed test admin user for fetching stats
    const adminEmail = `admin-${Date.now()}@test.com`;
    await db.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, 'hash', 'platform_admin') RETURNING id`, [adminEmail]);
    
    // Auth login logic for admin (mocking JWT)
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'password' });
    // In our test suite, we usually just mock the JWT or seed a store directly.

    // Seed test merchant and store
    const merchantRes = await db.query(`INSERT INTO merchants (name, contact_email, status) VALUES ('Test Merch', 'test@test.com', 'active') RETURNING id`);
    const merchantId = merchantRes.rows[0].id;

    const storeRes = await db.query(`INSERT INTO stores (merchant_id, shop_domain, brand_name, status) VALUES ($1, 'test.myshopify.com', 'Test Brand', 'active') RETURNING id, widget_key`, [merchantId]);
    storeId = storeRes.rows[0].id;
    widgetKey = storeRes.rows[0].widget_key;

    // Seed assistant setting
    await db.query(`INSERT INTO assistant_settings (store_id, is_active) VALUES ($1, true)`, [storeId]);
  });

  afterAll(async () => {
    // Cleanup
    if (storeId) {
      await db.query(`DELETE FROM stores WHERE id = $1`, [storeId]);
      await db.query(`DELETE FROM merchants WHERE contact_email = 'test@test.com'`);
    }
  });

  it('should securely bootstrap the widget using widget_key and check origin', async () => {
    // Correct origin (localhost is allowed)
    const res = await request(app)
      .get(`/api/v1/widget/bootstrap?widget_key=${widgetKey}`)
      .set('Origin', 'http://localhost:3000');
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.config.agent.is_active).toBeUndefined(); // Returns tone/welcome_message, not is_active directly but succeeds

    // Unauthorized origin
    const badRes = await request(app)
      .get(`/api/v1/widget/bootstrap?widget_key=${widgetKey}`)
      .set('Origin', 'https://malicious-site.com');
    
    expect(badRes.status).toBe(403);
    expect(badRes.body.error?.message).toContain('Origin');
  });

  it('should track widget opened event securely', async () => {
    const visitorRes = await db.query(`INSERT INTO visitors (store_id, email, anonymous_id) VALUES ($1, 'testvisitor@test.com', 'anon-123') RETURNING id`, [storeId]);
    visitorId = visitorRes.rows[0].id;

    const res = await request(app)
      .post('/api/v1/widget/events')
      .set('Origin', 'http://localhost:3000')
      .send({
        widget_key: widgetKey,
        visitor_id: visitorId,
        type: 'widget_opened'
      });
    
    expect(res.status).toBe(200);

    // Verify in db
    const eventRes = await db.query(`SELECT * FROM events WHERE visitor_id = $1 AND type = 'widget_opened'`, [visitorId]);
    expect(eventRes.rows.length).toBe(1);
  });

  it('should validate HMAC for Shopify webhooks', async () => {
    const payload = JSON.stringify({ id: 12345, total_price: "100.00" });
    const secret = process.env.SHOPIFY_CLIENT_SECRET || 'test_shopify_secret_change_in_production';
    const hash = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64');

    const res = await request(app)
      .post('/api/v1/shopify/webhooks/orders')
      .set('X-Shopify-Hmac-Sha256', hash)
      .set('X-Shopify-Shop-Domain', 'test.myshopify.com')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);

    // Verify event was created
    const eventRes = await db.query(`SELECT * FROM events WHERE type = 'purchase_completed' AND store_id = $1`, [storeId]);
    expect(eventRes.rows.length).toBe(1);
  });
});
