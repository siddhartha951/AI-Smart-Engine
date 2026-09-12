import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { MockWhatsAppProvider } from '../../src/providers/whatsapp/mock.whatsapp.provider';
import { setWhatsAppProvider } from '../../src/providers/whatsapp';
import { getTestEmailProvider, resetEmailProviders } from '../../src/providers/email';
import { ReplenishmentService } from '../../src/modules/replenishment/replenishment.service';
import { WebhookService } from '../../src/modules/events/webhook.service';

describe('Phase 14: Auto Replenishment & Reorder Reminders Engine', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let mockWaProvider: MockWhatsAppProvider;
  let fakeEmailProvider: any;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // London Eco Apparel (shop_domain: london-eco.myshopify.com)
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Highland Peak Gear (shop_domain: highland-gear.myshopify.com)

  const PROD_SERUM = 'prod_serum_30';
  const PROD_PROTEIN = 'prod_protein_45';
  const PROD_NON_REP = 'prod_tshirt_non_rep';

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    mockWaProvider = new MockWhatsAppProvider();
    setWhatsAppProvider(mockWaProvider);

    fakeEmailProvider = getTestEmailProvider();
    resetEmailProviders();

    app = createApp({ db });

    // Seed products for Store A
    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, currency, in_stock, category)
      VALUES 
        ('${PROD_SERUM}', '${STORE_A_ID}', '${PROD_SERUM}', 'var_serum_01', '30-Day Organic Face Serum', '30-day-organic-face-serum', 28.50, 'GBP', true, 'skincare'),
        ('${PROD_PROTEIN}', '${STORE_A_ID}', '${PROD_PROTEIN}', 'var_protein_01', 'Plant Protein Blend 1kg', 'plant-protein-blend-1kg', 42.00, 'GBP', true, 'nutrition'),
        ('${PROD_NON_REP}', '${STORE_A_ID}', '${PROD_NON_REP}', 'var_tshirt_01', 'Cotton Logo T-Shirt', 'cotton-logo-tshirt', 22.00, 'GBP', true, 'apparel')
    `);

    // Seed products for Store B
    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, currency, in_stock, category)
      VALUES 
        ('prod_b_oil', '${STORE_B_ID}', 'prod_b_oil', 'var_b_oil_01', 'Highland Beard Oil', 'highland-beard-oil', 18.00, 'GBP', true, 'grooming')
    `);

    // Log in Store A
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    // Log in Store B
    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    tokenB = resB.body.token;
  });

  afterEach(async () => {
    mockWaProvider.clear();
    resetEmailProviders();
    await db.close();
  });

  // 1. Product can be marked replenishable
  it('1. allows merchant to mark a product as replenishable with custom cycle and reminder offset', async () => {
    const res = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/replenishment/products/${PROD_SERUM}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        replenishable: true,
        cycleDays: 30,
        reminderDaysBefore: 5,
        enabled: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.replenishable).toBe(true);
    expect(res.body.data.cycle_days).toBe(30);
    expect(res.body.data.reminder_days_before).toBe(5);

    // Verify in DB
    const dbRow = await db.query(`SELECT * FROM replenishment_product_settings WHERE store_id = '${STORE_A_ID}' AND product_id = '${PROD_SERUM}'`);
    expect(dbRow.rows.length).toBe(1);
    expect(dbRow.rows[0].replenishable).toBe(true);
  });

  // 2. Non-replenishable product creates no schedule
  it('2. ignores non-replenishable products during order webhook processing (creates no schedule)', async () => {
    const webhookService = new WebhookService();

    // Order with ONLY non-replenishable product
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 'order_non_rep_101',
      order_number: '1001',
      email: 'customer1@example.com',
      line_items: [
        { product_id: PROD_NON_REP, variant_id: 'var_tshirt_01', title: 'Cotton Logo T-Shirt', price: 22.00, quantity: 1 }
      ]
    });

    const schedules = await db.query(`SELECT * FROM replenishment_schedules WHERE store_id = '${STORE_A_ID}'`);
    expect(schedules.rows.length).toBe(0);
  });

  // 3. 30-day cycle calculation
  it('3. calculates deterministic 30-day cycle and 5-day reminder date accurately', () => {
    const service = new ReplenishmentService({ db });
    const purchaseDate = new Date('2026-09-01T12:00:00Z');
    const { expectedReorderAt, reminderAt } = service.calculateReorderDates(purchaseDate, 30, 5);

    // 30 days = 2026-10-01
    expect(expectedReorderAt.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    // 5 days before expected = 2026-09-26
    expect(reminderAt.toISOString()).toBe('2026-09-26T12:00:00.000Z');
  });

  // 4. 45-day cycle calculation
  it('4. calculates deterministic 45-day cycle accurately', () => {
    const service = new ReplenishmentService({ db });
    const purchaseDate = new Date('2026-09-01T00:00:00Z');
    const { expectedReorderAt, reminderAt } = service.calculateReorderDates(purchaseDate, 45, 5);

    // 45 days after 2026-09-01 = 2026-10-16
    expect(expectedReorderAt.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    // Reminder 5 days before = 2026-10-11
    expect(reminderAt.toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  // 5. Custom reminder days
  it('5. supports custom reminder days (e.g. 7 days before) and rejects invalid offsets', () => {
    const service = new ReplenishmentService({ db });
    const purchaseDate = new Date('2026-09-01T00:00:00Z');
    const { expectedReorderAt, reminderAt } = service.calculateReorderDates(purchaseDate, 60, 7);

    // 60 days after = 2026-10-31
    expect(expectedReorderAt.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    // Reminder 7 days before = 2026-10-24
    expect(reminderAt.toISOString()).toBe('2026-10-24T00:00:00.000Z');

    // Reject cycle <= 0
    expect(() => service.calculateReorderDates(purchaseDate, 0, 5)).toThrow();
    // Reject reminder >= cycle
    expect(() => service.calculateReorderDates(purchaseDate, 30, 30)).toThrow();
  });

  // 6. Multiple products in one order generate separate schedules
  it('6. generates separate schedules for multiple replenishable products in a single order', async () => {
    const service = new ReplenishmentService({ db });

    // Mark Serum (30 days) and Protein (45 days) as replenishable
    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30, reminderDaysBefore: 5 });
    await service.configureProduct(STORE_A_ID, PROD_PROTEIN, { replenishable: true, cycleDays: 45, reminderDaysBefore: 5 });

    const webhookService = new WebhookService();
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 'order_multi_201',
      order_number: '2001',
      email: 'multi@example.com',
      created_at: '2026-09-01T00:00:00Z',
      line_items: [
        { product_id: PROD_SERUM, variant_id: 'var_serum_01', title: '30-Day Organic Face Serum', price: 28.50, quantity: 1 },
        { product_id: PROD_PROTEIN, variant_id: 'var_protein_01', title: 'Plant Protein Blend 1kg', price: 42.00, quantity: 1 },
        { product_id: PROD_NON_REP, variant_id: 'var_tshirt_01', title: 'Cotton Logo T-Shirt', price: 22.00, quantity: 1 }
      ]
    });

    const schedules = await db.query(`SELECT * FROM replenishment_schedules WHERE store_id = '${STORE_A_ID}' ORDER BY cycle_days ASC`);
    expect(schedules.rows.length).toBe(2);

    const serumSched = schedules.rows[0];
    expect(serumSched.product_id).toBe(PROD_SERUM);
    expect(serumSched.cycle_days).toBe(30);
    expect(new Date(serumSched.expected_reorder_at).toISOString()).toBe('2026-10-01T00:00:00.000Z');

    const proteinSched = schedules.rows[1];
    expect(proteinSched.product_id).toBe(PROD_PROTEIN);
    expect(proteinSched.cycle_days).toBe(45);
    expect(new Date(proteinSched.expected_reorder_at).toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  // 7. Duplicate order event does not create duplicate schedule
  it('7. deduplicates order webhooks: duplicate delivery does not create duplicate schedules', async () => {
    const service = new ReplenishmentService({ db });
    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30, reminderDaysBefore: 5 });

    const webhookService = new WebhookService();
    const orderPayload = {
      id: 'order_dup_301',
      order_number: '3001',
      email: 'dup@example.com',
      line_items: [
        { product_id: PROD_SERUM, variant_id: 'var_serum_01', title: '30-Day Organic Face Serum', price: 28.50, quantity: 1 }
      ]
    };

    // First delivery
    await webhookService.processOrderWebhook('london-eco.myshopify.com', orderPayload);
    // Duplicate delivery
    await webhookService.processOrderWebhook('london-eco.myshopify.com', orderPayload);

    const schedules = await db.query(`SELECT * FROM replenishment_schedules WHERE store_id = '${STORE_A_ID}' AND order_id = 'order_dup_301'`);
    expect(schedules.rows.length).toBe(1);
  });

  // 8. Due reminder detection & 9. Future reminder is not sent
  it('8 & 9. detects due reminders (reminder_at <= NOW) and ignores future reminders', async () => {
    const service = new ReplenishmentService({ db });
    const repo = service['repo'];

    // 1. Past due reminder
    await repo.createSchedule(STORE_A_ID, {
      customerEmail: 'pastdue@example.com',
      orderId: 'ord_due_1',
      productId: PROD_SERUM,
      productTitle: '30-Day Organic Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000), // 1 hour ago (DUE)
    });

    // 2. Future reminder
    await repo.createSchedule(STORE_A_ID, {
      customerEmail: 'future@example.com',
      orderId: 'ord_future_2',
      productId: PROD_SERUM,
      productTitle: '30-Day Organic Face Serum',
      purchasedAt: new Date(),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 30 * 86400000),
      reminderAt: new Date(Date.now() + 25 * 86400000), // Future (NOT DUE)
    });

    const dueList = await repo.getDueSchedules();
    expect(dueList.length).toBe(1);
    expect(dueList[0].customer_email).toBe('pastdue@example.com');
  });

  // 10. Email consent required
  it('10. requires explicit email marketing consent before dispatching email reminder', async () => {
    const service = new ReplenishmentService({ db });
    const repo = service['repo'];

    // Mark product replenishable
    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });

    // Schedule due reminder for customer WITHOUT email consent
    const sched = await repo.createSchedule(STORE_A_ID, {
      customerEmail: 'no-consent@example.com',
      orderId: 'ord_no_consent',
      productId: PROD_SERUM,
      productTitle: '30-Day Organic Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000), // DUE
      channel: 'email',
    });

    const result = await service.processDueReminders();
    expect(result.cancelled).toBe(1);
    expect(result.sent).toBe(0);

    const updatedSched = await repo.getScheduleById(STORE_A_ID, sched!.id);
    expect(updatedSched?.status).toBe('cancelled');
    expect(updatedSched?.cancel_reason).toContain('consent');
  });

  // 11. WhatsApp consent required & 12. Email and WhatsApp consent remain separate
  it('11 & 12. requires WhatsApp consent and verifies email consent does NOT grant WhatsApp consent', async () => {
    const service = new ReplenishmentService({ db, whatsappProvider: mockWaProvider });
    const repo = service['repo'];

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });
    // Enable WhatsApp in channel settings
    await repo.upsertChannelSettings(STORE_A_ID, { whatsappEnabled: true, emailEnabled: false });

    // Customer has EMAIL consent ONLY
    const vis = await db.query(
      `INSERT INTO visitors (store_id, email, phone, anonymous_id) VALUES ('${STORE_A_ID}', 'cust-separate@example.com', '+447911122233', 'anon-sep') RETURNING id`
    );
    const visitorId = vis.rows[0].id;
    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording) VALUES ('${STORE_A_ID}', '${visitorId}', true, 'Email marketing consent')`
    );

    const sched = await repo.createSchedule(STORE_A_ID, {
      visitorId,
      customerEmail: 'cust-separate@example.com',
      customerPhone: '+447911122233',
      orderId: 'ord_wa_noconsent',
      productId: PROD_SERUM,
      productTitle: '30-Day Organic Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000),
      channel: 'whatsapp',
    });

    const res = await service.processDueReminders();
    expect(res.cancelled).toBe(1);
    expect(res.sent).toBe(0);

    const updatedSched = await repo.getScheduleById(STORE_A_ID, sched!.id);
    expect(updatedSched?.status).toBe('cancelled');
    expect(mockWaProvider.getSentMessages().length).toBe(0);
  });

  // 13. STOP suppresses WhatsApp reminder
  it('13. suppresses WhatsApp reminder if customer sent STOP (consent revoked)', async () => {
    const service = new ReplenishmentService({ db, whatsappProvider: mockWaProvider });
    const repo = service['repo'];

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });
    await repo.upsertChannelSettings(STORE_A_ID, { whatsappEnabled: true, emailEnabled: false });

    // Customer has revoked WhatsApp consent
    await db.query(`
      INSERT INTO whatsapp_consents (store_id, phone_number, opted_in, revoked_at, wording) 
      VALUES ('${STORE_A_ID}', '+447999888777', false, NOW(), 'Opted out via STOP')
    `);

    const sched = await repo.createSchedule(STORE_A_ID, {
      customerPhone: '+447999888777',
      orderId: 'ord_wa_stop',
      productId: PROD_SERUM,
      productTitle: '30-Day Organic Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000),
      channel: 'whatsapp',
    });

    const res = await service.processDueReminders();
    expect(res.cancelled).toBe(1);
    expect(mockWaProvider.getSentMessages().length).toBe(0);

    const updated = await repo.getScheduleById(STORE_A_ID, sched!.id);
    expect(updated?.status).toBe('cancelled');
  });

  // 14. Email unsubscribe suppresses email reminder
  it('14. suppresses email reminder if customer is in suppression_list (unsubscribed/bounced)', async () => {
    const service = new ReplenishmentService({ db });
    const repo = service['repo'];

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });

    // Customer email is in suppression list
    await db.query(`
      INSERT INTO suppression_list (store_id, email, reason) 
      VALUES ('${STORE_A_ID}', 'unsub@example.com', 'user_unsubscribe')
    `);

    // Even if marketing_consents had true in the past, suppression list takes precedence
    const vis = await db.query(
      `INSERT INTO visitors (store_id, email, anonymous_id) VALUES ('${STORE_A_ID}', 'unsub@example.com', 'anon-unsub') RETURNING id`
    );
    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording) VALUES ('${STORE_A_ID}', '${vis.rows[0].id}', true, 'Consented')`
    );

    const sched = await repo.createSchedule(STORE_A_ID, {
      visitorId: vis.rows[0].id,
      customerEmail: 'unsub@example.com',
      orderId: 'ord_email_unsub',
      productId: PROD_SERUM,
      productTitle: '30-Day Organic Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000),
      channel: 'email',
    });

    const res = await service.processDueReminders();
    expect(res.cancelled).toBe(1);

    const updated = await repo.getScheduleById(STORE_A_ID, sched!.id);
    expect(updated?.status).toBe('cancelled');
  });

  // 15. Purchase before reminder suppresses reminder
  it('15. suppresses pending reminder if customer repurchased the product before reminder date', async () => {
    const service = new ReplenishmentService({ db });
    const repo = service['repo'];

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });

    const vis = await db.query(
      `INSERT INTO visitors (store_id, email, anonymous_id) VALUES ('${STORE_A_ID}', 'early-buyer@example.com', 'anon-early') RETURNING id`
    );
    const visitorId = vis.rows[0].id;
    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording) VALUES ('${STORE_A_ID}', '${visitorId}', true, 'Consented')`
    );

    // Initial purchase on Sept 1
    const purchaseDate = new Date('2026-09-01T00:00:00Z');
    const sched = await repo.createSchedule(STORE_A_ID, {
      visitorId,
      customerEmail: 'early-buyer@example.com',
      orderId: 'ord_init_1',
      productId: PROD_SERUM,
      productTitle: '30-Day Organic Face Serum',
      purchasedAt: purchaseDate,
      cycleDays: 30,
      expectedReorderAt: new Date('2026-10-01T00:00:00Z'),
      reminderAt: new Date(Date.now() - 1000), // Due now
      channel: 'email',
    });

    // Customer made another purchase of the serum on Sept 20!
    await db.query(`
      INSERT INTO events (store_id, visitor_id, type, payload, created_at)
      VALUES (
        '${STORE_A_ID}', 
        '${visitorId}', 
        'purchase_completed', 
        '{"email":"early-buyer@example.com","line_items":[{"product_id":"${PROD_SERUM}","variant_id":"var_serum_01","title":"Face Serum"}]}', 
        '${new Date('2026-09-20T00:00:00Z').toISOString()}'
      )
    `);

    const res = await service.processDueReminders();
    expect(res.suppressed).toBe(1);
    expect(res.sent).toBe(0);

    const updated = await repo.getScheduleById(STORE_A_ID, sched!.id);
    expect(updated?.status).toBe('repurchased');
  });

  // 16. Repurchase creates a new cycle & 17. Old cycle is closed/suppressed
  it('16 & 17. repurchasing via webhook supersedes old schedule and initiates a fresh cycle', async () => {
    const service = new ReplenishmentService({ db });
    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30, reminderDaysBefore: 5 });

    const webhookService = new WebhookService();

    // 1st purchase: Jan 1
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 'ord_cycle_1',
      order_number: '101',
      email: 'repeater@example.com',
      created_at: '2026-01-01T00:00:00Z',
      line_items: [
        { product_id: PROD_SERUM, variant_id: 'var_serum_01', title: 'Face Serum', price: 28.50, quantity: 1 }
      ]
    });

    const firstSched = (await db.query(`SELECT * FROM replenishment_schedules WHERE store_id = '${STORE_A_ID}' AND order_id = 'ord_cycle_1'`)).rows[0];
    expect(firstSched.status).toBe('pending');
    expect(new Date(firstSched.expected_reorder_at).toISOString()).toBe('2026-01-31T00:00:00.000Z');

    // 2nd purchase (repurchase): Jan 20
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 'ord_cycle_2',
      order_number: '102',
      email: 'repeater@example.com',
      created_at: '2026-01-20T00:00:00Z',
      line_items: [
        { product_id: PROD_SERUM, variant_id: 'var_serum_01', title: 'Face Serum', price: 28.50, quantity: 1 }
      ]
    });

    // Verify 1st schedule is now marked repurchased (superseded)
    const oldSched = (await db.query(`SELECT * FROM replenishment_schedules WHERE id = '${firstSched.id}'`)).rows[0];
    expect(oldSched.status).toBe('repurchased');
    expect(oldSched.cancel_reason).toContain('Superseded by repurchase');

    // Verify 2nd schedule is now pending with fresh cycle from Jan 20
    const newSched = (await db.query(`SELECT * FROM replenishment_schedules WHERE store_id = '${STORE_A_ID}' AND order_id = 'ord_cycle_2'`)).rows[0];
    expect(newSched.status).toBe('pending');
    expect(newSched.cycle_days).toBe(30);
    // 30 days from Jan 20 = Feb 19
    expect(new Date(newSched.expected_reorder_at).toISOString()).toBe('2026-02-19T00:00:00.000Z');
    // Reminder 5 days before Feb 19 = Feb 14
    expect(new Date(newSched.reminder_at).toISOString()).toBe('2026-02-14T00:00:00.000Z');
  });

  // 18. Reorder link contains correct variant & 19. Reorder link does not expose secrets
  it('18 & 19. generates pre-filled Shopify cart permalink with correct variant without exposing internal secrets', async () => {
    const service = new ReplenishmentService({ db });
    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });

    // Add optional discount code to store channel config
    await service['repo'].upsertChannelSettings(STORE_A_ID, { discountCode: 'LOYALTY10' });

    const webhookService = new WebhookService();
    await webhookService.processOrderWebhook('london-eco.myshopify.com', {
      id: 'ord_link_test',
      order_number: '5555',
      email: 'linkcheck@example.com',
      line_items: [
        { product_id: PROD_SERUM, variant_id: 'var_serum_01', title: 'Face Serum', price: 28.50, quantity: 1 }
      ]
    });

    const sched = (await db.query(`SELECT * FROM replenishment_schedules WHERE store_id = '${STORE_A_ID}' AND order_id = 'ord_link_test'`)).rows[0];
    const permalink = sched.reorder_checkout_url;

    // Must lead to shop domain /cart/variant:1 with discount code
    expect(permalink).toContain('https://london-eco.myshopify.com/cart/var_serum_01:1?discount=LOYALTY10');
    // Must NOT contain store_id, admin tokens, passwords, or DB secrets
    expect(permalink).not.toContain(STORE_A_ID);
    expect(permalink).not.toContain('admin');
    expect(permalink).not.toContain('secret');
    expect(permalink).not.toContain('token');
  });

  // 20. Store A cannot access Store B schedules (Tenant Isolation)
  it('20. strictly isolates schedules: Store A cannot access Store B replenishment schedules', async () => {
    const service = new ReplenishmentService({ db });
    await service['repo'].createSchedule(STORE_B_ID, {
      customerEmail: 'storeb-cust@example.com',
      orderId: 'ord_b_private',
      productId: 'prod_b_oil',
      productTitle: 'Highland Beard Oil',
      purchasedAt: new Date(),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 30 * 86400000),
      reminderAt: new Date(Date.now() + 25 * 86400000),
    });

    // Store A tries to view Store B's schedules
    const resForbidden = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/replenishment/schedules`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resForbidden.status).toBe(403);

    // Store A views its own schedules
    const resA = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/replenishment/schedules`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resA.status).toBe(200);
    const foundBInA = resA.body.data.schedules.some((s: any) => s.store_id === STORE_B_ID);
    expect(foundBInA).toBe(false);
  });

  // 21. Store A cannot modify Store B settings (Tenant Isolation)
  it('21. prevents cross-tenant modifications: Store A cannot alter Store B replenishment settings', async () => {
    const resForbidden = await request(app)
      .put(`/api/v1/dashboard/${STORE_B_ID}/replenishment/products/prod_b_oil`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ replenishable: true, cycleDays: 60 });

    expect(resForbidden.status).toBe(403);

    // Check in DB: Store B's product was NOT altered
    const checkB = await db.query(`SELECT * FROM replenishment_product_settings WHERE store_id = '${STORE_B_ID}'`);
    expect(checkB.rows.length).toBe(0);
  });

  // 22. Duplicate reminder cannot send twice (Idempotency)
  it('22. enforces idempotency: sent reminder cannot be processed or sent a second time', async () => {
    const service = new ReplenishmentService({ db });
    const repo = service['repo'];

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });

    const vis = await db.query(
      `INSERT INTO visitors (store_id, email, anonymous_id) VALUES ('${STORE_A_ID}', 'once@example.com', 'anon-once') RETURNING id`
    );
    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording) VALUES ('${STORE_A_ID}', '${vis.rows[0].id}', true, 'Consent')`
    );

    await repo.createSchedule(STORE_A_ID, {
      visitorId: vis.rows[0].id,
      customerEmail: 'once@example.com',
      orderId: 'ord_once_1',
      productId: PROD_SERUM,
      productTitle: '30-Day Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000), // Due
      channel: 'email',
    });

    // 1st run: sends reminder
    const run1 = await service.processDueReminders();
    expect(run1.sent).toBe(1);

    // 2nd run: no due reminders remain
    const run2 = await service.processDueReminders();
    expect(run2.processed).toBe(0);
    expect(run2.sent).toBe(0);
  });

  // 23. Provider failures are handled safely
  it('23. handles provider failures gracefully without crashing the worker', async () => {
    const failingEmailProvider = {
      sendEmail: async () => { throw new Error('SMTP connection timeout'); },
      createSenderDomain: async () => ({} as any),
      getSenderDomain: async () => ({} as any),
      verifySenderDomain: async () => ({} as any),
    };

    const service = new ReplenishmentService({ db, emailProvider: failingEmailProvider });
    const repo = service['repo'];

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });

    const vis = await db.query(
      `INSERT INTO visitors (store_id, email, anonymous_id) VALUES ('${STORE_A_ID}', 'fail@example.com', 'anon-fail') RETURNING id`
    );
    await db.query(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording) VALUES ('${STORE_A_ID}', '${vis.rows[0].id}', true, 'Consent')`
    );

    const sched = await repo.createSchedule(STORE_A_ID, {
      visitorId: vis.rows[0].id,
      customerEmail: 'fail@example.com',
      orderId: 'ord_fail_1',
      productId: PROD_SERUM,
      productTitle: '30-Day Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000),
      channel: 'email',
    });

    const res = await service.processDueReminders();
    // Handled safely
    expect(res.sent).toBe(0);
    // Worker does not crash
    expect(sched).toBeDefined();
  });

  // 24. Meta WhatsApp provider continues working
  it('24. dispatches WhatsApp reorder reminder when Meta WhatsApp channel is active and consented', async () => {
    const service = new ReplenishmentService({ db, whatsappProvider: mockWaProvider });
    const repo = service['repo'];

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });
    await repo.upsertChannelSettings(STORE_A_ID, { whatsappEnabled: true, emailEnabled: false });

    // Connected Meta WhatsApp config
    await db.query(`
      INSERT INTO whatsapp_configs (store_id, provider, phone_number_id, status)
      VALUES ('${STORE_A_ID}', 'meta', 'phone_meta_123', 'connected')
      ON CONFLICT (store_id) DO UPDATE SET provider = 'meta', status = 'connected'
    `);

    // Active consented WhatsApp user
    await db.query(`
      INSERT INTO whatsapp_consents (store_id, phone_number, opted_in, wording) 
      VALUES ('${STORE_A_ID}', '+447111222333', true, 'Consented to WhatsApp')
    `);

    await repo.createSchedule(STORE_A_ID, {
      customerPhone: '+447111222333',
      orderId: 'ord_meta_wa_1',
      productId: PROD_SERUM,
      productTitle: '30-Day Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000),
      channel: 'whatsapp',
      reorderCheckoutUrl: 'https://london-eco.myshopify.com/cart/var_serum_01:1',
    });

    const res = await service.processDueReminders();
    expect(res.sent).toBe(1);

    const sentMessages = mockWaProvider.getSentMessages();
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].to).toBe('+447111222333');
    expect(sentMessages[0].message.text.body).toContain('30-Day Face Serum');
    expect(sentMessages[0].message.text.body).toContain('https://london-eco.myshopify.com/cart/var_serum_01:1');
  });

  // 25. WATI provider continues working if configured
  it('25. routes reorder reminder through WATI provider when store is configured for WATI', async () => {
    const service = new ReplenishmentService({ db, whatsappProvider: mockWaProvider });
    const repo = service['repo'];

    // Configure store for WATI provider
    await db.query(`
      INSERT INTO whatsapp_configs (store_id, provider, display_phone_number, wati_api_endpoint, status)
      VALUES ('${STORE_A_ID}', 'wati', '+447222333444', 'https://live-server-wati.wati.io', 'connected')
      ON CONFLICT (store_id) DO UPDATE SET provider = 'wati', status = 'connected'
    `);

    await service.configureProduct(STORE_A_ID, PROD_SERUM, { replenishable: true, cycleDays: 30 });
    await repo.upsertChannelSettings(STORE_A_ID, { whatsappEnabled: true, emailEnabled: false });

    await db.query(`
      INSERT INTO whatsapp_consents (store_id, phone_number, opted_in, wording) 
      VALUES ('${STORE_A_ID}', '+447222333444', true, 'WATI consent')
    `);

    await repo.createSchedule(STORE_A_ID, {
      customerPhone: '+447222333444',
      orderId: 'ord_wati_1',
      productId: PROD_SERUM,
      productTitle: 'Face Serum',
      purchasedAt: new Date(Date.now() - 30 * 86400000),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 5 * 86400000),
      reminderAt: new Date(Date.now() - 3600000),
      channel: 'whatsapp',
    });

    const res = await service.processDueReminders();
    expect(res.sent).toBe(1);
    expect(mockWaProvider.getSentMessages().length).toBe(1);
  });

  // 26. Mock providers work in tests & Analytics summary
  it('26. provides accurate replenishment metrics & analytics in merchant dashboard', async () => {
    const service = new ReplenishmentService({ db });
    const repo = service['repo'];

    // Create 1 pending, 1 sent, 1 repurchased schedule
    await repo.createSchedule(STORE_A_ID, {
      customerEmail: 'active1@example.com',
      orderId: 'ord_an_1',
      productId: PROD_SERUM,
      productTitle: 'Serum',
      purchasedAt: new Date(),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 30 * 86400000),
      reminderAt: new Date(Date.now() + 2 * 86400000), // Upcoming in 2 days
    });

    const sentSched = await repo.createSchedule(STORE_A_ID, {
      customerEmail: 'sent@example.com',
      orderId: 'ord_an_2',
      productId: PROD_SERUM,
      productTitle: 'Serum',
      purchasedAt: new Date(),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 30 * 86400000),
      reminderAt: new Date(Date.now() - 86400000),
    });
    await repo.updateScheduleStatus(STORE_A_ID, sentSched!.id, 'sent');

    const repurchasedSched = await repo.createSchedule(STORE_A_ID, {
      customerEmail: 'converted@example.com',
      orderId: 'ord_an_3',
      productId: PROD_SERUM,
      productTitle: 'Serum',
      purchasedAt: new Date(),
      cycleDays: 30,
      expectedReorderAt: new Date(Date.now() + 30 * 86400000),
      reminderAt: new Date(Date.now() - 86400000),
    });
    await repo.updateScheduleStatus(STORE_A_ID, repurchasedSched!.id, 'repurchased');

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/replenishment/analytics`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.activeSchedules).toBe(1);
    expect(res.body.data.upcomingReminders).toBe(1);
    expect(res.body.data.remindersSent).toBe(1);
    expect(res.body.data.reordersCompleted).toBe(1);
    expect(res.body.data.conversionRate).toBe(100);
  });
});
