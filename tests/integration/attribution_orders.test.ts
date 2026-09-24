import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { EntitlementRepository } from '../../src/modules/entitlements/entitlement.repository';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Attributed orders list (Ads → Attribution table)', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let token: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    token = (await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' })).body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  async function order(storeId: string, orderId: string, revenue: number, at: string, ai = false) {
    await db.query(
      `INSERT INTO order_attributions (store_id, order_id, order_number, order_revenue, currency,
         first_touch_source, first_touch_campaign, last_touch_source, touchpoint_count, is_ai_assisted, order_created_at)
       VALUES ($1, $2, $3, $4, 'INR', 'facebook', 'itch_relief', 'widget', 3, $5, $6)`,
      [storeId, orderId, orderId.replace('ord-', ''), revenue, ai, at]
    );
  }

  it('lists the store\'s own orders, newest first, with a limit', async () => {
    await order(STORE_A_ID, 'ord-1001', 499, '2026-09-20T10:00:00Z');
    await order(STORE_A_ID, 'ord-1002', 999, '2026-09-22T10:00:00Z', true);
    await order(STORE_B_ID, 'ord-9001', 5000, '2026-09-23T10:00:00Z');

    const res = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/attribution/orders?limit=1`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.orders).toHaveLength(1);
    expect(res.body.data.orders[0]).toMatchObject({
      order_id: 'ord-1002', order_number: '1002', revenue: 999, first_touch: 'facebook',
      first_touch_campaign: 'itch_relief', last_touch: 'widget', is_ai_assisted: true, touchpoints: 3,
    });

    const all = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/attribution/orders?limit=abc`).set('Authorization', `Bearer ${token}`);
    expect(all.body.data.orders.map((o: any) => o.order_id)).toEqual(['ord-1002', 'ord-1001']);
  });

  it('is blocked for another store and when attribution is not in the plan', async () => {
    const other = await request(app).get(`/api/v1/dashboard/${STORE_B_ID}/attribution/orders`).set('Authorization', `Bearer ${token}`);
    expect(other.status).toBe(403);

    await new EntitlementRepository(db).setFeatureEntitlement(STORE_A_ID, 'ad_intelligence', false);
    const blocked = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/attribution/orders`).set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('FEATURE_DISABLED');
  });
});
