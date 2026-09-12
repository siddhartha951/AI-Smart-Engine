import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { AttributionService } from '../../src/modules/attribution/attribution.service';
import { WebhookService } from '../../src/modules/events/webhook.service';

describe('Phase 15: Multi-Touch Ad Intelligence & Attribution Engine', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let attributionService: AttributionService;
  let webhookService: WebhookService;

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
    attributionService = new AttributionService({ db });
    webhookService = new WebhookService();

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

  // 1. UTM capture
  it('1. captures and persists all 5 UTM parameters via touchpoint API', async () => {
    // Create visitor
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-utm-1', 'shopper1@test.com']
    );
    const visitorId = vis.rows[0].id;

    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: visitorId,
        source: 'facebook',
        medium: 'paid_social',
        campaign: 'summer_boost_2026',
        content: 'video_hook_a',
        term: 'organic apparel',
        landing_page_url: 'https://london-eco.myshopify.com/products/organic-tee',
        referrer_url: 'https://facebook.com',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.source).toBe('facebook');
    expect(res.body.data.medium).toBe('paid_social');
    expect(res.body.data.campaign).toBe('summer_boost_2026');
    expect(res.body.data.content).toBe('video_hook_a');
    expect(res.body.data.term).toBe('organic apparel');
  });

  // 2. fbclid capture
  it('2. captures fbclid click ID and auto-resolves to facebook / paid_social', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-fbclid-1']
    );
    const visitorId = vis.rows[0].id;

    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: visitorId,
        fbclid: 'IwAR1234567890MetaClickId',
        campaign: 'fb_retargeting_v1',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.fbclid).toBe('IwAR1234567890MetaClickId');
    expect(res.body.data.source).toBe('facebook');
    expect(res.body.data.medium).toBe('paid_social');
  });

  // 3. gclid capture
  it('3. captures gclid click ID and auto-resolves to google / cpc', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-gclid-1']
    );
    const visitorId = vis.rows[0].id;

    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: visitorId,
        gclid: 'Cj0KCQjwGoogleAdClickId123',
        campaign: 'google_search_brand',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.gclid).toBe('Cj0KCQjwGoogleAdClickId123');
    expect(res.body.data.source).toBe('google');
    expect(res.body.data.medium).toBe('cpc');
  });

  // 4. ttclid capture
  it('4. captures ttclid click ID and auto-resolves to tiktok / paid_social', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-ttclid-1']
    );
    const visitorId = vis.rows[0].id;

    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: visitorId,
        ttclid: 'ttclid_tiktok_ad_click_999',
        campaign: 'tiktok_spark_ads',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.ttclid).toBe('ttclid_tiktok_ad_click_999');
    expect(res.body.data.source).toBe('tiktok');
    expect(res.body.data.medium).toBe('paid_social');
  });

  // 5. multiple touchpoints
  it('5. preserves full chronological touchpoint history across multiple ad visits', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-multi-tp']
    );
    const visitorId = vis.rows[0].id;

    const t1 = new Date(Date.now() - 3600000 * 48); // 2 days ago
    const t2 = new Date(Date.now() - 3600000 * 24); // 1 day ago
    const t3 = new Date(Date.now() - 3600000 * 2);  // 2 hours ago

    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'facebook',
      campaign: 'camp_meta_top_of_funnel',
      createdAt: t1,
    });
    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'google',
      campaign: 'camp_google_retargeting',
      createdAt: t2,
    });
    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'email',
      campaign: 'camp_cart_recovery',
      createdAt: t3,
    });

    const touchpoints = await attributionService['repo'].getVisitorTouchpoints(STORE_A_ID, visitorId);
    expect(touchpoints.length).toBe(3);
    expect(touchpoints[0].source).toBe('facebook');
    expect(touchpoints[1].source).toBe('google');
    expect(touchpoints[2].source).toBe('email');
  });

  // 6. first-touch attribution
  it('6. deterministically calculates first-touch attribution assigning 100% credit to earliest touchpoint', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-first-touch']
    );
    const visitorId = vis.rows[0].id;

    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'tiktok',
      campaign: 'viral_spark_hook',
      createdAt: new Date(Date.now() - 3600000 * 24),
    });
    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'facebook',
      campaign: 'fb_retargeting',
      createdAt: new Date(Date.now() - 3600000 * 2),
    });

    const attr = await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_101',
      order_number: '1001',
      total_price: '100.00',
      currency: 'GBP',
      created_at: new Date(),
    }, visitorId);

    expect(attr.first_touch_source).toBe('tiktok');
    expect(attr.first_touch_campaign).toBe('viral_spark_hook');
    expect(attr.order_revenue).toBe(100.00);
  });

  // 7. last-touch attribution
  it('7. deterministically calculates last-touch attribution assigning 100% credit to latest touchpoint', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-last-touch']
    );
    const visitorId = vis.rows[0].id;

    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'tiktok',
      campaign: 'viral_spark_hook',
      createdAt: new Date(Date.now() - 3600000 * 24),
    });
    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'google',
      campaign: 'google_search_closing',
      createdAt: new Date(Date.now() - 3600000 * 1),
    });

    const attr = await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_102',
      order_number: '1002',
      total_price: '80.00',
      currency: 'GBP',
      created_at: new Date(),
    }, visitorId);

    expect(attr.last_touch_source).toBe('google');
    expect(attr.last_touch_campaign).toBe('google_search_closing');
    expect(attr.order_revenue).toBe(80.00);
  });

  // 8. linear attribution
  it('8. deterministically splits revenue evenly (1/N) across all touchpoints for linear attribution', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-linear-touch']
    );
    const visitorId = vis.rows[0].id;

    // 4 touchpoints
    await attributionService.recordTouchpoint(STORE_A_ID, { visitorId, source: 'facebook', campaign: 'c1', createdAt: new Date(Date.now() - 40000) });
    await attributionService.recordTouchpoint(STORE_A_ID, { visitorId, source: 'google', campaign: 'c2', createdAt: new Date(Date.now() - 30000) });
    await attributionService.recordTouchpoint(STORE_A_ID, { visitorId, source: 'tiktok', campaign: 'c3', createdAt: new Date(Date.now() - 20000) });
    await attributionService.recordTouchpoint(STORE_A_ID, { visitorId, source: 'email', campaign: 'c4', createdAt: new Date(Date.now() - 10000) });

    const attr = await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_103',
      order_number: '1003',
      total_price: '120.00',
      currency: 'GBP',
      created_at: new Date(),
    }, visitorId);

    expect(attr.touchpoint_count).toBe(4);

    const splits = await db.query(
      `SELECT * FROM order_attribution_touchpoints WHERE store_id = $1 AND order_id = $2 ORDER BY created_at ASC`,
      [STORE_A_ID, 'order_103']
    );
    expect(splits.rows.length).toBe(4);
    for (const split of splits.rows) {
      expect(Number(split.weight)).toBeCloseTo(0.25, 2);
      expect(Number(split.attributed_revenue)).toBe(30.00); // 120 / 4 = 30.00
    }
  });

  // 9. order matching
  it('9. matches Shopify order webhook to marketing touchpoints and computes attribution', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-order-match', 'matchedshopper@test.com']
    );
    const visitorId = vis.rows[0].id;

    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'facebook',
      campaign: 'spring_launch',
      createdAt: new Date(Date.now() - 10000),
    });

    // Ingest Shopify webhook
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 99001,
      order_number: '99001',
      total_price: '150.00',
      currency: 'GBP',
      email: 'matchedshopper@test.com',
      created_at: new Date().toISOString(),
      line_items: [{ product_id: 'prod_1', title: 'Jacket', price: '150.00', quantity: 1 }],
    });

    const attr = await attributionService['repo'].getOrderAttribution(STORE_A_ID, '99001');
    expect(attr).not.toBeNull();
    expect(attr!.order_revenue).toBe(150.00);
    expect(attr!.last_touch_source).toBe('facebook');
    expect(attr!.last_touch_campaign).toBe('spring_launch');
  });

  // 10. duplicate order webhook
  it('10. handles duplicate webhook deliveries idempotently without double-counting revenue', async () => {
    await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-dup-wh', 'dupwh@test.com']
    );

    const orderPayload = {
      id: 99002,
      order_number: '99002',
      total_price: '75.00',
      currency: 'GBP',
      email: 'dupwh@test.com',
      created_at: new Date().toISOString(),
    };

    // First delivery
    await webhookService.processOrderWebhook('london-eco.myshopify.com', orderPayload);
    // Duplicate delivery
    await webhookService.processOrderWebhook('london-eco.myshopify.com', orderPayload);

    const attrRes = await db.query(
      `SELECT COUNT(*) as count FROM order_attributions WHERE store_id = $1 AND order_id = $2`,
      [STORE_A_ID, '99002']
    );
    expect(parseInt(attrRes.rows[0].count, 10)).toBe(1);
  });

  // 11. anonymous visitor resolution
  it('11. links anonymous visitor touchpoints when identified later at checkout', async () => {
    // Visitor lands anonymously
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-later-identified']
    );
    const visitorId = vis.rows[0].id;

    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId,
      source: 'tiktok',
      campaign: 'anon_viral_campaign',
      createdAt: new Date(Date.now() - 5000),
    });

    // Customer provides email at checkout with ai_vid note attribute
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 99003,
      order_number: '99003',
      total_price: '45.00',
      currency: 'GBP',
      email: 'now_identified@test.com',
      note_attributes: [{ name: '_ai_visitor_id', value: visitorId }],
      created_at: new Date().toISOString(),
    });

    const attr = await attributionService['repo'].getOrderAttribution(STORE_A_ID, '99003');
    expect(attr).not.toBeNull();
    expect(attr!.visitor_id).toBe(visitorId);
    expect(attr!.first_touch_source).toBe('tiktok');
    expect(attr!.first_touch_campaign).toBe('anon_viral_campaign');
  });

  // 12. repeat purchase
  it('12. handles repeat purchases independently with distinct order attributions', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-repeat-purchaser', 'repeat@test.com']
    );
    const visitorId = vis.rows[0].id;

    // First purchase
    await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_rep_1',
      order_number: '101',
      total_price: '50.00',
      currency: 'GBP',
      created_at: new Date(Date.now() - 86400000),
    }, visitorId);

    // Second purchase
    await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_rep_2',
      order_number: '102',
      total_price: '90.00',
      currency: 'GBP',
      created_at: new Date(),
    }, visitorId);

    const attr1 = await attributionService['repo'].getOrderAttribution(STORE_A_ID, 'order_rep_1');
    const attr2 = await attributionService['repo'].getOrderAttribution(STORE_A_ID, 'order_rep_2');

    expect(attr1!.order_revenue).toBe(50.00);
    expect(attr2!.order_revenue).toBe(90.00);
  });

  // 13. AI-assisted revenue
  it('13. detects deterministic AI-assisted revenue when customer interacted with assistant or recommended products', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email) VALUES ($1, $2, $3) RETURNING id`,
      [STORE_A_ID, 'anon-ai-shopper', 'aishopper@test.com']
    );
    const visitorId = vis.rows[0].id;

    // Create chat session & recommendations
    const session = await db.query(
      `INSERT INTO chat_sessions (store_id, visitor_id, started_at) VALUES ($1, $2, NOW()) RETURNING id`,
      [STORE_A_ID, visitorId]
    );
    const sessionId = session.rows[0].id;

    await db.query(
      `INSERT INTO recommendations (store_id, session_id, product_id, variant_id, title, price, reason)
       VALUES ($1, $2, 'prod_serum_30', 'var_serum_01', 'Face Serum', 35.00, 'Recommended for hydration')`,
      [STORE_A_ID, sessionId]
    );

    // Purchase includes recommended product
    const attr = await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_ai_101',
      order_number: '2001',
      total_price: '35.00',
      currency: 'GBP',
      created_at: new Date(),
      line_items: [
        { product_id: 'prod_serum_30', variant_id: 'var_serum_01', title: 'Face Serum', price: '35.00', quantity: 1 }
      ]
    }, visitorId, sessionId);

    expect(attr.is_ai_assisted).toBe(true);
    expect(attr.ai_assisted_revenue).toBe(35.00);
    expect(attr.matched_recommendation_ids.length).toBeGreaterThan(0);
  });

  // 14. ad spend creation
  it('14. allows merchant to create and retrieve manual ad spend records', async () => {
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/attribution/spend`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        spendDate: '2026-09-10',
        platform: 'facebook',
        campaign: 'meta_advantage_plus',
        spendAmount: 250.00,
        currency: 'GBP',
        notes: 'Advantage+ Shopping campaign',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.platform).toBe('facebook');
    expect(Number(res.body.data.spend_amount)).toBe(250.00);

    const listRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/attribution/spend`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.spend.length).toBeGreaterThan(0);
  });

  // 15. zero-spend ROAS
  it('15. safely handles zero ad spend returning 0.00x ROAS without division by zero', async () => {
    const overview = await attributionService.getOverview(STORE_A_ID, 'last_touch');
    expect(overview.total_spend).toBe(0);
    expect(overview.roas).toBe(0.0);
    expect(isNaN(overview.roas)).toBe(false);
    expect(isFinite(overview.roas)).toBe(true);
  });

  // 16. campaign ROAS
  it('16. calculates campaign-level ROAS accurately (Attributed Revenue / Spend)', async () => {
    // Record spend for campaign: £100
    await attributionService.createAdSpend(STORE_A_ID, {
      spendDate: '2026-09-11',
      platform: 'google',
      campaign: 'google_summer_sale',
      spendAmount: 100.00,
    });

    // Record order attributed to this campaign: £350
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-camp-roas']
    );
    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId: vis.rows[0].id,
      source: 'google',
      campaign: 'google_summer_sale',
    });
    await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_camp_roas',
      order_number: '3001',
      total_price: '350.00',
      currency: 'GBP',
      created_at: new Date(),
    }, vis.rows[0].id);

    const campaigns = await attributionService.getCampaignPerformance(STORE_A_ID, 'last_touch');
    const targetCamp = campaigns.find(c => c.campaign === 'google_summer_sale');

    expect(targetCamp).toBeDefined();
    expect(targetCamp!.spend).toBe(100.00);
    expect(targetCamp!.attributed_revenue).toBe(350.00);
    expect(targetCamp!.roas).toBe(3.5); // 350 / 100 = 3.5x
  });

  // 17. channel ROAS
  it('17. calculates channel-level ROAS accurately across traffic sources', async () => {
    // Record spend for Meta: £200
    await attributionService.createAdSpend(STORE_A_ID, {
      spendDate: '2026-09-12',
      platform: 'facebook',
      campaign: 'meta_prospecting',
      spendAmount: 200.00,
    });

    // Record order attributed to Meta: £600
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-chan-roas']
    );
    await attributionService.recordTouchpoint(STORE_A_ID, {
      visitorId: vis.rows[0].id,
      source: 'facebook',
      campaign: 'meta_prospecting',
    });
    await attributionService.processOrderAttribution(STORE_A_ID, {
      id: 'order_chan_roas',
      order_number: '3002',
      total_price: '600.00',
      currency: 'GBP',
      created_at: new Date(),
    }, vis.rows[0].id);

    const channels = await attributionService.getChannelPerformance(STORE_A_ID, 'last_touch');
    const fbChannel = channels.find(c => c.channel === 'facebook');

    expect(fbChannel).toBeDefined();
    expect(fbChannel!.spend).toBe(200.00);
    expect(fbChannel!.attributed_revenue).toBe(600.00);
    expect(fbChannel!.roas).toBe(3.0); // 600 / 200 = 3.0x
  });

  // 18. cross-tenant isolation
  it('18. strictly prevents Merchant A from viewing or mutating Merchant B ad spend or touchpoints', async () => {
    // Store B creates ad spend
    const spendB = await attributionService.createAdSpend(STORE_B_ID, {
      spendDate: '2026-09-12',
      platform: 'tiktok',
      campaign: 'highland_mountains',
      spendAmount: 500.00,
    });

    // Merchant B can access Store B's spend endpoint -> 200 OK
    const validStoreBAccess = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/attribution/spend`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(validStoreBAccess.status).toBe(200);

    // Merchant A attempts to access Store B's spend endpoint -> 403 Forbidden
    const crossAccessRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/attribution/spend`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossAccessRes.status).toBe(403);

    // Merchant A attempts to delete Store B's spend record -> 403 Forbidden
    const deleteCrossRes = await request(app)
      .delete(`/api/v1/dashboard/${STORE_B_ID}/attribution/spend/${spendB.id}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(deleteCrossRes.status).toBe(403);

    // Store A query should not leak Store B spend
    const storeASpend = await attributionService.listAdSpend(STORE_A_ID);
    const leaked = storeASpend.spend.find(s => s.id === spendB.id);
    expect(leaked).toBeUndefined();
  });

  // 19. unauthorized dashboard access
  it('19. rejects unauthorized or unauthenticated requests to attribution dashboard endpoints', async () => {
    const unauthRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/attribution/overview`);
    expect(unauthRes.status).toBe(401);

    const invalidTokenRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/attribution/overview`)
      .set('Authorization', 'Bearer invalid-token-xyz');
    expect(invalidTokenRes.status).toBe(401);
  });

  // 20. duplicate attribution prevention
  it('20. strictly prevents duplicate attribution creation when identical order is processed repeatedly', async () => {
    const vis = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, $2) RETURNING id`,
      [STORE_A_ID, 'anon-idempotent-order']
    );

    const orderData = {
      id: 'order_dedup_unique_1',
      order_number: '8888',
      total_price: '110.00',
      currency: 'GBP',
      created_at: new Date(),
    };

    const firstResult = await attributionService.processOrderAttribution(STORE_A_ID, orderData, vis.rows[0].id);
    const secondResult = await attributionService.processOrderAttribution(STORE_A_ID, orderData, vis.rows[0].id);

    expect(firstResult.id).toBe(secondResult.id);

    const allAttrs = await db.query(
      `SELECT COUNT(*) as count FROM order_attributions WHERE store_id = $1 AND order_id = $2`,
      [STORE_A_ID, 'order_dedup_unique_1']
    );
    expect(parseInt(allAttrs.rows[0].count, 10)).toBe(1);
  });
});
