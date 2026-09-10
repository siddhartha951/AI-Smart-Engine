import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Phase 2: Live Visitor Pulse & Analytics Integration Tests', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let tokenStoreA: string;
  let tokenStoreB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    // Authenticate merchants
    const resA = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenStoreA = resA.body.token;

    const resB = await request(app).post('/api/v1/auth/login').send({ email: 'merchantB@store.com', password: 'password123' });
    tokenStoreB = resB.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  it('calculates active shoppers count within 5-minute window and filters out stale visitors', async () => {
    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000);
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // Create 2 visitors for Store A
    const v1 = '11111111-1111-1111-1111-111111111111';
    const v2 = '22222222-2222-2222-2222-222222222222';
    await db.query(`INSERT INTO visitors (id, store_id, anonymous_id, created_at) VALUES ($1, $2, 'anon1', NOW()), ($3, $2, 'anon2', NOW())`, [v1, STORE_A_ID, v2]);

    // Visitor 1 had an event 2 minutes ago (ACTIVE)
    await db.query(
      `INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES (gen_random_uuid(), $1, $2, 'heartbeat', '{}', $3)`,
      [STORE_A_ID, v1, twoMinAgo]
    );

    // Visitor 2 had an event 10 minutes ago (STALE - outside 5-min pulse window)
    await db.query(
      `INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES (gen_random_uuid(), $1, $2, 'page_view', '{"path":"/collections"}', $3)`,
      [STORE_A_ID, v2, tenMinAgo]
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/analytics/live`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.active_shoppers).toBe(1);
    expect(res.body.data.feed.length).toBe(2);
    expect(res.body.data.feed[0].type).toBe('heartbeat');
    expect(res.body.data.feed[0].label).toBe('Active Shopper');
  });

  it('aggregates conversion funnel stages and computes drop-off percentages correctly', async () => {
    const v1 = '11111111-1111-1111-1111-111111111111';
    const v2 = '22222222-2222-2222-2222-222222222222';
    const v3 = '33333333-3333-3333-3333-333333333333';
    await db.query(
      `INSERT INTO visitors (id, store_id, anonymous_id, created_at) 
       VALUES ($1, $2, 'anon1', NOW()), ($3, $2, 'anon2', NOW()), ($4, $2, 'anon3', NOW())`,
      [v1, STORE_A_ID, v2, v3]
    );

    // v1, v2, v3 visit store
    await db.query(`INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES 
      (gen_random_uuid(), $1, $2, 'page_view', '{}', NOW()),
      (gen_random_uuid(), $1, $3, 'page_view', '{}', NOW()),
      (gen_random_uuid(), $1, $4, 'page_view', '{}', NOW())`,
      [STORE_A_ID, v1, v2, v3]
    );

    // v1 and v2 open chat
    await db.query(`INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES 
      (gen_random_uuid(), $1, $2, 'widget_opened', '{}', NOW()),
      (gen_random_uuid(), $1, $3, 'widget_opened', '{}', NOW())`,
      [STORE_A_ID, v1, v2]
    );

    // v1 and v2 explore product
    await db.query(`INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES 
      (gen_random_uuid(), $1, $2, 'product_click', '{"title":"T-Shirt"}', NOW()),
      (gen_random_uuid(), $1, $3, 'product_click', '{"title":"Hoodie"}', NOW())`,
      [STORE_A_ID, v1, v2]
    );

    // v1 adds to cart
    await db.query(`INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES 
      (gen_random_uuid(), $1, $2, 'add_to_cart', '{"title":"T-Shirt","price":499}', NOW())`,
      [STORE_A_ID, v1]
    );

    // v1 completes purchase
    await db.query(`INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES 
      (gen_random_uuid(), $1, $2, 'purchase_completed', '{"order_id":"1001","total_price":499}', NOW())`,
      [STORE_A_ID, v1]
    );

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/analytics/funnel`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const funnel = res.body.data;
    expect(funnel.total_visitors).toBe(3);

    const stages = funnel.stages;
    expect(stages).toHaveLength(5);
    expect(stages[0].stage).toBe('Store Visitors');
    expect(stages[0].count).toBe(3);

    expect(stages[1].stage).toBe('AI Chats Initiated');
    expect(stages[1].count).toBe(2);

    expect(stages[2].stage).toBe('Products Explored');
    expect(stages[2].count).toBe(2);

    expect(stages[3].stage).toBe('Added to Cart');
    expect(stages[3].count).toBe(1);

    expect(stages[4].stage).toBe('Completed Purchases');
    expect(stages[4].count).toBe(1);

    // 1 purchase out of 3 visitors = 33.3%
    expect(funnel.overall_conversion_rate).toBe(33.3);
  });

  it('enforces strict multi-tenant isolation across live pulse and analytics', async () => {
    const vA = '11111111-1111-1111-1111-111111111111';
    const vB = '22222222-2222-2222-2222-222222222222';

    await db.query(`INSERT INTO visitors (id, store_id, anonymous_id, created_at) VALUES ($1, $2, 'anonA', NOW())`, [vA, STORE_A_ID]);
    await db.query(`INSERT INTO visitors (id, store_id, anonymous_id, created_at) VALUES ($1, $2, 'anonB', NOW())`, [vB, STORE_B_ID]);

    // Store A event
    await db.query(
      `INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES (gen_random_uuid(), $1, $2, 'product_click', '{"title":"Store A Special"}', NOW())`,
      [STORE_A_ID, vA]
    );

    // Store B event
    await db.query(
      `INSERT INTO events (id, store_id, visitor_id, type, payload, created_at) VALUES (gen_random_uuid(), $1, $2, 'product_click', '{"title":"Store B Special"}', NOW())`,
      [STORE_B_ID, vB]
    );

    // Store A feed check
    const resA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/analytics/live`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    expect(resA.status).toBe(200);
    expect(resA.body.data.feed.some((item: any) => item.detail.includes('Store B Special'))).toBe(false);
    expect(resA.body.data.feed.some((item: any) => item.detail.includes('Store A Special'))).toBe(true);

    // Merchant A cannot access Store B analytics
    const resForbidden = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/analytics/live`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    expect(resForbidden.status).toBe(403);
    expect(resForbidden.body.error).toBe('Forbidden: you cannot access this store');
  });
});
