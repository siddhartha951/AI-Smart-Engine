import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { getHomeMetrics, normalizeTzOffset, resolveWindows } from '../../src/modules/home/home-metrics';
import { EntitlementRepository } from '../../src/modules/entitlements/entitlement.repository';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('Home metrics (one window for every KPI)', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let token: string;
  // Fixed "now": 25 Sep 2026 18:00 IST = 12:30 UTC
  const now = new Date('2026-09-25T12:30:00.000Z');
  const IST = -330;

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

  async function visitor(storeId = STORE_A_ID, email: string | null = null, createdAt = now) {
    const res = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id, email, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [storeId, `anon_${Math.random().toString(36).slice(2)}`, email, createdAt.toISOString()]
    );
    return res.rows[0].id as string;
  }

  async function event(visitorId: string, type: string, at: Date, storeId = STORE_A_ID, payload: object = {}) {
    await db.query(
      `INSERT INTO events (store_id, visitor_id, type, payload, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [storeId, visitorId, type, JSON.stringify(payload), at.toISOString()]
    );
  }

  async function order(revenue: number, at: Date, ai = false, storeId = STORE_A_ID) {
    await db.query(
      `INSERT INTO order_attributions (store_id, order_id, order_revenue, order_created_at, is_ai_assisted)
       VALUES ($1, $2, $3, $4, $5)`,
      [storeId, `ord_${Math.random().toString(36).slice(2)}`, revenue, at.toISOString(), ai]
    );
  }

  it('builds today / 7 day windows from local midnight with a same-length previous window', () => {
    const { current, previous } = resolveWindows('today', IST, now);
    expect(current.from.toISOString()).toBe('2026-09-24T18:30:00.000Z'); // 25 Sep 00:00 IST
    expect(current.to.toISOString()).toBe(now.toISOString());
    expect(previous.from.toISOString()).toBe('2026-09-23T18:30:00.000Z');
    expect(previous.to.toISOString()).toBe('2026-09-24T12:30:00.000Z'); // yesterday, same time
    expect(current.fromDate).toBe('2026-09-25');

    const week = resolveWindows('7d', IST, now);
    expect(week.current.fromDate).toBe('2026-09-19');
    expect(week.previous.fromDate).toBe('2026-09-12');
    expect(normalizeTzOffset('abc')).toBe(0);
    expect(normalizeTzOffset(5000)).toBe(0);
    expect(normalizeTzOffset('-330')).toBe(-330);
  });

  it('counts revenue, orders, AI sales, conversion and ROAS from the same window', async () => {
    const v1 = await visitor();
    const v2 = await visitor();
    const v3 = await visitor(STORE_A_ID, 'lead@x.com');
    // Current 7 days
    await event(v1, 'page_view', new Date(now.getTime() - 2 * HOUR));
    await event(v2, 'page_view', new Date(now.getTime() - 3 * HOUR));
    await event(v3, 'page_view', new Date(now.getTime() - 1 * DAY));
    await event(v1, 'add_to_cart', new Date(now.getTime() - 2 * HOUR));
    await event(v1, 'purchase_completed', new Date(now.getTime() - HOUR));
    await order(1000, new Date(now.getTime() - HOUR), true);
    await order(500, new Date(now.getTime() - 2 * DAY));
    await db.query(`INSERT INTO ad_spend (store_id, spend_date, platform, spend_amount) VALUES ($1, '2026-09-24', 'meta', 300)`, [STORE_A_ID]);
    // Previous 7 days
    await order(750, new Date(now.getTime() - 9 * DAY));
    await db.query(`INSERT INTO ad_spend (store_id, spend_date, platform, spend_amount) VALUES ($1, '2026-09-15', 'meta', 250)`, [STORE_A_ID]);
    // Older than both windows and another store: must be ignored
    await order(9999, new Date(now.getTime() - 40 * DAY));
    await order(8888, new Date(now.getTime() - HOUR), false, STORE_B_ID);

    const m = await getHomeMetrics(db, STORE_A_ID, '7d', IST, now);
    expect(m.revenue_source).toBe('orders');
    expect(m.kpis.revenue).toEqual({ value: 1500, previous: 750, change_pct: 100 });
    expect(m.kpis.orders.value).toBe(2);
    expect(m.kpis.average_order_value.value).toBe(750);
    expect(m.kpis.ai_assisted_revenue.value).toBe(1000);
    expect(m.kpis.ad_spend.value).toBe(300);
    expect(m.kpis.roas.value).toBe(5); // 1500 / 300
    expect(m.kpis.roas.previous).toBe(3); // 750 / 250
    expect(m.activity.visitors.value).toBe(3);
    expect(m.kpis.conversion_rate.value).toBeCloseTo(33.33, 1);
    expect(m.activity.add_to_carts.value).toBe(1);
    expect(m.activity.new_leads.value).toBe(1);

    const today = await getHomeMetrics(db, STORE_A_ID, 'today', IST, now);
    expect(today.kpis.revenue.value).toBe(1000);
    expect(today.kpis.orders.value).toBe(1);
    expect(today.kpis.roas.value).toBeNull(); // no spend recorded today
    expect(today.has_ad_spend_history).toBe(true);
  });

  it('falls back to storefront purchase events when no orders are synced', async () => {
    const v = await visitor(STORE_B_ID);
    await event(v, 'purchase_completed', new Date(now.getTime() - HOUR), STORE_B_ID, { total_price: '420.50' });
    const m = await getHomeMetrics(db, STORE_B_ID, '7d', IST, now);
    expect(m.revenue_source).toBe('storefront_events');
    expect(m.kpis.revenue.value).toBe(420.5);
    expect(m.kpis.orders.value).toBe(1);
    expect(m.kpis.revenue.change_pct).toBeNull();
  });

  it('an empty store returns zeros, never NaN', async () => {
    const m = await getHomeMetrics(db, STORE_B_ID, '30d', 0, now);
    const values = [
      ...Object.values(m.kpis).map((k: any) => k.value),
      ...Object.values(m.activity).map((k: any) => k.value),
    ];
    for (const v of values) expect(v === null || Number.isFinite(v)).toBe(true);
    expect(m.kpis.roas.value).toBeNull();
  });

  it('API: validates range, enforces store access and the overview feature', async () => {
    const ok = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/home?range=bogus&tz=-330`).set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.range).toBe('7d');

    const other = await request(app).get(`/api/v1/dashboard/${STORE_B_ID}/home`).set('Authorization', `Bearer ${token}`);
    expect(other.status).toBe(403);

    await new EntitlementRepository(db).setFeatureEntitlement(STORE_A_ID, 'overview', false);
    const blocked = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/home`).set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('FEATURE_DISABLED');
  });

  it('Growth Copilot overview works on a store with sent recovery emails (regression: extra SQL parameter)', async () => {
    const v = await visitor();
    await db.query(
      `INSERT INTO email_campaign_events (store_id, visitor_id, campaign_type, stage, scheduled_for, sent_at, status)
       VALUES ($1, $2, 'abandoned_cart', 1, $3, $3, 'sent')`,
      [STORE_A_ID, v, new Date(now.getTime() - DAY).toISOString()]
    );
    const res = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/growth/overview`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email_recovery.jobs_sent).toBeGreaterThanOrEqual(1);
  });
});
