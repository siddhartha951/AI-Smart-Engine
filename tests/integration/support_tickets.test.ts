import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';

describe('Support Tickets & Helpdesk Integration', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });

    // Merchant A Login
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    // Merchant B Login
    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    tokenB = resB.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  it('1. allows public widget to submit a support ticket with chat transcript', async () => {
    const chatTranscript = [
      { role: 'user', content: 'Do you ship to Mumbai?' },
      { role: 'assistant', content: 'Yes, we offer express delivery across India.' },
      { role: 'user', content: 'My previous order #1084 is delayed, can someone help?' }
    ];

    const res = await request(app)
      .post('/api/v1/widget/tickets')
      .send({
        store_id: STORE_A_ID,
        customer_email: 'customer@test.com',
        customer_name: 'Rahul Sharma',
        subject: 'Order #1084 delayed delivery inquiry',
        chat_transcript: chatTranscript,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ticket_id).toBeDefined();

    // Verify ticket is visible in Merchant A's dashboard
    const listRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/tickets`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data.tickets.length).toBe(1);
    expect(listRes.body.data.tickets[0].customer_email).toBe('customer@test.com');
    expect(listRes.body.data.tickets[0].status).toBe('open');
    expect(listRes.body.data.stats.open).toBe(1);
    expect(listRes.body.data.stats.total).toBe(1);
  });

  it('2. enforces tenant isolation between stores for support tickets', async () => {
    // Submit ticket for Store A
    await request(app)
      .post('/api/v1/widget/tickets')
      .send({
        store_id: STORE_A_ID,
        customer_email: 'storeA_customer@test.com',
        subject: 'Store A Inquiry',
      });

    // Merchant B checks their tickets — must be 0
    const listResB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/tickets`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listResB.status).toBe(200);
    expect(listResB.body.data.tickets.length).toBe(0);
    expect(listResB.body.data.stats.total).toBe(0);
  });

  it('3. retrieves complete ticket details with conversation transcript', async () => {
    const chatTranscript = [
      { role: 'user', content: 'I have a question about ingredients.' },
      { role: 'assistant', content: 'Our products are 100% natural and hypoallergenic.' },
    ];

    const createRes = await request(app)
      .post('/api/v1/widget/tickets')
      .send({
        store_id: STORE_A_ID,
        customer_email: 'petowner@example.com',
        subject: 'Ingredient safety question',
        chat_transcript: chatTranscript,
      });

    const ticketId = createRes.body.data.ticket_id;

    const detailRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.id).toBe(ticketId);
    expect(detailRes.body.data.customer_email).toBe('petowner@example.com');
    expect(detailRes.body.data.chat_transcript).toHaveLength(2);
    expect(detailRes.body.data.chat_transcript[0].content).toBe('I have a question about ingredients.');
  });

  it('4. generates an AI draft response and sends resolution reply', async () => {
    const createRes = await request(app)
      .post('/api/v1/widget/tickets')
      .send({
        store_id: STORE_A_ID,
        customer_email: 'customer@domain.com',
        subject: 'Can I return an opened item?',
        chat_transcript: [
          { role: 'user', content: 'What is the return window?' },
          { role: 'assistant', content: 'We offer a 30-day return policy.' }
        ]
      });

    const ticketId = createRes.body.data.ticket_id;

    // Test AI draft generation
    const genRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/tickets/${ticketId}/generate-reply`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(genRes.status).toBe(200);
    expect(genRes.body.success).toBe(true);
    expect(genRes.body.data.generated_reply).toBeDefined();

    // Send admin resolution
    const replyRes = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/tickets/${ticketId}/reply`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        replyText: 'Hi, you can return opened items within 30 days for a full refund. Please ship it to our warehouse.',
        markResolved: true
      });

    expect(replyRes.status).toBe(200);
    expect(replyRes.body.success).toBe(true);
    expect(replyRes.body.data.status).toBe('resolved');
    expect(replyRes.body.data.admin_reply).toContain('Hi, you can return opened items');

    // Verify stats updated
    const statsRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/tickets`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(statsRes.body.data.stats.open).toBe(0);
    expect(statsRes.body.data.stats.resolved).toBe(1);
  });

  it('5. quotes configured support SLA duration and sends confirmation receipt with brand reply-to', async () => {
    const { getTestEmailProvider } = await import('../../src/providers/email');
    const fakeEmail = getTestEmailProvider();
    fakeEmail.sentEmails = [];

    // Configure support_contact and ticket_revert_duration for Store A
    await db.query(
      `UPDATE assistant_settings SET support_contact = 'help@getaniwell.com', ticket_revert_duration = 'within 4 hours' WHERE store_id = $1`,
      [STORE_A_ID]
    );

    // Verify dashboard returns configured SLA
    const dashRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/tickets`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.sla).toBe('within 4 hours');

    // Create ticket from widget
    const res = await request(app)
      .post('/api/v1/widget/tickets')
      .send({
        store_id: STORE_A_ID,
        customer_email: 'shopper@domain.com',
        customer_name: 'Amit Patel',
        subject: 'Need help with dog allergic reaction',
        chat_transcript: [{ role: 'user', content: 'My dog has an allergy' }]
      });

    expect(res.status).toBe(201);

    // Verify confirmation receipt email was dispatched
    const receipt = fakeEmail.sentEmails.find(e => e.campaignType === 'ticket_confirmation_receipt');
    expect(receipt).toBeDefined();
    expect(receipt?.to).toBe('shopper@domain.com');
    expect(receipt?.replyTo).toBe('help@getaniwell.com');
    expect(receipt?.subject).toContain('Support Request Received');
    expect(receipt?.textBody).toContain('within 4 hours');
  });

  it('6. excludes zero-dollar products from bestseller searches', async () => {
    // Insert a $0 free sample and a real flagship product
    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, title, handle, price, in_stock, is_bestseller, sales_rank)
      VALUES 
        ('prod-zero', $1, 'shopify-zero-sample', 'Aniwell Dog Wipes (Free Sample)', 'free-wipes', 0.00, true, false, 999),
        ('prod-flagship', $1, 'shopify-flagship-1', 'Aniwell Skin & Coat Formula', 'skin-coat', 29.99, true, true, 1)
    `, [STORE_A_ID]);

    const { LiveShopifyAdapter } = await import('../../src/providers/shopify/live.shopify.adapter');
    const adapter = new LiveShopifyAdapter();

    const results = await adapter.searchProducts(STORE_A_ID, {
      bestseller_only: true,
      keywords: []
    });

    expect(results.length).toBeGreaterThan(0);
    // Zero dollar product must NOT be returned!
    const hasZero = results.some(p => p.price <= 0 || p.title.includes('Free Sample'));
    expect(hasZero).toBe(false);

    const flagship = results.find(p => p.title === 'Aniwell Skin & Coat Formula');
    expect(flagship).toBeDefined();
    expect(flagship?.price).toBe(29.99);
  });

  it('7. creates a ticket when the storefront widget only knows its widget_key (no session yet)', async () => {
    const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';

    // Mirrors the live widget payload: store_id falls back to the widget key and session_id is null
    const res = await request(app)
      .post('/api/v1/widget/tickets')
      .set('X-Widget-Key', STORE_A_WIDGET_KEY)
      .send({
        widget_key: STORE_A_WIDGET_KEY,
        store_id: STORE_A_WIDGET_KEY,
        session_id: null,
        customer_email: 'shopper@test.com',
        subject: 'Customer requested human support via header button',
        chat_transcript: [{ role: 'user', content: 'Can I talk to a human about subscriptions?' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const listRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/tickets`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listRes.body.data.tickets.length).toBe(1);
    expect(listRes.body.data.tickets[0].customer_email).toBe('shopper@test.com');

    // The ticket must never leak into Store B
    const listB = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/tickets`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.data.tickets.length).toBe(0);
  });

  it('8. rejects tickets for an unknown widget key and ignores a session from another store', async () => {
    const unknown = await request(app)
      .post('/api/v1/widget/tickets')
      .send({
        widget_key: '99999999-9999-9999-9999-999999999999',
        customer_email: 'shopper@test.com',
        subject: 'Help',
      });
    expect(unknown.status).toBe(401);

    const sessionB = await db.query(
      `INSERT INTO visitors (store_id, anonymous_id) VALUES ($1, 'anon-b-ticket') RETURNING id`,
      [STORE_B_ID]
    );
    const chatB = await db.query(
      `INSERT INTO chat_sessions (store_id, visitor_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [STORE_B_ID, sessionB.rows[0].id]
    );

    const res = await request(app)
      .post('/api/v1/widget/tickets')
      .send({
        widget_key: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
        session_id: chatB.rows[0].id,
        customer_email: 'shopper@test.com',
        subject: 'Help',
      });
    expect(res.status).toBe(201);

    const ticket = await db.query(`SELECT store_id, session_id FROM support_tickets WHERE id = $1`, [res.body.data.ticket_id]);
    expect(ticket.rows[0].store_id).toBe(STORE_A_ID);
    expect(ticket.rows[0].session_id).toBeNull();
  });
});
