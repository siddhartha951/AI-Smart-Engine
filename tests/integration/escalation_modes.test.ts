import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { EntitlementRepository } from '../../src/modules/entitlements/entitlement.repository';
import { FeatureKey } from '../../src/modules/entitlements/entitlement.types';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';

describe('Human support escalation modes', () => {
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

  async function chat(message: string, anonymousId = 'esc_visitor') {
    const session = (await request(app).post('/api/v1/widget/session').set('x-widget-key', STORE_A_WIDGET_KEY).send({ anonymous_id: anonymousId })).body.data;
    return request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: session.session_id || session.id, message });
  }

  it('existing stores keep tickets; stores the admin has not enabled default to off', async () => {
    const repo = new EntitlementRepository(db);
    expect(await repo.isFeatureEnabled(STORE_A_ID, FeatureKey.SUPPORT_TICKETS)).toBe(true);
    expect(await repo.isFeatureEnabled('cccccccc-cccc-cccc-cccc-cccccccccccc', FeatureKey.SUPPORT_TICKETS)).toBe(false);
  });

  it('defaults to smart: normal questions do not escalate, asking for a person offers a ticket', async () => {
    const config = await request(app).get('/api/v1/widget/config').set('x-widget-key', STORE_A_WIDGET_KEY);
    expect(config.body.data.features.escalation_mode).toBe('smart');

    const normal = await chat('Do you have audio gear?');
    expect(normal.body.data.escalation.level).toBe('none');
    expect(normal.body.data.should_escalate_ticket).toBe(false);

    const human = await chat('I want to talk to a human agent', 'esc_visitor_2');
    expect(human.body.data.escalation.level).toBe('offer');
    expect(human.body.data.should_escalate_ticket).toBe(true);
  });

  it('merchant can switch to contact only; the widget then gets contact details, never a ticket', async () => {
    const save = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assistant: { escalation_mode: 'contact_only', escalation_sensitivity: 'late' } });
    expect(save.status).toBe(200);

    const settings = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/agent`).set('Authorization', `Bearer ${token}`);
    expect(settings.body.data.assistant.escalation_mode).toBe('contact_only');
    expect(settings.body.data.assistant.escalation_sensitivity).toBe('late');

    const config = await request(app).get('/api/v1/widget/config').set('x-widget-key', STORE_A_WIDGET_KEY);
    expect(config.body.data.features.escalation_mode).toBe('contact_only');

    const human = await chat('I want to talk to a human agent', 'esc_visitor_3');
    expect(human.body.data.escalation.level).toBe('contact');
    expect(human.body.data.should_escalate_ticket).toBe(false);
  });

  it('invalid mode values are stored as the safe default', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assistant: { escalation_mode: 'always_ticket', escalation_sensitivity: 'sometimes' } });
    const row = await db.query('SELECT escalation_mode, escalation_sensitivity FROM assistant_settings WHERE store_id = $1', [STORE_A_ID]);
    expect(row.rows[0]).toEqual({ escalation_mode: 'smart', escalation_sensitivity: 'balanced' });
  });

  it('admin disabling tickets forces contact only, whatever the merchant picked', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assistant: { escalation_mode: 'instant' } });
    await new EntitlementRepository(db).setFeatureEntitlement(STORE_A_ID, FeatureKey.SUPPORT_TICKETS, false);

    const config = await request(app).get('/api/v1/widget/config').set('x-widget-key', STORE_A_WIDGET_KEY);
    expect(config.body.data.features.escalation_mode).toBe('contact_only');
    const human = await chat('please create a support ticket', 'esc_visitor_4');
    expect(human.body.data.escalation.level).toBe('contact');
  });
});
