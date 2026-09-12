import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';

describe('Phase 17: AI Intelligence Layer & Domain Analytics', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let tokenA: string;
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

    // Admin Login
    const resAdmin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@platform.com', password: 'password123' });
    adminToken = resAdmin.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  it('1. generates overview insights with grounded what, why, and next actions', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ai/overview-insights`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.what_is_happening).toBeDefined();
    expect(res.body.data.why_it_is_happening).toBeDefined();
    expect(res.body.data.what_to_do_next).toBeDefined();
    expect(res.body.data.biggest_opportunity).toBeDefined();
    expect(res.body.data.biggest_problem).toBeDefined();
  });

  it('2. runs comprehensive store audit across conversion, catalog, traffic, and retention', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai/store-analysis`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ forceRefresh: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.summary).toBeDefined();
    expect(typeof res.body.data.health_score).toBe('number');
    expect(Array.isArray(res.body.data.strengths)).toBe(true);
    expect(Array.isArray(res.body.data.problems)).toBe(true);
    expect(Array.isArray(res.body.data.opportunities)).toBe(true);
    expect(Array.isArray(res.body.data.priority_actions)).toBe(true);
    expect(Array.isArray(res.body.data.revenue_opportunities)).toBe(true);
  });

  it('3. generates catalogue analysis and listing quality scores', async () => {
    // Seed a product with shopify_id
    await db.query(
      `INSERT INTO products (id, store_id, shopify_id, title, price, currency, category, handle, in_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      ['prod-ai-1', STORE_A_ID, 'sh-ai-1', 'Organic Bamboo Tea', 14.99, 'GBP', 'Beverages', 'organic-bamboo-tea', true]
    );

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai/catalogue-analysis`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ forceRefresh: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.average_listing_score).toBe('number');
    expect(res.body.data.overview_summary).toBeDefined();
    expect(Array.isArray(res.body.data.products)).toBe(true);
  });

  it('4. generates listing improvements for a specific catalog product without auto-applying to Shopify', async () => {
    // Seed product with shopify_id
    await db.query(
      `INSERT INTO products (id, store_id, shopify_id, title, price, currency, category, handle, in_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
      ['prod-ai-2', STORE_A_ID, 'sh-ai-2', 'Basic Linen Shirt', 45.00, 'GBP', 'Apparel', 'basic-linen-shirt', true]
    );

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai/product-improvements`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId: 'prod-ai-2' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.improved_title).toBeDefined();
    expect(res.body.data.improved_description).toBeDefined();
    expect(Array.isArray(res.body.data.selling_points)).toBe(true);
    expect(Array.isArray(res.body.data.faq_suggestions)).toBe(true);
    expect(Array.isArray(res.body.data.recommendation_tags)).toBe(true);

    // Verify original product in database was NOT silently overwritten
    const prodDb = await db.query('SELECT title FROM products WHERE id = $1', ['prod-ai-2']);
    expect(prodDb.rows[0].title).toBe('Basic Linen Shirt');
  });

  it('5. performs funnel drop-off analysis with root causes and fixes', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ai/funnel-analysis`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.executive_summary).toBeDefined();
    expect(Array.isArray(res.body.data.top_bottlenecks)).toBe(true);
    if (res.body.data.top_bottlenecks.length > 0) {
      expect(res.body.data.top_bottlenecks[0].stage).toBeDefined();
      expect(res.body.data.top_bottlenecks[0].recommended_fix).toBeDefined();
    }
  });

  it('6. answers merchant questions about funnel telemetry', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai/funnel-ask`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ question: 'Why is checkout drop-off high?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toBeDefined();
    expect(Array.isArray(res.body.data.suggested_actions)).toBe(true);
  });

  it('7. generates high-converting email drafts across lifecycle types without sending', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai/email-generate`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        emailType: 'abandoned_cart',
        tone: 'urgent',
        goal: 'conversion',
        length: 'medium',
        customContext: 'Offer code EXTRA10 for 10% off',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.subject).toBeDefined();
    expect(res.body.data.preview_text).toBeDefined();
    expect(res.body.data.body).toBeDefined();
    expect(res.body.data.cta || res.body.data.call_to_action).toBeDefined();
    expect(Array.isArray(res.body.data.alternative_subjects)).toBe(true);

    // Verify zero emails were dispatched into email_campaign_events
    const eventRes = await db.query(
      'SELECT COUNT(*) as count FROM email_campaign_events WHERE store_id = $1',
      [STORE_A_ID]
    );
    expect(parseInt(eventRes.rows[0].count, 10)).toBe(0);
  });

  it('8. analyzes multi-touch ad performance with working/not working breakdown', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ai/ad-analysis`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.what_is_working)).toBe(true);
    expect(Array.isArray(res.body.data.what_is_not)).toBe(true);
    expect(Array.isArray(res.body.data.why_it_happens)).toBe(true);
    expect(Array.isArray(res.body.data.what_to_test_next)).toBe(true);
  });

  it('9. answers merchant ad attribution questions', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai/ad-ask`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ question: 'Which ad channel has the best blended ROAS?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toBeDefined();
  });

  it('10. recommends replenishable consumable products from catalog with cycle days', async () => {
    // Seed products in consumables category with shopify_id
    await db.query(
      `INSERT INTO products (id, store_id, shopify_id, title, price, currency, category, handle, in_stock)
       VALUES 
       ('prod-c-1', $1, 'sh-c-1', 'Hydrating Face Moisturizer 50ml', 28.00, 'GBP', 'Skincare', 'face-moisturizer', true),
       ('prod-c-2', $1, 'sh-c-2', 'Ceramic Coffee Mug', 15.00, 'GBP', 'Kitchenware', 'coffee-mug', true)
       ON CONFLICT (id) DO NOTHING`,
      [STORE_A_ID]
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/replenishment/ai-recommendations`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.recommendations)).toBe(true);

    const skincareRec = res.body.data.recommendations.find((r: any) => r.title.includes('Face') || r.title.includes('Moisturizer') || r.title.includes('Serum') || r.title.includes('Coffee'));
    expect(skincareRec).toBeDefined();
    expect(skincareRec.suggested_cycle_days).toBeGreaterThan(0);
  });

  it('11. handles interactive growth copilot Q&A with grounded actions', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/growth/copilot/ask`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ question: 'What is our fastest way to increase store revenue today?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toBeDefined();
    expect(Array.isArray(res.body.data.suggested_actions)).toBe(true);
    if (res.body.data.suggested_actions.length > 0) {
      expect(res.body.data.suggested_actions[0].target_module || res.body.data.suggested_actions[0].action).toBeDefined();
    }
  });

  it('12. caches analysis in database and supports manual cache refresh', async () => {
    // First call caches response
    const firstRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ai/overview-insights`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(firstRes.status).toBe(200);

    // Verify record in ai_cache
    const cacheRow = await db.query(
      "SELECT * FROM ai_cache WHERE store_id = $1 AND analysis_type = 'overview_insights'",
      [STORE_A_ID]
    );
    expect(cacheRow.rows.length).toBe(1);

    // Second call with refresh=true updates cache
    const secondRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ai/overview-insights?refresh=true`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data).toBeDefined();
  });

  it('13. blocks AI endpoints with 403 when parent feature entitlement is disabled', async () => {
    // Disable ai_store_analysis for Store A
    await request(app)
      .put(`/api/v1/admin/stores/${STORE_A_ID}/features/ai_store_analysis`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: false });

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai/store-analysis`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('ai_store_analysis');
  });
});
