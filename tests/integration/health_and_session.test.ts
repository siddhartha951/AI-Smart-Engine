import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Health Check & Widget Session Scaffolding', () => {
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

    app = createApp({ db });
  });

  afterEach(async () => {
    await db.close();
  });

  it('GET /health returns 200 and healthy database status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
    expect(res.body.uptime).toBeTypeOf('number');
  });

  it('rejects widget requests without a widget_key', async () => {
    const res = await request(app).get('/api/v1/widget/config');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects widget requests with a non-existent widget_key', async () => {
    const res = await request(app)
      .get('/api/v1/widget/config')
      .set('x-widget-key', '99999999-9999-9999-9999-999999999999');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('GET /api/v1/widget/config returns public configuration for Store A without secrets', async () => {
    const res = await request(app)
      .get(`/api/v1/widget/config?widget_key=${STORE_A_WIDGET_KEY}`)
      .set('Origin', 'https://london-eco.myshopify.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.brand_name).toBe('London Eco Apparel');
    expect(res.body.data.widget.button_text).toBe('Ask Eco Stylist');
    expect(res.body.data.assistant.assistant_name).toBe('EcoStylist AI');

    // Verify no secret tokens leaked
    expect(res.body.data.encrypted_admin_token).toBeUndefined();
    expect(res.body.data.encrypted_storefront_token).toBeUndefined();
    expect(res.text).not.toContain('enc_mock_admin_token');
  });

  it('GET /api/v1/widget/config returns distinct configuration for Store B', async () => {
    const res = await request(app)
      .get(`/api/v1/widget/config?widget_key=${STORE_B_WIDGET_KEY}`)
      .set('Origin', 'https://highland-peak.myshopify.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.brand_name).toBe('Highland Peak Gear');
    expect(res.body.data.widget.button_text).toBe('Ask Mountain Guide');
    expect(res.body.data.assistant.assistant_name).toBe('PeakGuide AI');
  });

  it('rejects requests from unauthorized origin domain with 403 Forbidden', async () => {
    // Note: In test/dev environment, origin check allows localhost. Test with an unauthorized external domain:
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app)
        .get(`/api/v1/widget/config?widget_key=${STORE_A_WIDGET_KEY}`)
        .set('Origin', 'https://malicious-competitor.com');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('POST /api/v1/widget/session creates a new visitor and active chat session', async () => {
    const res = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ anonymous_id: 'visitor_browser_cookie_123' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.store_id).toBe(STORE_A_ID);
    expect(res.body.data.visitor_id).toBeDefined();
    expect(res.body.data.session_id).toBeDefined();
    expect(res.body.data.status).toBe('active');
  });

  it('POST /api/v1/widget/session rejects request missing anonymous_id', async () => {
    const res = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
