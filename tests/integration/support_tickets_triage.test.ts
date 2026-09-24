import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { getTestEmailProvider } from '../../src/providers/email';

describe('Support Tickets: triage, SLA, alerts & macros', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let tokenA: string;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';

  const createTicket = (payload: Record<string, any>) =>
    request(app)
      .post('/api/v1/widget/tickets')
      .send({ widget_key: STORE_A_WIDGET_KEY, customer_email: 'rahul@gmail.com', subject: 'Customer requested human support', ...payload });

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    getTestEmailProvider().sentEmails = [];

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = login.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  it('auto-tags an angry order complaint as urgent with a 4-hour SLA due time', async () => {
    await db.query(`UPDATE assistant_settings SET ticket_revert_duration = 'within 4 hours' WHERE store_id = $1`, [STORE_A_ID]);

    const before = Date.now();
    const res = await createTicket({
      customer_name: 'Rahul',
      chat_transcript: [{ role: 'user', content: 'Mera order abhi tak nahi aaya, refund karo! Worst service.' }],
    });
    expect(res.status).toBe(201);

    const row = (await db.query(`SELECT * FROM support_tickets WHERE id = $1`, [res.body.data.ticket_id])).rows[0];
    expect(row.category).toBe('return_refund');
    expect(row.sentiment).toBe('angry');
    expect(row.priority).toBe('urgent');

    const dueMs = new Date(row.sla_due_at).getTime();
    expect(dueMs).toBeGreaterThanOrEqual(before + 4 * 3600_000 - 5000);
    expect(dueMs).toBeLessThanOrEqual(Date.now() + 4 * 3600_000 + 5000);
  });

  it('sends the customer a receipt with their conversation and alerts the merchant inbox', async () => {
    await db.query(
      `UPDATE assistant_settings SET support_contact = 'help@getaniwell.com', ticket_revert_duration = 'within 2 hours' WHERE store_id = $1`,
      [STORE_A_ID]
    );

    const res = await createTicket({
      customer_name: 'Rahul',
      subject: 'Damaged <b>bottle</b>',
      chat_transcript: [
        { role: 'user', content: 'My bottle arrived broken' },
        { role: 'assistant', content: 'Sorry to hear that! Let me open a ticket.' },
      ],
    });
    expect(res.status).toBe(201);

    const sent = getTestEmailProvider().sentEmails;
    const receipt = sent.find(e => e.campaignType === 'ticket_confirmation_receipt');
    expect(receipt?.to).toBe('rahul@gmail.com');
    expect(receipt?.textBody).toContain('Hi Rahul');
    expect(receipt?.textBody).toContain('within 2 hours');
    expect(receipt?.textBody).toContain('My bottle arrived broken');
    expect(receipt?.htmlBody).toContain('Your conversation');
    // Customer-supplied subject is escaped in HTML
    expect(receipt?.htmlBody).toContain('&lt;b&gt;bottle&lt;/b&gt;');
    expect(receipt?.htmlBody).not.toContain('<b>bottle</b>');

    const alert = sent.find(e => e.campaignType === 'ticket_merchant_alert');
    expect(alert).toBeDefined();
    expect(alert?.to).toBe('help@getaniwell.com');
    expect(alert?.replyTo).toBe('rahul@gmail.com');
    expect(alert?.subject).toContain('New Support Ticket #');
    expect(alert?.subject).toContain('Rahul (rahul@gmail.com)');
    expect(alert?.subject).toContain('London Eco Apparel');
    expect(alert?.textBody).toContain('Damaged / Missing Item');
  });

  it('falls back to the merchant account email when the support contact is the placeholder', async () => {
    await db.query(`UPDATE assistant_settings SET support_contact = 'support@store.com' WHERE store_id = $1`, [STORE_A_ID]);

    await createTicket({ chat_transcript: [{ role: 'user', content: 'Question about sizing' }] });

    const alert = getTestEmailProvider().sentEmails.find(e => e.campaignType === 'ticket_merchant_alert');
    expect(alert?.to).toBe('ops@london-eco.co.uk');
  });

  it('lists urgent tickets first and filters by category with counts', async () => {
    await createTicket({ chat_transcript: [{ role: 'user', content: 'Which product do you recommend for puppies?' }] });
    await createTicket({ chat_transcript: [{ role: 'user', content: 'Where is my order? Still waiting, pathetic!!!' }] });
    await createTicket({ chat_transcript: [{ role: 'user', content: 'My coupon code is not working' }] });

    const all = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/tickets`).set('Authorization', `Bearer ${tokenA}`);
    expect(all.status).toBe(200);
    expect(all.body.data.tickets[0].priority).toBe('urgent');
    expect(all.body.data.tickets[0].category).toBe('order_tracking');
    expect(all.body.data.category_counts).toMatchObject({ product_inquiry: 1, order_tracking: 1, discount_coupon: 1 });
    expect(all.body.data.server_time).toBeDefined();

    const coupons = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/tickets?category=discount_coupon`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(coupons.body.data.tickets.length).toBe(1);
    expect(coupons.body.data.tickets[0].category).toBe('discount_coupon');
  });

  it('provides order-status and apology macros using the merchant-configured discount code', async () => {
    const created = await createTicket({ customer_name: 'Rahul', chat_transcript: [{ role: 'user', content: 'Where is my order?' }] });
    const ticketId = created.body.data.ticket_id;

    // Without a configured code the apology macro uses an obvious placeholder, never an invented code
    const noCode = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/tickets/${ticketId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(noCode.body.data.macros.apology_discount_code).toBeNull();
    expect(noCode.body.data.macros.apology_discount).toContain('[ADD-YOUR-DISCOUNT-CODE]');
    expect(noCode.body.data.macros.order_status).toContain('Hi Rahul');
    expect(noCode.body.data.macros.order_status).toContain('https://london-eco.myshopify.com/account');

    const save = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ assistant: { ticket_apology_discount_code: 'SORRY15', ticket_apology_discount_percent: 15 } });
    expect(save.status).toBe(200);

    const withCode = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/tickets/${ticketId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(withCode.body.data.macros.apology_discount_code).toBe('SORRY15');
    expect(withCode.body.data.macros.apology_discount).toContain('15% off your next order with code: SORRY15');
  });

  it('rejects widget tickets when an admin has disabled the support tickets feature', async () => {
    await db.query(
      `INSERT INTO store_feature_entitlements (store_id, feature_key, enabled) VALUES ($1, 'support_tickets', false)
       ON CONFLICT (store_id, feature_key) DO UPDATE SET enabled = false`,
      [STORE_A_ID]
    );

    const res = await createTicket({ chat_transcript: [{ role: 'user', content: 'Hello' }] });
    expect(res.status).toBe(403);
    const count = await db.query(`SELECT COUNT(*)::int AS c FROM support_tickets WHERE store_id = $1`, [STORE_A_ID]);
    expect(count.rows[0].c).toBe(0);
  });

  it('keeps triage data tenant-isolated', async () => {
    await createTicket({ chat_transcript: [{ role: 'user', content: 'Refund please, item was damaged' }] });

    const loginB = await request(app).post('/api/v1/auth/login').send({ email: 'merchantB@store.com', password: 'password123' });
    const listB = await request(app).get(`/api/v1/dashboard/${STORE_B_ID}/tickets`).set('Authorization', `Bearer ${loginB.body.token}`);
    expect(listB.body.data.tickets.length).toBe(0);
    expect(listB.body.data.category_counts).toEqual({});

    const cross = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/tickets`).set('Authorization', `Bearer ${loginB.body.token}`);
    expect(cross.status).toBe(403);
  });
});
