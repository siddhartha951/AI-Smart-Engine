import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Phase 4: AI Chat and Recommendations', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const STORE_B_WIDGET_KEY = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    const migrator = new Migrator(db);
    await migrator.runMigrations();
    // These tests cover immediate recommendations; "Ask first" (the default) has its own suite
    await db.query(`UPDATE assistant_settings SET product_suggestion_mode = 'direct'`);

    app = createApp({ db });
  });

  afterEach(async () => {
    await db.close();
  });

  async function createSession(storeId: string, anonymousId: string) {
    const res = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', storeId)
      .send({ anonymous_id: anonymousId });
    return res.body.data;
  }

  it('POST /api/v1/widget/chat/message processes message and returns mock AI response', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_chat_1');

    const res = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        session_id: session.session_id,
        message: 'I am looking for some audio gear'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // The Mock AI Provider looks for matching categories
    expect(res.body.data.message).toContain('I found some great options for you');
    expect(res.body.data.recommendations).toBeInstanceOf(Array);
    expect(res.body.data.recommendations.length).toBeGreaterThan(0);
    expect(res.body.data.recommendations[0].title).toBe('Wireless Earbuds');
  });

  it('POST /api/v1/widget/chat/message filters catalog by budget intent', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_chat_2');

    const res = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        session_id: session.session_id,
        message: 'I want audio under $60'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Wireless Earbuds are $49.99, Smart Watch is $129.99. 
    // It should only recommend the Earbuds since the budget is $60.
    const recs = res.body.data.recommendations;
    expect(recs.some((r: any) => r.title === 'Wireless Earbuds')).toBe(true);
    expect(recs.some((r: any) => r.title === 'Smart Watch')).toBe(false);
  });

  it('POST /api/v1/widget/chat/message rejects requests across store boundaries', async () => {
    // Session created in Store A
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_chat_3');

    // Attempt to message that session from Store B
    const res = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_B_WIDGET_KEY) 
      .send({
        session_id: session.session_id,
        message: 'Hello'
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_ISOLATION_VIOLATION');
  });

  it('POST /api/v1/widget/chat/message enforces hard budget limits for AI', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_chat_4');

    // Fake a high usage in the ledger to trip the BudgetGuard limit ($14.00)
    const period = new Date().toISOString().substring(0, 7);
    await db.query(
      `INSERT INTO ai_usage_ledger (store_id, session_id, model, input_tokens, output_tokens, estimated_cost_usd, billing_period)
       VALUES ($1, $2, 'gpt-4', 1000000, 1000000, 15.00, $3)`,
      [STORE_A_ID, session.session_id, period]
    );

    const res = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        session_id: session.session_id,
        message: 'Hello'
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BUDGET_EXCEEDED');
  });
});
