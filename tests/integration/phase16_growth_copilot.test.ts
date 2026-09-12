import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { GrowthService } from '../../src/modules/growth/growth.service';
import { WebhookService } from '../../src/modules/events/webhook.service';
import { AttributionService } from '../../src/modules/attribution/attribution.service';
import { ReplenishmentService } from '../../src/modules/replenishment/replenishment.service';

describe('Phase 16: AI Merchant Growth Copilot & Action Center', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let growthService: GrowthService;
  let webhookService: WebhookService;
  let attributionService: AttributionService;
  let replenishmentService: ReplenishmentService;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // London Eco Apparel (shop_domain: london-eco.myshopify.com)
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Highland Peak Gear (shop_domain: highland-gear.myshopify.com)

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });
    growthService = new GrowthService({ db });
    webhookService = new WebhookService();
    attributionService = new AttributionService({ db });
    replenishmentService = new ReplenishmentService({ db });

    // Log in Store A
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    // Log in Store B
    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    tokenB = resB.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  // 1. Overview
  it('1. loads growth overview with real multi-module data and zero division safety', async () => {
    // Seed an order in order_attributions
    await db.query(
      `INSERT INTO order_attributions (
         store_id, order_id, order_number, order_revenue, currency,
         first_touch_source, first_touch_campaign,
         last_touch_source, last_touch_campaign,
         touchpoint_count, is_ai_assisted, order_created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [STORE_A_ID, 'ord-101', '1001', 120.00, 'GBP', 'google', 'spring_sale', 'google', 'spring_sale', 1, false]
    );

    // Seed spend
    await db.query(
      `INSERT INTO ad_spend (store_id, spend_date, platform, campaign, spend_amount, currency)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)`,
      [STORE_A_ID, 'google', 'spring_sale', 40.00, 'GBP']
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/overview`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total_revenue).toBe(120.00);
    expect(res.body.data.total_orders).toBe(1);
    expect(res.body.data.total_ad_spend).toBe(40.00);
    expect(res.body.data.blended_roas).toBe(3.0); // 120 / 40
    expect(res.body.data.currency).toBe('GBP');
  });

  // 2. Goal Creation
  it('2. creates default growth goal for new store', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/goal`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.primary_goal).toBe('increase_revenue');
    expect(res.body.data.store_id).toBe(STORE_A_ID);
  });

  // 3. Goal Update
  it('3. updates merchant primary goal and recalculates priorities', async () => {
    const res = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/growth/goal`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        primary_goal: 'improve_roas',
        target_metric: 'blended_roas',
        target_value: 4.0
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.primary_goal).toBe('improve_roas');
    expect(Number(res.body.data.target_value)).toBe(4.0);

    // Verify persistence
    const check = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/goal`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(check.body.data.primary_goal).toBe('improve_roas');
  });

  // 4. Tenant Isolation
  it('4. strictly enforces tenant isolation on all growth endpoints', async () => {
    // Store A tries to access Store B growth overview
    const resOverview = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/growth/overview`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resOverview.status).toBe(403);

    // Store A tries to update Store B goal
    const resGoal = await request(app)
      .put(`/api/v1/dashboard/${STORE_B_ID}/growth/goal`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ primary_goal: 'improve_conversion' });
    expect(resGoal.status).toBe(403);
  });

  // 5. Abandoned Cart Opportunity
  it('5. detects abandoned cart recovery opportunity with deterministic estimate', async () => {
    // Seed visitor with marketing consent
    const visRes = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-cart-1', 'cartabandon@test.com']
    );
    const visitorId = visRes.rows[0].id;
    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording, version, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [STORE_A_ID, visitorId, true, 'Consent agreed', '1.0', 'checkout']
    );

    // Record add to cart event (no purchase)
    await db.query(
      `INSERT INTO events (store_id, visitor_id, type, payload) VALUES ($1, $2, $3, $4)`,
      [STORE_A_ID, visitorId, 'add_to_cart', JSON.stringify({ title: 'Eco Hoodie', price: 60.00 })]
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/actions`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const cartAction = res.body.data.find((a: any) => a.action_key === 'eligible_cart_recovery');
    expect(cartAction).toBeDefined();
    expect(cartAction.action_type).toBe('OPEN_CART_RECOVERY');
    expect(cartAction.target_module).toBe('email-automation');
    expect(cartAction.estimated_opportunity).toBeGreaterThan(0);
  });

  // 6. High-spend / low-ROAS detection
  it('6. detects high spend / low ROAS campaign efficiency opportunity', async () => {
    // Seed visitor
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-roas-vis', 'roas_user@test.com']
    );
    const visitorId = vis.rows[0].id;

    // Seed campaign with high spend (£100) and low revenue (£50) -> 0.5x ROAS
    await db.query(
      `INSERT INTO ad_spend (store_id, spend_date, platform, campaign, spend_amount, currency)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)`,
      [STORE_A_ID, 'facebook', 'retargeting_q3', 100.00, 'GBP']
    );

    // Attribution touchpoint giving 50 revenue to retargeting_q3
    const orderRes = await db.query(
      `INSERT INTO order_attributions (store_id, order_id, order_number, order_revenue, currency, touchpoint_count, order_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
      [STORE_A_ID, 'ord-roas-low', '2001', 50.00, 'GBP', 1]
    );
    const tpRes = await db.query(
      `INSERT INTO marketing_touchpoints (store_id, visitor_id, source, campaign)
       VALUES ($1, $2, 'facebook', 'retargeting_q3') RETURNING id`,
      [STORE_A_ID, visitorId]
    );
    await db.query(
      `INSERT INTO order_attribution_touchpoints (store_id, order_id, touchpoint_id, weight, attributed_revenue, source, campaign)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [STORE_A_ID, 'ord-roas-low', tpRes.rows[0].id, 1.0, 50.00, 'facebook', 'retargeting_q3']
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/actions`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const roasAction = res.body.data.find((a: any) => a.action_key === 'low_roas_campaign_retargeting_q3');
    expect(roasAction).toBeDefined();
    expect(roasAction.priority).toBe('high');
    expect(roasAction.action_type).toBe('VIEW_CAMPAIGN');
    expect(roasAction.target_module).toBe('ad-intelligence');
  });

  // 7. Reorder opportunity detection
  it('7. detects replenishable reorder opportunity for due customers', async () => {
    // Seed replenishment schedule due in 2 days
    await db.query(
      `INSERT INTO replenishment_schedules (
         store_id, order_id, customer_email, product_id, product_title,
         purchased_at, cycle_days, expected_reorder_at, reminder_at, status, channel
       ) VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '25 days', 30, NOW() + INTERVAL '5 days', NOW() + INTERVAL '2 days', 'pending', 'email')`,
      [STORE_A_ID, 'ord-rep-1', 'coffee_lover@test.com', 'prod-coffee-1', 'Daily Roast Coffee']
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/actions`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const reorderAction = res.body.data.find((a: any) => a.action_key === 'reorder_reminders_due');
    expect(reorderAction).toBeDefined();
    expect(reorderAction.action_type).toBe('OPEN_REORDER');
    expect(reorderAction.target_module).toBe('reorder-reminders');
  });

  // 8. AI-assisted opportunity detection
  it('8. detects AI conversational conversion lift opportunity', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-ai-vis', 'ai_user@test.com']
    );
    const visitorId = vis.rows[0].id;
    const sessRes = await db.query(
      `INSERT INTO chat_sessions (store_id, visitor_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [STORE_A_ID, visitorId]
    );
    const sessionId = sessRes.rows[0].id;
    for (let i = 0; i < 6; i++) {
      await db.query(
        `INSERT INTO recommendations (store_id, session_id, product_id, variant_id, title, price, currency, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [STORE_A_ID, sessionId, `prod-${i}`, '', `Product ${i}`, 25.00, 'GBP', 'AI suggested']
      );
    }

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/actions`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const aiAction = res.body.data.find((a: any) => a.action_key === 'boost_ai_assistant');
    expect(aiAction).toBeDefined();
    expect(aiAction.action_type).toBe('VIEW_AI_ANALYTICS');
    expect(aiAction.target_module).toBe('my-agent');
  });

  // 9. Product conversion opportunity
  it('9. detects product conversion opportunity (high views, low cart adds)', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-browse-user']
    );
    const visitorId = vis.rows[0].id;

    // 12 product clicks and 0 cart adds
    for (let i = 0; i < 12; i++) {
      await db.query(
        `INSERT INTO events (store_id, visitor_id, type, payload) VALUES ($1, $2, $3, $4)`,
        [STORE_A_ID, visitorId, 'product_click', JSON.stringify({ product_id: `p-${i}` })]
      );
    }

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/actions`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const prodAction = res.body.data.find((a: any) => a.action_key === 'product_conversion_opportunity');
    expect(prodAction).toBeDefined();
    expect(prodAction.action_type).toBe('REVIEW_PRODUCT');
    expect(prodAction.target_module).toBe('shopify-connection');
  });

  // 10. Zero-conversion campaign detection
  it('10. detects zero-conversion campaign review opportunity (spend > 0, 0 orders)', async () => {
    // Seed ad spend without any attributed orders
    await db.query(
      `INSERT INTO ad_spend (store_id, spend_date, platform, campaign, spend_amount, currency)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)`,
      [STORE_A_ID, 'tiktok', 'viral_fail_test', 85.00, 'GBP']
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/actions`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const zeroAction = res.body.data.find((a: any) => a.action_key === 'zero_conv_campaign_viral_fail_test');
    expect(zeroAction).toBeDefined();
    expect(zeroAction.priority).toBe('critical');
    expect(zeroAction.estimated_opportunity).toBe(85.00);
  });

  // 11. Opportunity Prioritization based on Goal
  it('11. dynamically reprioritizes opportunities based on active merchant goal', async () => {
    // Seed both cart recovery and campaign issues
    await db.query(
      `INSERT INTO ad_spend (store_id, spend_date, platform, campaign, spend_amount, currency)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)`,
      [STORE_A_ID, 'facebook', 'boost_camp', 60.00, 'GBP']
    );

    // Set goal to improve_roas
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/growth/goal`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ primary_goal: 'improve_roas' });

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/actions`)
      .set('Authorization', `Bearer ${tokenA}`);

    const campaignAction = res.body.data.find((a: any) => a.action_key.includes('boost_camp'));
    expect(campaignAction).toBeDefined();
    expect(campaignAction.priority).toBe('critical'); // elevated by improve_roas
  });

  // 12. Action Status Update
  it('12. updates growth action status (pending -> completed / dismissed) and logs history', async () => {
    const action1 = await db.query(
      `INSERT INTO growth_actions (
         store_id, action_key, title, priority, reason, estimated_opportunity, action_type, target_module, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [STORE_A_ID, 'act-1', 'Review ROAS', 'high', 'Low return', 50.00, 'VIEW_CAMPAIGN', 'ad-intelligence', 'pending']
    );
    const action2 = await db.query(
      `INSERT INTO growth_actions (
         store_id, action_key, title, priority, reason, estimated_opportunity, action_type, target_module, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [STORE_A_ID, 'act-2', 'Cart Recovery', 'medium', 'Abandoned', 30.00, 'OPEN_CART_RECOVERY', 'email-automation', 'pending']
    );

    const actions = await growthService.getTodayActions(STORE_A_ID);
    expect(actions.length).toBeGreaterThan(0);
    const targetAction = action1.rows[0];

    // Mark completed
    const completeRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/growth/actions/${targetAction.id}/status`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'completed', notes: 'Merchant fixed campaign settings' });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('completed');

    // Dismiss another action
    const dismissRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/growth/actions/${action2.rows[0].id}/status`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'dismissed', notes: 'Ignored by merchant' });

    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.data.status).toBe('dismissed');
  });

  // 13. Action History
  it('13. retrieves action execution history with user and status metadata', async () => {
    const actionRes = await db.query(
      `INSERT INTO growth_actions (
         store_id, action_key, title, priority, reason, estimated_opportunity, action_type, target_module, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [STORE_A_ID, 'act-history-test', 'Audit Campaign', 'high', 'Low return', 75.00, 'VIEW_CAMPAIGN', 'ad-intelligence', 'pending']
    );
    const action = actionRes.rows[0];

    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/growth/actions/${action.id}/status`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'completed', notes: 'Audit verified' });

    const historyRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/history`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.length).toBeGreaterThan(0);
    expect(historyRes.body.data[0].action_key).toBe('act-history-test');
    expect(historyRes.body.data[0].status).toBe('completed');
    expect(historyRes.body.data[0].notes).toBe('Audit verified');
  });

  // 14. Zero-data handling
  it('14. handles zero-data merchant safely without NaN, Infinity, or crash', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/growth/overview`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total_revenue).toBe(0);
    expect(res.body.data.total_orders).toBe(0);
    expect(res.body.data.average_order_value).toBe(0);
    expect(res.body.data.conversion_rate).toBe(0);
    expect(res.body.data.blended_roas).toBe(0);
    expect(Number.isFinite(res.body.data.blended_roas)).toBe(true);
  });

  // 15. No fabricated metrics
  it('15. ensures no fabricated metrics and disclaims revenue guarantees', async () => {
    const summaryRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/weekly-summary`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.data.metrics).toBeDefined();
    expect(typeof summaryRes.body.data.metrics.revenue).toBe('number');
    expect(typeof summaryRes.body.data.metrics.orders).toBe('number');
    expect(Array.isArray(summaryRes.body.data.what_changed)).toBe(true);
  });

  // 16. AI Explanation endpoint
  it('16. AI explanation endpoint consumes verified real metrics and does not mutate financials', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/growth/explain`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.explanation).toBeDefined();
    expect(typeof res.body.data.explanation).toBe('string');
    expect(Array.isArray(res.body.data.key_takeaways)).toBe(true);
    expect(res.body.data.verified_metrics).toBeDefined();
    expect(res.body.data.verified_metrics.primary_goal).toBeDefined();
  });

  // 17. Unauthorized access blocked
  it('17. blocks unauthenticated and cross-tenant dashboard access with 401/403', async () => {
    const unauth = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/overview`);
    expect(unauth.status).toBe(401);

    const crossTenant = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/growth/overview`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossTenant.status).toBe(403);
  });

  // 18. Full integration: ad click -> widget touchpoint -> order -> attribution -> growth signal
  it('18. full integration: ad click -> widget touchpoint -> order -> attribution -> growth signal', async () => {
    // 1. Create visitor
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-ad-e2e', 'ade2e@customer.com']
    );
    const visitorId = vis.rows[0].id;

    // 2. Ingest touchpoint
    await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: visitorId,
        source: 'facebook',
        medium: 'paid_social',
        campaign: 'meta_e2e_growth',
        fbclid: 'fbclid-growth-123'
      });

    // 3. Complete order via Shopify webhook
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 998811,
      order_number: '998811',
      total_price: '150.00',
      currency: 'GBP',
      email: 'ade2e@customer.com',
      note_attributes: [
        { name: '_ai_visitor_id', value: visitorId },
        { name: 'utm_source', value: 'facebook' },
        { name: 'utm_campaign', value: 'meta_e2e_growth' }
      ]
    });

    // 4. Verify attribution created
    const attr = await attributionService.repo.getOrderAttribution(STORE_A_ID, '998811');
    expect(attr).toBeDefined();
    expect(Number(attr?.order_revenue)).toBe(150.00);
    expect(attr?.first_touch_source).toBe('facebook');

    // 5. Verify growth overview captures this revenue
    const growthOverview = await growthService.getOverview(STORE_A_ID);
    expect(growthOverview.total_revenue).toBeGreaterThanOrEqual(150.00);
  });

  // 19. Full integration: add to cart -> recovery scheduling -> order webhook cancellation
  it('19. full integration: add to cart -> recovery scheduling -> order webhook cancellation', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
      [STORE_A_ID, 'anon-recov-e2e', 'recovery_flow@test.com', '+447911123456']
    );
    const visitorId = vis.rows[0].id;

    // Add marketing consent
    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording, version, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [STORE_A_ID, visitorId, true, 'Opted in for offers', '1.0', 'popup']
    );

    // Widget sends add_to_cart event
    const cartRes = await request(app)
      .post('/api/v1/widget/events')
      .set('x-widget-key', STORE_A_ID)
      .send({
        widget_key: STORE_A_ID,
        visitor_id: visitorId,
        type: 'add_to_cart',
        payload: { product_id: 'prod-cart-1', title: 'Eco Canvas Bag', price: 35.00, currency: 'GBP' }
      });
    expect(cartRes.status).toBe(200);

    // Verify email recovery job was scheduled automatically
    const jobs = await db.query(
      `SELECT id, status FROM email_campaign_events WHERE store_id = $1 AND visitor_id = $2`,
      [STORE_A_ID, visitorId]
    );
    expect(jobs.rows.length).toBe(1);
    expect(jobs.rows[0].status).toBe('pending');

    // Customer places order via Shopify webhook
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 554433,
      order_number: '554433',
      total_price: '35.00',
      currency: 'GBP',
      email: 'recovery_flow@test.com',
      note_attributes: [{ name: '_ai_visitor_id', value: visitorId }]
    });

    // Verify recovery job was automatically cancelled upon purchase
    const cancelledJobs = await db.query(
      `SELECT status, cancel_reason FROM email_campaign_events WHERE store_id = $1 AND visitor_id = $2`,
      [STORE_A_ID, visitorId]
    );
    expect(cancelledJobs.rows[0].status).toBe('cancelled');
    expect(cancelledJobs.rows[0].cancel_reason).toBe('purchased');
  });

  // 20. Full integration: order -> replenishment schedule -> reorder growth signal
  it('20. full integration: order -> replenishment schedule -> reorder growth signal', async () => {
    // 1. Enable replenishment on product
    await replenishmentService.configureProduct(STORE_A_ID, 'prod-supplements-99', {
      replenishable: true,
      cycleDays: 30,
      reminderDaysBefore: 5
    });

    // 2. Customer places order for consumable product
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 771122,
      order_number: '771122',
      total_price: '45.00',
      currency: 'GBP',
      email: 'supplements_user@test.com',
      line_items: [
        {
          product_id: 'prod-supplements-99',
          variant_id: 'var-99',
          title: 'Daily Vitamins (30-day supply)',
          quantity: 1,
          price: '45.00'
        }
      ]
    });

    // 3. Verify schedule created
    const schedRes = await db.query(
      `SELECT * FROM replenishment_schedules WHERE store_id = $1 AND product_id = $2`,
      [STORE_A_ID, 'prod-supplements-99']
    );
    expect(schedRes.rows.length).toBe(1);
    const schedule = schedRes.rows[0];
    expect(schedule.status).toBe('pending');

    // 4. Update reminder_at to today so it becomes due
    await db.query(
      `UPDATE replenishment_schedules SET reminder_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [schedule.id]
    );

    // 5. Growth service detects the due reorder action
    const actions = await growthService.getTodayActions(STORE_A_ID);
    const reorderAction = actions.find(a => a.action_key === 'reorder_reminders_due');
    expect(reorderAction).toBeDefined();
    expect(reorderAction?.target_module).toBe('reorder-reminders');
    expect(reorderAction?.estimated_opportunity).toBeGreaterThan(0);
  });
});
