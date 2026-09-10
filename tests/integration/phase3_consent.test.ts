import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { VisitorRepository } from '../../src/modules/visitor/visitor.repository';
import { EventRepository } from '../../src/modules/events/event.repository';

describe('Phase 3: Consent Enforcement and UI Store Isolation API', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let visitorRepo: VisitorRepository;
  let eventRepo: EventRepository;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const STORE_B_WIDGET_KEY = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    visitorRepo = new VisitorRepository(db);
    eventRepo = new EventRepository(db);
    app = createApp({ db, visitorRepo, eventRepo });
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

  it('POST /api/v1/widget/visitor/consent saves email and consent correctly', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_123');

    const res = await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        visitor_id: session.visitor_id,
        email: 'test@example.com',
        phone: '123456789',
        marketing_opted_in: true,
        wording: 'Test wording',
        version: '1.0',
        source: 'widget_v1'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('test@example.com');
    expect(res.body.data.marketing_opted_in).toBe(true);

    // Verify database state
    const visitor = await visitorRepo.getVisitorById(STORE_A_ID, session.visitor_id);
    expect(visitor?.email).toBe('test@example.com');
    expect(visitor?.phone).toBe('123456789');

    const consent = await visitorRepo.getLatestMarketingConsent(STORE_A_ID, session.visitor_id);
    expect(consent?.opted_in).toBe(true);
    expect(consent?.wording).toBe('Test wording');

    // Verify events were recorded
    const events = await eventRepo.getVisitorEvents(STORE_A_ID, session.visitor_id);
    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain('email_submitted');
    expect(eventTypes).toContain('marketing_opted_in');
  });

  it('POST /api/v1/widget/visitor/consent allows continuing without marketing opt-in', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_no_consent');

    const res = await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        visitor_id: session.visitor_id,
        email: 'noconsent@example.com',
        marketing_opted_in: false
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.marketing_opted_in).toBe(false);

    const consent = await visitorRepo.getLatestMarketingConsent(STORE_A_ID, session.visitor_id);
    expect(consent?.opted_in).toBe(false);
  });

  it('POST /api/v1/widget/visitor/consent enforces store isolation (Store B cannot consent Store A visitor)', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_store_a');

    const res = await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', STORE_B_WIDGET_KEY) // wrong store id
      .send({
        visitor_id: session.visitor_id,
        email: 'hacked@example.com',
        marketing_opted_in: true
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_ISOLATION_VIOLATION');
  });

  it('rejects consent request missing required email', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_bad');

    const res = await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        visitor_id: session.visitor_id,
        marketing_opted_in: true
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
