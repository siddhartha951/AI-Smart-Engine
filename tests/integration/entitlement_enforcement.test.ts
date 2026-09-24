import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { EntitlementRepository } from '../../src/modules/entitlements/entitlement.repository';
import { FeatureKey } from '../../src/modules/entitlements/entitlement.types';
import { getAllowedAgentTools, executeAgentTool } from '../../src/modules/ai_agent/ai_agent.tools';
import { MockAiProvider } from '../../src/providers/ai/mock.ai.provider';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';

describe('Strict entitlement enforcement', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let token: string;
  let entitlements: EntitlementRepository;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    entitlements = new EntitlementRepository(db);
    token = (await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' })).body.token;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  const expectDisabled = (res: any) => {
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    expect(res.body.message).toBe('This feature is currently not enabled for your store. Please contact your administrator to activate it.');
  };

  it('blocks every WhatsApp route (not just GET config) when WhatsApp is disabled', async () => {
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.WHATSAPP, false);
    const auth = { Authorization: `Bearer ${token}` };
    expectDisabled(await request(app).put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`).set(auth).send({}));
    expectDisabled(await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/conversations`).set(auth));
    expectDisabled(await request(app).post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/schedule`).set(auth).send({}));
  });

  it('blocks ad-creative writes, email settings, leads export and Ads Explorer when disabled', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.AD_CREATIVE, false);
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.EMAIL_AUTOMATION, false);
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.LEADS, false);
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.ADS_EXPLORER, false);

    expectDisabled(await request(app).post(`/api/v1/dashboard/${STORE_A_ID}/ad-creatives/generate`).set(auth).send({}));
    expectDisabled(await request(app).put(`/api/v1/dashboard/${STORE_A_ID}/email`).set(auth).send({}));
    expectDisabled(await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/email/sender-status`).set(auth));
    expectDisabled(await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/leads/export`).set(auth));
    expectDisabled(await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/meta-ads/explorer/ads`).set(auth));
  });

  it('leaves enabled features untouched', async () => {
    const res = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/email/sender-status`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('merchant AI agent is never offered tools for disabled modules', async () => {
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.META_ADS, false);
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.AD_INTELLIGENCE, false);
    const names = (await getAllowedAgentTools(STORE_A_ID)).map(t => t.name);
    expect(names).not.toContain('get_meta_performance');
    expect(names).not.toContain('get_attribution_summary');
    expect(names).toContain('get_shopify_summary');

    // Even a forced call is refused with an honest note instead of data
    const result = await executeAgentTool(STORE_A_ID, 'get_meta_performance', {});
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/not enabled/);
  });

  it('widget hides tickets and never escalates when support tickets are disabled', async () => {
    await entitlements.setFeatureEntitlement(STORE_A_ID, FeatureKey.SUPPORT_TICKETS, false);
    const config = await request(app).get('/api/v1/widget/config').set('x-widget-key', STORE_A_WIDGET_KEY);
    expect(config.body.data.features.support_tickets_enabled).toBe(false);

    const spy = vi.spyOn(MockAiProvider.prototype, 'generateResponse');
    const session = (await request(app).post('/api/v1/widget/session').set('x-widget-key', STORE_A_WIDGET_KEY).send({ anonymous_id: 'ent_v1' })).body.data;
    const chat = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: session.session_id || session.id, message: 'I want to talk to a human agent' });
    expect(chat.status).toBe(200);
    expect(chat.body.data.should_escalate_ticket).toBe(false);
    expect(spy.mock.calls[0][1].assistantSettings.support_tickets_enabled).toBe(false);
  });

  it('greetings never return product cards', async () => {
    const session = (await request(app).post('/api/v1/widget/session').set('x-widget-key', STORE_A_WIDGET_KEY).send({ anonymous_id: 'greet_v1' })).body.data;
    const chat = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: session.session_id || session.id, message: 'Hi!' });
    expect(chat.status).toBe(200);
    expect(chat.body.data.recommendations).toHaveLength(0);
  });

  it('rejects oversized public chat messages', async () => {
    const session = (await request(app).post('/api/v1/widget/session').set('x-widget-key', STORE_A_WIDGET_KEY).send({ anonymous_id: 'big_v1' })).body.data;
    const chat = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: session.session_id || session.id, message: 'x'.repeat(2001) });
    expect(chat.status).toBe(400);
  });
});

describe('Webhook and onboarding hardening', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
  });

  afterEach(async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.WHATSAPP_APP_SECRET;
    await db.close();
  });

  it('onboarding cannot touch a store owned by another merchant', async () => {
    const admin = (await request(app).post('/api/v1/auth/login').send({ email: 'admin@platform.com', password: 'password123' })).body.token;
    const merchant = await request(app).post('/api/v1/admin/merchants').set('Authorization', `Bearer ${admin}`).send({ name: 'Intruder', contact_email: 'intruder@test.com' });
    const invite = await request(app).post(`/api/v1/admin/merchants/${merchant.body.data.id}/invite`).set('Authorization', `Bearer ${admin}`);
    const onboardingToken = invite.body.data.onboarding_token;

    const res = await request(app)
      .post('/api/v1/onboarding/step3-assistant')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({ store_id: STORE_A_ID, assistant_name: 'Hijacked', allowed_categories: ['All'], delivery_policy: 'x', returns_policy: 'x', faq_content: 'x' });
    expect(res.status).toBe(403);

    const settings = await db.query('SELECT assistant_name FROM assistant_settings WHERE store_id = $1', [STORE_A_ID]);
    expect(settings.rows[0]?.assistant_name).not.toBe('Hijacked');
  });

  it('Resend webhook requires a valid Svix signature once the secret is configured', async () => {
    const key = Buffer.from('resend-test-secret');
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${key.toString('base64')}`;
    const payload = { type: 'email.delivered', data: { email_id: 'msg_1', to: ['a@b.com'] } };

    const unsigned = await request(app).post('/api/v1/webhooks/resend').send(payload);
    expect(unsigned.status).toBe(401);

    const body = JSON.stringify(payload);
    const id = 'msg_svix_1';
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
    const signed = await request(app)
      .post('/api/v1/webhooks/resend')
      .set('Content-Type', 'application/json')
      .set('svix-id', id)
      .set('svix-timestamp', ts)
      .set('svix-signature', `v1,${sig}`)
      .send(body);
    expect(signed.status).not.toBe(401);
  });

  it('WhatsApp Cloud webhook rejects unsigned payloads when an app secret is configured', async () => {
    process.env.WHATSAPP_APP_SECRET = 'wa-app-secret';
    const payload = { object: 'whatsapp_business_account', entry: [] };

    const unsigned = await request(app).post('/api/v1/webhooks/whatsapp').send(payload);
    expect(unsigned.status).toBe(401);

    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', 'wa-app-secret').update(body).digest('hex');
    const signed = await request(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', `sha256=${sig}`)
      .send(body);
    expect(signed.status).toBe(200);
  });
});
