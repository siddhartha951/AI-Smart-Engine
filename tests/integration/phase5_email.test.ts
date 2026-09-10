import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { EmailWorker } from '../../src/modules/email/email.worker';
import { getTestEmailProvider } from '../../src/providers/email';
import { getTestPurchaseAdapter } from '../../src/providers/purchase';

describe('Phase 5: Email Recovery sequence', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let worker: EmailWorker;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const STORE_B_WIDGET_KEY = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });
    worker = new EmailWorker({ db });
    
    getTestEmailProvider().clearInbox();
    getTestPurchaseAdapter().reset();
  });

  afterEach(async () => {
    worker.stop();
    await db.close();
  });

  async function createSession(storeId: string, anonymousId: string) {
    const res = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', storeId)
      .send({ anonymous_id: anonymousId });
    return res.body.data;
  }

  async function submitConsent(storeId: string, visitorId: string, email: string, optedIn: boolean) {
    await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', storeId)
      .send({
        visitor_id: visitorId,
        email,
        marketing_opted_in: optedIn
      });
  }

  async function scheduleEmail(storeId: string, visitorId: string, sessionId: string) {
    await request(app)
      .post('/api/v1/widget/test/schedule-email')
      .set('x-widget-key', storeId)
      .send({ visitor_id: visitorId, session_id: sessionId });
    
    // In test mode, we set the scheduled_for to 1 minute from now, so let's update it to NOW so worker picks it up
    await db.query(`UPDATE email_campaign_events SET scheduled_for = NOW() - INTERVAL '1 minute'`);
  }

  it('sends an email if the visitor opted in and hasn’t purchased', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_email_1');
    await submitConsent(STORE_A_WIDGET_KEY, session.visitor_id, 'buyer@example.com', true);
    await scheduleEmail(STORE_A_WIDGET_KEY, session.visitor_id, session.session_id);

    await worker.processPendingJobs();

    const inbox = getTestEmailProvider().sentEmails;
    expect(inbox.length).toBe(1);
    expect(inbox[0].to).toBe('buyer@example.com');
  });

  it('cancels the job and sends nothing if visitor did not opt in to marketing', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_email_2');
    await submitConsent(STORE_A_WIDGET_KEY, session.visitor_id, 'no-marketing@example.com', false);
    await scheduleEmail(STORE_A_WIDGET_KEY, session.visitor_id, session.session_id);

    await worker.processPendingJobs();

    const inbox = getTestEmailProvider().sentEmails;
    expect(inbox.length).toBe(0);

    // Verify job was cancelled
    const res = await db.query(`SELECT status, cancel_reason FROM email_campaign_events WHERE session_id = $1`, [session.session_id]);
    expect(res.rows[0].status).toBe('cancelled');
    expect(res.rows[0].cancel_reason).toBe('No marketing consent');
  });

  it('cancels the job if the visitor has purchased since the session started', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_email_3');
    await submitConsent(STORE_A_WIDGET_KEY, session.visitor_id, 'purchased@example.com', true);
    await scheduleEmail(STORE_A_WIDGET_KEY, session.visitor_id, session.session_id);

    // Simulate purchase
    getTestPurchaseAdapter().simulatePurchase(STORE_A_ID, 'purchased@example.com');

    await worker.processPendingJobs();

    const inbox = getTestEmailProvider().sentEmails;
    expect(inbox.length).toBe(0);

    const res = await db.query(`SELECT status, cancel_reason FROM email_campaign_events WHERE session_id = $1`, [session.session_id]);
    expect(res.rows[0].status).toBe('cancelled');
    expect(res.rows[0].cancel_reason).toBe('Purchase completed since session');
  });

  it('suppresses email if user unsubscribes via API', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_email_4');
    await submitConsent(STORE_A_WIDGET_KEY, session.visitor_id, 'unsub@example.com', true);
    await scheduleEmail(STORE_A_WIDGET_KEY, session.visitor_id, session.session_id);

    // Unsubscribe via API
    await request(app)
      .post('/api/v1/widget/visitor/unsubscribe')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ email: 'unsub@example.com' });

    await worker.processPendingJobs();

    const inbox = getTestEmailProvider().sentEmails;
    expect(inbox.length).toBe(0);

    const res = await db.query(`SELECT status, cancel_reason FROM email_campaign_events WHERE session_id = $1`, [session.session_id]);
    expect(res.rows[0].status).toBe('cancelled');
    expect(res.rows[0].cancel_reason).toBe('Email is suppressed');
  });

  it('guarantees idempotency (does not double-send if multiple workers run)', async () => {
    const session = await createSession(STORE_A_WIDGET_KEY, 'visitor_email_5');
    await submitConsent(STORE_A_WIDGET_KEY, session.visitor_id, 'duplicate@example.com', true);
    await scheduleEmail(STORE_A_WIDGET_KEY, session.visitor_id, session.session_id);

    // Run two workers simultaneously
    await Promise.all([
      worker.processPendingJobs(),
      worker.processPendingJobs(),
      worker.processPendingJobs()
    ]);

    // Because of FOR UPDATE SKIP LOCKED, only one worker picks up the row
    const inbox = getTestEmailProvider().sentEmails;
    expect(inbox.length).toBe(1);
    expect(inbox[0].to).toBe('duplicate@example.com');
  });
});
