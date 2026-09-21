import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { EventRepository } from '../../src/modules/events/event.repository';
import { VisitorRepository } from '../../src/modules/visitor/visitor.repository';
import { ChatRepository } from '../../src/modules/chat/chat.repository';

/**
 * Regression tests for the production bugs reported 2026-09-21:
 *
 * 1. Chat widget: "Session <id> not found or unauthorized" on every message
 * 2. "Request Error: Store not found: 0bccaf14-..." (attribution touchpoint)
 * 3. "Session <id> does not belong to store <id>" (cross-store session reuse)
 * 4. 'insert or update on table "events" violates foreign key constraint "events_session_id_fkey"'
 *
 * Plus guards added during the full dashboard sweep:
 * - utm_* field mapping on the public touchpoint beacon
 * - Zod validation errors surface as 400 instead of 500
 */
describe('Session lifecycle & telemetry guards (production bug fixes)', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let eventRepo: EventRepository;
  let visitorRepo: VisitorRepository;
  let chatRepo: ChatRepository;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // London Eco Apparel
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Highland Peak Gear
  // Real ids from the production error reports
  const STALE_SESSION_ID = '3de9b618-ae83-443e-9836-8904992b259a';
  const UNKNOWN_STORE_ID = '0bccaf14-7d78-4773-ba52-401c18331bbe';

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });
    eventRepo = new EventRepository(db);
    visitorRepo = new VisitorRepository(db);
    chatRepo = new ChatRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // -------------------------------------------------------------------------
  // Bug 4: events_session_id_fkey FK violation
  // -------------------------------------------------------------------------

  it('recordEvent with a stale session_id records the event with NULL session instead of FK violation', async () => {
    const visitor = await visitorRepo.getOrCreateVisitor(STORE_A_ID, 'anon_evt_stale');
    const evt = await eventRepo.recordEvent(
      STORE_A_ID,
      visitor.id,
      'page_view',
      { path: '/' },
      STALE_SESSION_ID
    );
    expect(evt.id).toBeDefined();
    expect(evt.session_id).toBeNull();
  });

  it('recordEvent with a malformed session_id records the event with NULL session instead of 500', async () => {
    const visitor = await visitorRepo.getOrCreateVisitor(STORE_A_ID, 'anon_evt_malformed');
    const evt = await eventRepo.recordEvent(STORE_A_ID, visitor.id, 'page_view', {}, 'not-a-uuid');
    expect(evt.id).toBeDefined();
    expect(evt.session_id).toBeNull();
  });

  it('recordEvent keeps a valid session_id that belongs to the store', async () => {
    const visitor = await visitorRepo.getOrCreateVisitor(STORE_A_ID, 'anon_evt_valid');
    const session = await chatRepo.createSession(STORE_A_ID, visitor.id);
    const evt = await eventRepo.recordEvent(STORE_A_ID, visitor.id, 'page_view', {}, session.id);
    expect(evt.session_id).toBe(session.id);
  });

  it('recordEvent with a session from another store degrades to NULL (no cross-store reference)', async () => {
    const visitorA = await visitorRepo.getOrCreateVisitor(STORE_A_ID, 'anon_evt_cross');
    const visitorB = await visitorRepo.getOrCreateVisitor(STORE_B_ID, 'anon_evt_cross_b');
    const sessionB = await chatRepo.createSession(STORE_B_ID, visitorB.id);
    const evt = await eventRepo.recordEvent(STORE_A_ID, visitorA.id, 'page_view', {}, sessionB.id);
    expect(evt.session_id).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Bug 2: "Store not found" on the public attribution touchpoint beacon
  // -------------------------------------------------------------------------

  it('touchpoint with an unknown store_id is dropped gracefully (200, no 403)', async () => {
    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: UNKNOWN_STORE_ID,
        visitor_id: '11111111-1111-1111-1111-111111111111',
        utm_source: 'facebook',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dropped).toBe(true);
    expect(res.body.reason).toBe('unknown_store');
  });

  it('touchpoint with a malformed store_id is dropped gracefully', async () => {
    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({ store_id: 'not-a-store', visitor_id: '11111111-1111-1111-1111-111111111111' });

    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(true);
  });

  it('touchpoint maps the widget utm_* field names to canonical source/medium/campaign', async () => {
    const visitor = await visitorRepo.getOrCreateVisitor(STORE_A_ID, 'anon_utm_map');

    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: visitor.id,
        utm_source: 'facebook',
        utm_medium: 'paid_social',
        utm_campaign: 'diwali_sale',
        utm_content: 'video_hook_a',
        utm_term: 'organic apparel',
        landing_page: 'https://london-eco.myshopify.com/products/organic-tee',
        referrer: 'https://facebook.com',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.source).toBe('facebook');
    expect(res.body.data.medium).toBe('paid_social');
    expect(res.body.data.campaign).toBe('diwali_sale');
    expect(res.body.data.content).toBe('video_hook_a');
    expect(res.body.data.term).toBe('organic apparel');
    expect(res.body.data.landing_page_url).toBe('https://london-eco.myshopify.com/products/organic-tee');
    expect(res.body.data.referrer_url).toBe('https://facebook.com');
  });

  it('touchpoint with a stale session_id is recorded with NULL session (no FK violation)', async () => {
    const visitor = await visitorRepo.getOrCreateVisitor(STORE_A_ID, 'anon_tp_stale');

    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: visitor.id,
        session_id: STALE_SESSION_ID,
        source: 'facebook',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session_id).toBeNull();
  });

  it('touchpoint with an unknown visitor is dropped gracefully (no 500)', async () => {
    const res = await request(app)
      .post('/api/v1/attribution/touchpoint')
      .send({
        store_id: STORE_A_ID,
        visitor_id: '99999999-9999-9999-9999-999999999999',
        source: 'facebook',
      });

    expect(res.status).toBe(200);
    expect(res.body.dropped).toBe(true);
    expect(res.body.reason).toBe('unknown_visitor');
  });

  // -------------------------------------------------------------------------
  // Bugs 1 & 3: chat message session contract (widget auto-recovery relies on it)
  // -------------------------------------------------------------------------

  it('chat message with a stale session_id returns 403 TENANT_ISOLATION_VIOLATION (widget retries with a fresh session)', async () => {
    const res = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: STALE_SESSION_ID, message: 'Hello' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_ISOLATION_VIOLATION');
    expect(res.body.error.message).toContain('not found or unauthorized');
  });

  it('chat message with a session from another store is rejected (no cross-store access)', async () => {
    const visitorB = await visitorRepo.getOrCreateVisitor(STORE_B_ID, 'anon_cross_chat');
    const sessionB = await chatRepo.createSession(STORE_B_ID, visitorB.id);

    const res = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: sessionB.id, message: 'Hello' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_ISOLATION_VIOLATION');
  });

  it('widget session creation + chat message happy path still works', async () => {
    const sessionRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ anonymous_id: 'anon_happy_path' });

    expect(sessionRes.status).toBe(201);
    expect(sessionRes.body.success).toBe(true);
    const { session_id } = sessionRes.body.data;
    expect(session_id).toBeDefined();

    const chatRes = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id, message: 'Show me ethnic wear dresses' });

    expect(chatRes.status).toBe(200);
    expect(chatRes.body.success).toBe(true);
    expect(chatRes.body.data.message).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Sweep: Zod validation errors surface as 400, not 500
  // -------------------------------------------------------------------------

  it('widget events with a malformed visitor_id returns 400 VALIDATION_ERROR (not 500)', async () => {
    const res = await request(app)
      .post('/api/v1/widget/events')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({
        widget_key: STORE_A_WIDGET_KEY,
        visitor_id: 'not-a-uuid',
        type: 'page_view',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
