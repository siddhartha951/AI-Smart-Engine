import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { EmailWorker } from '../../src/modules/email/email.worker';
import { getTestEmailProvider } from '../../src/providers/email';
import { SenderDomainRepository } from '../../src/modules/email/sender-domain.repository';
import { EmailRepository } from '../../src/modules/email/email.repository';

describe('Resend Platform Email Provider Integration', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let worker: EmailWorker;
  let domainRepo: SenderDomainRepository;
  let emailRepo: EmailRepository;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const STORE_B_WIDGET_KEY = 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb';

  let tokenStoreA: string;
  let tokenStoreB: string;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_PROVIDER_MODE = 'fake';
    process.env.SHOPIFY_ADAPTER_MODE = 'fake';

    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    domainRepo = new SenderDomainRepository(db);
    emailRepo = new EmailRepository(db);
    worker = new EmailWorker({ db, emailRepo, senderDomainRepo: domainRepo });
    app = createApp({ db, emailRepo });

    getTestEmailProvider().clearInbox();

    const resA = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenStoreA = resA.body.token;

    const resB = await request(app).post('/api/v1/auth/login').send({ email: 'merchantB@store.com', password: 'password123' });
    tokenStoreB = resB.body.token;
  });

  afterEach(async () => {
    worker.stop();
    await db.close();
  });

  async function createLeadAndSchedule(storeWidgetKey: string, storeId: string, email: string) {
    const sessionRes = await request(app)
      .post('/api/v1/widget/session')
      .set('x-widget-key', storeWidgetKey)
      .send({ anonymous_id: `anon_${Date.now()}_${Math.random()}` });
    const { visitor_id, session_id } = sessionRes.body.data;

    await request(app)
      .post('/api/v1/widget/visitor/consent')
      .set('x-widget-key', storeWidgetKey)
      .send({
        visitor_id,
        email,
        marketing_opted_in: true
      });

    await request(app)
      .post('/api/v1/widget/test/schedule-email')
      .set('x-widget-key', storeWidgetKey)
      .send({ visitor_id, session_id });

    await db.query(`UPDATE email_campaign_events SET scheduled_for = NOW() - INTERVAL '1 minute' WHERE store_id = $1`, [storeId]);
    return { visitor_id, session_id };
  }

  // 1. Unverified Domain Rejection
  it('1. rejects sending marketing emails when store sender domain is unverified', async () => {
    // Delete verified domain for Store A and insert a pending domain
    await db.query(`DELETE FROM merchant_sender_domains WHERE store_id = $1`, [STORE_A_ID]);
    await domainRepo.createDomain(
      STORE_A_ID,
      'unverified-store.co.uk',
      'resend_domain_unverified',
      [],
      'Store A Unverified',
      'sales@unverified-store.co.uk',
      'pending'
    );

    await createLeadAndSchedule(STORE_A_WIDGET_KEY, STORE_A_ID, 'shopper@example.com');

    await worker.processPendingJobs();

    // Provider should not have dispatched any email
    expect(getTestEmailProvider().sentEmails.length).toBe(0);

    // Job should be cancelled with 'Sender domain unverified'
    const jobs = await db.query<{ status: string; cancel_reason: string }>(
      `SELECT status, cancel_reason FROM email_campaign_events WHERE store_id = $1`,
      [STORE_A_ID]
    );
    expect(jobs.rows.length).toBeGreaterThan(0);
    expect(jobs.rows[0].status).toBe('cancelled');
    expect(jobs.rows[0].cancel_reason).toBe('Sender domain unverified');
  });

  // 2. Verified Domain Dispatch
  it('2. successfully dispatches marketing emails when verified domain exists', async () => {
    // Store A is seeded with a verified domain
    await createLeadAndSchedule(STORE_A_WIDGET_KEY, STORE_A_ID, 'customer@example.com');

    await worker.processPendingJobs();

    const sent = getTestEmailProvider().sentEmails;
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe('customer@example.com');
    expect(sent[0].from).toContain('london-eco.co.uk');
    expect(sent[0].idempotencyKey).toBeDefined();

    // Verify job in DB
    const jobs = await db.query<{ status: string; idempotency_key: string; provider_message_id: string }>(
      `SELECT status, idempotency_key, provider_message_id FROM email_campaign_events WHERE store_id = $1`,
      [STORE_A_ID]
    );
    expect(jobs.rows[0].status).toBe('sent');
    expect(jobs.rows[0].idempotency_key).toBeDefined();
    expect(jobs.rows[0].provider_message_id).toBeDefined();
  });

  // 3. Duplicate-Send Prevention via Idempotency Keys
  it('3. prevents duplicate email sends using idempotency keys', async () => {
    await createLeadAndSchedule(STORE_A_WIDGET_KEY, STORE_A_ID, 'shopper_idempotent@example.com');

    // First run sends the email
    await worker.processPendingJobs();
    expect(getTestEmailProvider().sentEmails.length).toBe(1);

    // If another worker or retry runs on the same pending/sent record
    await db.query(`UPDATE email_campaign_events SET status = 'pending', scheduled_for = NOW() - INTERVAL '1 minute' WHERE store_id = $1`, [STORE_A_ID]);
    await worker.processPendingJobs();

    // Email count remains 1, duplicate dispatch prevented!
    expect(getTestEmailProvider().sentEmails.length).toBe(1);

    const jobs = await db.query<{ status: string; cancel_reason: string }>(
      `SELECT status, cancel_reason FROM email_campaign_events WHERE store_id = $1`,
      [STORE_A_ID]
    );
    expect(jobs.rows[0].cancel_reason).toBe('Duplicate send prevented by idempotency key');
  });

  // 4. Bounced Recipient Suppression via Webhook
  it('4. automatically suppresses bounced recipients and cancels pending recovery emails', async () => {
    const bouncedEmail = 'bounced_user@example.com';
    await createLeadAndSchedule(STORE_A_WIDGET_KEY, STORE_A_ID, bouncedEmail);

    // Send Resend bounce webhook
    const webhookRes = await request(app)
      .post('/api/v1/webhooks/resend')
      .send({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          email_id: 'msg_bounce_123',
          from: 'London Eco <notifications@london-eco.co.uk>',
          to: [bouncedEmail],
          tags: [{ name: 'store_id', value: STORE_A_ID }]
        }
      });

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.success).toBe(true);

    // Verify recipient is now suppressed in Store A
    const isSuppressed = await emailRepo.isSuppressed(STORE_A_ID, bouncedEmail);
    expect(isSuppressed).toBe(true);

    // Verify webhook event recorded
    const events = await emailRepo.getWebhookEvents(STORE_A_ID);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].event_type).toBe('email.bounced');
    expect(events[0].recipient).toBe(bouncedEmail);

    // Running worker should not send to the suppressed email
    await worker.processPendingJobs();
    expect(getTestEmailProvider().sentEmails.length).toBe(0);
  });

  // 5. Spam Complaint Suppression via Webhook
  it('5. suppresses recipient on spam complaint webhook event', async () => {
    const complaintEmail = 'complaining_user@example.com';

    const webhookRes = await request(app)
      .post('/api/v1/webhooks/resend')
      .send({
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          email_id: 'msg_complaint_456',
          to: [complaintEmail],
          tags: [{ name: 'store_id', value: STORE_A_ID }]
        }
      });

    expect(webhookRes.status).toBe(200);
    const isSuppressed = await emailRepo.isSuppressed(STORE_A_ID, complaintEmail);
    expect(isSuppressed).toBe(true);
  });

  // 6. Multi-Tenant Store Isolation for Suppressions & Domains
  it('6. guarantees strict store isolation for domains, suppressions, and webhooks', async () => {
    const sharedEmail = 'customer@cross-tenant.com';

    // Suppress shared email in Store A via webhook
    await request(app)
      .post('/api/v1/webhooks/resend')
      .send({
        type: 'email.bounced',
        data: {
          to: [sharedEmail],
          tags: [{ name: 'store_id', value: STORE_A_ID }]
        }
      });

    // Store A is suppressed
    expect(await emailRepo.isSuppressed(STORE_A_ID, sharedEmail)).toBe(true);
    // Store B is NOT suppressed!
    expect(await emailRepo.isSuppressed(STORE_B_ID, sharedEmail)).toBe(false);

    // Store B can still dispatch recovery emails to this customer
    await createLeadAndSchedule(STORE_B_WIDGET_KEY, STORE_B_ID, sharedEmail);
    await worker.processPendingJobs();

    const sent = getTestEmailProvider().sentEmails;
    expect(sent.length).toBe(1);
    expect(sent[0].storeId).toBe(STORE_B_ID);
    expect(sent[0].to).toBe(sharedEmail);

    // Cross-tenant domain tampering check: Store A user cannot access Store B domains
    const storeBDomains = await domainRepo.getDomainsByStore(STORE_B_ID);
    expect(storeBDomains.length).toBeGreaterThan(0);

    const hijackRes = await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/email/domains/${storeBDomains[0].id}`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    // Should return deleted: false because domain belongs to Store B
    expect(hijackRes.body.deleted).toBe(false);

    // Store B owner can properly list and manage their own domains
    const storeBListRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/email/domains`)
      .set('Authorization', `Bearer ${tokenStoreB}`);
    expect(storeBListRes.status).toBe(200);
    expect(storeBListRes.body.data.length).toBeGreaterThan(0);
  });

  // 7. Merchant Onboarding & Dashboard Domain Flow
  it('7. allows creating a sender domain, viewing DNS records, and verifying status', async () => {
    // 1. Create domain via dashboard
    const createRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`)
      .set('Authorization', `Bearer ${tokenStoreA}`)
      .send({
        domain_name: 'newstorebrand.com',
        sender_name: 'New Store Brand',
        sender_email: 'hello@newstorebrand.com'
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.domain_name).toBe('newstorebrand.com');
    expect(createRes.body.data.status).toBe('pending');
    expect(createRes.body.data.dns_records.length).toBeGreaterThan(0);

    const domainId = createRes.body.data.id;

    // 2. Fetch list of domains
    const listRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/email/domains`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((d: any) => d.id === domainId)).toBe(true);

    // 3. Trigger verification check
    const verifyRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/email/domains/${domainId}/verify`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.status).toBe('verified');
  });

  // 8. Secret Protection & API Key Hygiene
  it('8. never leaks platform RESEND_API_KEY in domain or dashboard responses', async () => {
    const testSecret = 're_live_secret_key_platform_998877665544';
    process.env.RESEND_API_KEY = testSecret;

    const listRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/email/domains`)
      .set('Authorization', `Bearer ${tokenStoreA}`);

    const bodyStr = JSON.stringify(listRes.body);
    expect(bodyStr).not.toContain(testSecret);
    expect(bodyStr).not.toContain('RESEND_API_KEY');
  });
});
