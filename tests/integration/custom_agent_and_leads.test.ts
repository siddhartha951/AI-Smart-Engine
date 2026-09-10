import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Custom Agent Training, Leads & Widget Enhancements', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let tokenStoreA: string;
  let widgetKeyA: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    // Authenticate Merchant A
    const resA = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenStoreA = resA.body.token;

    // Get widget key
    const storeRes = await db.query<{ widget_key: string }>('SELECT widget_key FROM stores WHERE id = $1', [STORE_A_ID]);
    widgetKeyA = storeRes.rows[0].widget_key;
  });

  afterEach(async () => {
    await db.close();
  });

  it('Merchant can save custom_prompt and knowledge_base to assistant settings', async () => {
    const updateRes = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${tokenStoreA}`)
      .send({
        assistant: {
          custom_prompt: 'Always offer 10% coupon code SAVE10 to organic tea shoppers.',
          knowledge_base: 'All teas are harvested in Darjeeling and are 100% organic certified.',
        },
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);

    // Verify persisted
    const getRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.assistant.custom_prompt).toBe('Always offer 10% coupon code SAVE10 to organic tea shoppers.');
    expect(getRes.body.data.assistant.knowledge_base).toBe('All teas are harvested in Darjeeling and are 100% organic certified.');
  });

  it('Merchant can upload text knowledge document to append to knowledge_base', async () => {
    const uploadRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/agent/upload-knowledge`)
      .set('Authorization', `Bearer ${tokenStoreA}`)
      .send({
        title: 'Return Policy FAQ',
        text_content: 'Returns are accepted within 30 days of delivery.',
      });

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.success).toBe(true);
    expect(uploadRes.body.knowledge_base).toContain('Return Policy FAQ');
    expect(uploadRes.body.knowledge_base).toContain('Returns are accepted within 30 days of delivery.');
  });

  it('Merchant can fetch marketing leads and track conversions', async () => {
    // 1. Insert a visitor and marketing consent with required wording
    const vRes = await db.query<{ id: string }>(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon_test_user', 'shopper@example.com']
    );
    const visitorId = vRes.rows[0].id;

    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording, source) VALUES ($1, $2, true, 'I agree to updates', 'widget_chat')`,
      [STORE_A_ID, visitorId]
    );

    // Initial leads check
    let leadsRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/leads`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(leadsRes.status).toBe(200);
    expect(leadsRes.body.data.summary.total_leads).toBe(1);
    expect(leadsRes.body.data.summary.opted_in).toBe(1);
    expect(leadsRes.body.data.summary.converted).toBe(0);
    expect(leadsRes.body.data.leads[0].email).toBe('shopper@example.com');
    expect(leadsRes.body.data.leads[0].converted).toBe(false);

    // 2. Insert purchase event matching email and visitor_id
    await db.query(
      `INSERT INTO events (store_id, visitor_id, type, payload) VALUES ($1, $2, $3, $4)`,
      [STORE_A_ID, visitorId, 'purchase_completed', JSON.stringify({ customer_email: 'shopper@example.com', total_price: '49.99' })]
    );

    // Check leads again
    leadsRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/leads`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(leadsRes.status).toBe(200);
    expect(leadsRes.body.data.summary.converted).toBe(1);
    expect(leadsRes.body.data.summary.conversion_rate).toBe('100.0%');
    expect(leadsRes.body.data.leads[0].converted).toBe(true);
    expect(leadsRes.body.data.leads[0].order_total).toBe('49.99');
  });

  it('Shopify sync executes product sync without 501 error', async () => {
    const syncRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/shopify/sync`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(syncRes.status).toBe(200);
    expect(syncRes.body.success).toBe(true);
    expect(syncRes.body.message).toContain('synced');
    expect(typeof syncRes.body.total_synced).toBe('number');
  });

  it('Widget config returns 200 even when assistant is inactive (always visible widget)', async () => {
    // Disable assistant
    await db.query('UPDATE assistant_settings SET is_active = false WHERE store_id = $1', [STORE_A_ID]);

    const configRes = await request(app)
      .get('/api/v1/widget/config')
      .set('x-widget-key', widgetKeyA);

    expect(configRes.status).toBe(200);
    expect(configRes.body.success).toBe(true);
    expect(configRes.body.data.assistant.is_active).toBe(false);
  });
});
