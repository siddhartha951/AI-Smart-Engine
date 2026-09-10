import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Phase 7.1: Dashboard and Auth', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let tokenAdmin: string;
  let tokenStoreA: string;
  let tokenStoreB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    // Authenticate users
    const resAdmin = await request(app).post('/api/v1/auth/login').send({ email: 'admin@platform.com', password: 'password123' });
    tokenAdmin = resAdmin.body.token;

    const resA = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenStoreA = resA.body.token;

    const resB = await request(app).post('/api/v1/auth/login').send({ email: 'merchantB@store.com', password: 'password123' });
    tokenStoreB = resB.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  it('Merchant A can access their own overview', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/overview`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('chats');
  });

  it('Merchant A is denied access to Store B overview', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/overview`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: you cannot access this store');
  });

  it('Admin can access Store B overview', async () => {
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/overview`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Regenerating widget key updates the key and invalidates the old one', async () => {
    // 1. Get original widget key
    const getRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/widget`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    const oldKey = getRes.body.data.widget_key;

    // 2. Validate session creation with old key works
    let sessRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', oldKey)
      .send({ anonymous_id: 'visitor_1' });
    expect(sessRes.status).toBe(201);

    // 3. Regenerate key
    const regenRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/widget/regenerate-key`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    expect(regenRes.status).toBe(200);
    const newKey = regenRes.body.data.widget_key;
    expect(newKey).not.toBe(oldKey);

    // 4. Validate session creation with old key now fails
    sessRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', oldKey)
      .send({ anonymous_id: 'visitor_2' });
    expect(sessRes.status).toBe(401);
    expect(sessRes.body.error).toBe('Unauthorized store or disabled assistant');

    // 5. Validate session creation with new key works
    sessRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', newKey)
      .send({ anonymous_id: 'visitor_3' });
    expect(sessRes.status).toBe(201);
  });

  it('Widget session is rejected if assistant is disabled', async () => {
    // 1. Disable assistant
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${tokenStoreA}`)
      .send({ assistant: { is_active: false } });

    // 2. Get current key
    const getRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/widget`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    const key = getRes.body.data.widget_key;

    // 3. Attempt session creation
    const sessRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', key)
      .send({ anonymous_id: 'visitor_x' });
    
    expect(sessRes.status).toBe(401);
    expect(sessRes.body.error).toBe('Unauthorized store or disabled assistant');
  });

  it('PUT /agent updates assistant settings', async () => {
    const res = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${tokenStoreA}`)
      .send({
        assistant: { tone: 'professional and concise' },
        policies: { faq_content: 'No returns allowed.' }
      });
    expect(res.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${tokenStoreA}`);
    
    expect(getRes.body.data.assistant.tone).toBe('professional and concise');
    expect(getRes.body.data.policies.faq_content).toBe('No returns allowed.');
  });
});
