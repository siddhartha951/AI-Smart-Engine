import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Super Admin: Reset Store Data Endpoint', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  let tokenSuperAdmin: string;
  let tokenOpsAdmin: string;
  let tokenMerchant: string;

  let storeId: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();
    app = createApp({ db });

    // Login super admin
    const resSA = await request(app).post('/api/v1/auth/login').send({ email: 'admin@platform.com', password: 'password123' });
    tokenSuperAdmin = resSA.body.token;

    // Login ops admin
    const resOps = await request(app).post('/api/v1/auth/login').send({ email: 'ops_admin@platform.com', password: 'password123' });
    tokenOpsAdmin = resOps.body.token;

    // Login merchant
    const resMerch = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenMerchant = resMerch.body.token;

    // Find store for merchant A
    const storeRes = await db.query(`SELECT id FROM stores LIMIT 1`);
    storeId = storeRes.rows[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('Merchant owner receives 403 Forbidden when calling reset-data', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/stores/${storeId}/reset-data`)
      .set('Authorization', `Bearer ${tokenMerchant}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it('Ops admin receives 403 Forbidden when calling reset-data', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/stores/${storeId}/reset-data`)
      .set('Authorization', `Bearer ${tokenOpsAdmin}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: super admin access required');
  });

  it('Super Admin successfully resets operational data while strictly preserving products, visitors, and consents', async () => {
    // 1. Seed preserved records: product, visitor lead, marketing consent
    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, title, handle, in_stock, price, created_at, updated_at)
      VALUES ('prod-123', $1, 'shop-123', 'Preserved T-Shirt', 'preserved-t-shirt', true, 49.99, NOW(), NOW())
    `, [storeId]);

    const visitorRes = await db.query(`
      INSERT INTO visitors (store_id, anonymous_id, email, phone, created_at, updated_at)
      VALUES ($1, 'anon-cust-999', 'custlead@example.com', '+15551234567', NOW(), NOW())
      RETURNING id
    `, [storeId]);
    const visitorId = visitorRes.rows[0].id;

    await db.query(`
      INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording, source)
      VALUES ($1, $2, true, 'I consent to marketing updates', 'checkout')
    `, [storeId, visitorId]);

    // 2. Seed operational / activity records: sessions, messages, recommendations, events, email logs, AI ledger
    const sessionRes = await db.query(`
      INSERT INTO chat_sessions (store_id, visitor_id, status, started_at, created_at, updated_at)
      VALUES ($1, $2, 'active', NOW(), NOW(), NOW())
      RETURNING id
    `, [storeId, visitorId]);
    const sessionId = sessionRes.rows[0].id;

    await db.query(`
      INSERT INTO chat_messages (store_id, session_id, role, content, created_at)
      VALUES ($1, $2, 'customer', 'Hello I want a jacket', NOW()),
             ($1, $2, 'assistant', 'Here are recommendations', NOW())
    `, [storeId, sessionId]);

    await db.query(`
      INSERT INTO recommendations (store_id, session_id, product_id, variant_id, title, price, currency, reason, created_at)
      VALUES ($1, $2, 'prod-123', 'var-123', 'Preserved T-Shirt', 49.99, 'INR', 'Matching style', NOW())
    `, [storeId, sessionId]);

    await db.query(`
      INSERT INTO events (store_id, visitor_id, session_id, type, payload, created_at)
      VALUES ($1, $2, $3, 'product_viewed', '{"handle":"preserved-t-shirt"}'::jsonb, NOW())
    `, [storeId, visitorId, sessionId]);

    await db.query(`
      INSERT INTO email_campaign_events (store_id, visitor_id, session_id, campaign_type, stage, scheduled_for, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'abandoned_chat_recovery', 1, NOW(), 'pending', NOW(), NOW())
    `, [storeId, visitorId, sessionId]);

    await db.query(`
      INSERT INTO ai_usage_ledger (store_id, session_id, model, input_tokens, output_tokens, estimated_cost_usd, billing_period, created_at)
      VALUES ($1, $2, 'gpt-4o-mini', 250, 80, 0.0001, '2026-09', NOW())
    `, [storeId, sessionId]);

    // Verify seeded state before reset
    const preCheckProd = await db.query(`SELECT COUNT(*) as cnt FROM products WHERE store_id = $1`, [storeId]);
    const preCheckVis = await db.query(`SELECT COUNT(*) as cnt FROM visitors WHERE store_id = $1`, [storeId]);
    const preCheckConsent = await db.query(`SELECT COUNT(*) as cnt FROM marketing_consents WHERE store_id = $1`, [storeId]);
    const preCheckChats = await db.query(`SELECT COUNT(*) as cnt FROM chat_sessions WHERE store_id = $1`, [storeId]);
    const preCheckEvents = await db.query(`SELECT COUNT(*) as cnt FROM events WHERE store_id = $1`, [storeId]);

    expect(Number(preCheckProd.rows[0].cnt)).toBeGreaterThanOrEqual(1);
    expect(Number(preCheckVis.rows[0].cnt)).toBeGreaterThanOrEqual(1);
    expect(Number(preCheckConsent.rows[0].cnt)).toBeGreaterThanOrEqual(1);
    expect(Number(preCheckChats.rows[0].cnt)).toBeGreaterThanOrEqual(1);
    expect(Number(preCheckEvents.rows[0].cnt)).toBeGreaterThanOrEqual(1);

    // 3. Execute Reset as Super Admin
    const resetRes = await request(app)
      .post(`/api/v1/admin/stores/${storeId}/reset-data`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);
    expect(resetRes.body.message).toContain('Store data reset successfully');
    expect(resetRes.body.data.preserved.products).toBeGreaterThanOrEqual(1);
    expect(resetRes.body.data.preserved.visitors).toBeGreaterThanOrEqual(1);
    expect(resetRes.body.data.preserved.marketing_consents).toBeGreaterThanOrEqual(1);

    // 4. Assert PRESERVED tables in database
    const postProd = await db.query(`SELECT COUNT(*) as cnt FROM products WHERE store_id = $1`, [storeId]);
    const postVis = await db.query(`SELECT COUNT(*) as cnt FROM visitors WHERE store_id = $1`, [storeId]);
    const postConsent = await db.query(`SELECT COUNT(*) as cnt FROM marketing_consents WHERE store_id = $1`, [storeId]);
    const postStore = await db.query(`SELECT COUNT(*) as cnt FROM stores WHERE id = $1`, [storeId]);

    expect(Number(postProd.rows[0].cnt)).toBe(Number(preCheckProd.rows[0].cnt));
    expect(Number(postVis.rows[0].cnt)).toBe(Number(preCheckVis.rows[0].cnt));
    expect(Number(postConsent.rows[0].cnt)).toBe(Number(preCheckConsent.rows[0].cnt));
    expect(Number(postStore.rows[0].cnt)).toBe(1);

    // 5. Assert CLEARED operational tables in database
    const postChats = await db.query(`SELECT COUNT(*) as cnt FROM chat_sessions WHERE store_id = $1`, [storeId]);
    const postMessages = await db.query(`
      SELECT COUNT(*) as cnt FROM chat_messages m
      JOIN chat_sessions s ON m.session_id = s.id
      WHERE s.store_id = $1
    `, [storeId]);
    const postRecs = await db.query(`SELECT COUNT(*) as cnt FROM recommendations WHERE store_id = $1`, [storeId]);
    const postEvents = await db.query(`SELECT COUNT(*) as cnt FROM events WHERE store_id = $1`, [storeId]);
    const postEmailEvents = await db.query(`SELECT COUNT(*) as cnt FROM email_campaign_events WHERE store_id = $1`, [storeId]);
    const postAiLedger = await db.query(`SELECT COUNT(*) as cnt FROM ai_usage_ledger WHERE store_id = $1`, [storeId]);

    expect(Number(postChats.rows[0].cnt)).toBe(0);
    expect(Number(postMessages.rows[0].cnt)).toBe(0);
    expect(Number(postRecs.rows[0].cnt)).toBe(0);
    expect(Number(postEvents.rows[0].cnt)).toBe(0);
    expect(Number(postEmailEvents.rows[0].cnt)).toBe(0);
    expect(Number(postAiLedger.rows[0].cnt)).toBe(0);

    // 6. Assert Audit Log entry
    const auditRes = await db.query(`
      SELECT a.*, u.email as user_email FROM audit_logs a
      JOIN users u ON a.user_id = u.id
      WHERE a.store_id = $1 AND a.action = 'RESET_STORE_DATA'
    `, [storeId]);
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].user_email).toBe('admin@platform.com');
  });
});
