import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';

describe('Phase 7: Dashboard Auth & Tenant Isolation', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();
    
    app = createApp({ db });
  });

  afterEach(async () => {
    await db.close();
  });

  it('rejects login with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@platform.com', password: 'wrongpassword' });
    
    expect(res.status).toBe(401);
  });

  it('authenticates admin and allows cross-store access', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@platform.com', password: 'password123' });
    
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token;

    // Admin accessing Store A
    const resA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/overview`)
      .set('Authorization', `Bearer ${token}`);
    expect(resA.status).toBe(200);

    // Admin accessing Store B
    const resB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/overview`)
      .set('Authorization', `Bearer ${token}`);
    expect(resB.status).toBe(200);
  });

  it('authenticates merchant owner and enforces strict store isolation', async () => {
    // Login as Merchant A
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token;

    // Merchant A accessing their own Store A
    const resA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/overview`)
      .set('Authorization', `Bearer ${token}`);
    expect(resA.status).toBe(200);

    // Merchant A attempting to access Store B
    const resB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/overview`)
      .set('Authorization', `Bearer ${token}`);
    expect(resB.status).toBe(403);
    expect(resB.body.error).toContain('Forbidden');
  });

  it('logs sensitive settings updates via audit logs', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    
    const token = loginRes.body.token;

    const res = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        widget: {
          button_text: 'New Button Text',
          primary_colour: '#ff0000',
          secondary_colour: '#000000'
        }
      });
    
    expect(res.status).toBe(200);

    // Verify audit log creation
    const logsRes = await db.query('SELECT * FROM audit_logs WHERE store_id = $1', [STORE_A_ID]);
    expect(logsRes.rows.length).toBeGreaterThan(0);
    expect(logsRes.rows[0].action).toBe('UPDATE_WIDGET_SETTINGS');
    expect(logsRes.rows[0].new_state.button_text).toBe('New Button Text');
  });
});
