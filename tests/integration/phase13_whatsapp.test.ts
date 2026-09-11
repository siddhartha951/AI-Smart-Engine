import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { MockWhatsAppProvider } from '../../src/providers/whatsapp/mock.whatsapp.provider';
import { setWhatsAppProvider } from '../../src/providers/whatsapp';
import { decryptString } from '../../src/utils/crypto';

describe('Phase 13: WhatsApp Growth Engine & Multi-Tenant Isolation', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let mockWaProvider: MockWhatsAppProvider;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // London Eco Apparel
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Highland Peak Gear

  const PHONE_NUMBER_ID_A = 'phone_id_store_a_1001';
  const PHONE_NUMBER_ID_B = 'phone_id_store_b_2002';
  const VERIFY_TOKEN_A = 'secret_verify_token_a';
  const VERIFY_TOKEN_B = 'secret_verify_token_b';

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    mockWaProvider = new MockWhatsAppProvider();
    setWhatsAppProvider(mockWaProvider);

    app = createApp({ db });

    // Seed products for Store A
    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, currency, in_stock, category)
      VALUES 
        ('prod_wa_a_1', '${STORE_A_ID}', 'prod_wa_a_1', 'var_wa_a_1', 'Eco Organic T-Shirt', 'eco-organic-t-shirt', 29.99, 'GBP', true, 'apparel'),
        ('prod_wa_a_2', '${STORE_A_ID}', 'prod_wa_a_2', 'var_wa_a_2', 'Recycled Canvas Tote', 'recycled-canvas-tote', 15.00, 'GBP', true, 'accessories')
    `);

    // Login Store A
    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    // Login Store B
    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    tokenB = resB.body.token;
  });

  afterEach(async () => {
    mockWaProvider.clear();
    await db.close();
  });

  // 1. WhatsApp Configuration Saving & AES-256-GCM Encryption at Rest
  it('1. saves WhatsApp config and encrypts permanent access token at rest with AES-256-GCM', async () => {
    const rawSecretToken = 'EAABwzL_meta_permanent_access_token_1234567890_secret';

    const res = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        wabaId: 'waba_id_store_a',
        displayPhoneNumber: '+447911123456',
        accessToken: rawSecretToken,
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.phone_number_id).toBe(PHONE_NUMBER_ID_A);

    // Verify in database: access token must NOT be stored in plain text
    const dbRow = await db.query(`SELECT * FROM whatsapp_configs WHERE store_id = '${STORE_A_ID}'`);
    expect(dbRow.rows.length).toBe(1);
    const config = dbRow.rows[0];
    expect(config.encrypted_access_token).toBeDefined();
    expect(config.encrypted_access_token).not.toBe(rawSecretToken);
    expect(config.encrypted_access_token).not.toContain(rawSecretToken);

    // Verify it decrypts back correctly
    const decrypted = decryptString(config.encrypted_access_token);
    expect(decrypted).toBe(rawSecretToken);
  });

  // 2. Secret Masking on Retrieval
  it('2. never exposes plain text access token in API responses', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'super_secret_raw_token_xyz',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.encrypted_access_token).toBeUndefined();
    expect(res.body.data.access_token).toBeUndefined();
    expect(res.body.data.phone_number_id).toBe(PHONE_NUMBER_ID_A);
  });

  // 3. Multi-Tenant RBAC & Cross-Tenant Protection
  it('3. strictly prevents Merchant A from viewing or modifying Store B WhatsApp configuration', async () => {
    // Configure Store B with Merchant B
    await request(app)
      .put(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_B,
        accessToken: 'token_b_secret',
        webhookVerifyToken: VERIFY_TOKEN_B
      });

    // Merchant A tries to GET Store B config
    const resGet = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resGet.status).toBe(403);

    // Merchant A tries to PUT Store B config
    const resPut = await request(app)
      .put(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: 'hacked_id',
        accessToken: 'hacked_token'
      });
    expect(resPut.status).toBe(403);
  });

  // 4. Webhook Challenge Verification (GET hub.challenge)
  it('4. verifies Meta webhook challenge with correct hub.verify_token and returns challenge integer', async () => {
    // Setup config for Store A
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const challenge = '1158201444';
    const res = await request(app)
      .get('/api/v1/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN_A,
        'hub.challenge': challenge
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe(challenge);
  });

  // 5. Webhook Challenge Verification Rejection
  it('5. rejects webhook challenge with 403 if hub.verify_token is invalid or missing', async () => {
    const res = await request(app)
      .get('/api/v1/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_invalid_token',
        'hub.challenge': '12345'
      });

    expect(res.status).toBe(403);
  });

  // 6. Inbound Webhook Message Ingestion & Conversation Creation
  it('6. ingests inbound customer message, links to store by phone_number_id, and records conversation', async () => {
    // Setup Store A config
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const customerPhone = '+447911000111';
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+447911123456',
                  phone_number_id: PHONE_NUMBER_ID_A
                },
                contacts: [{ profile: { name: 'Alice Customer' }, wa_id: customerPhone }],
                messages: [
                  {
                    from: customerPhone,
                    id: 'wamid_msg_test_001',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'Hello, do you sell organic t-shirts?' }
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    const res = await request(app)
      .post('/api/v1/webhooks/whatsapp')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');

    // Verify conversation created for Store A
    const convsRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/conversations`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(convsRes.status).toBe(200);
    expect(convsRes.body.data.conversations.length).toBe(1);
    const conv = convsRes.body.data.conversations[0];
    expect(conv.phone_number).toBe(customerPhone);

    // Verify messages: inbound was saved and AI generated an outbound response
    const msgsRes = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/messages?conversationId=${conv.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(msgsRes.status).toBe(200);
    expect(msgsRes.body.data.messages.length).toBe(2);
    const inboundMsg = msgsRes.body.data.messages.find((m: any) => m.direction === 'inbound');
    const outboundMsg = msgsRes.body.data.messages.find((m: any) => m.direction === 'outbound');

    expect(inboundMsg.content).toContain('organic t-shirts');
    expect(outboundMsg.content).toBeDefined();
    // Outbound response was dispatched via mock WhatsApp provider
    expect(mockWaProvider.sentMessages.length).toBe(1);
    expect(mockWaProvider.sentMessages[0].to).toBe(customerPhone);
  });

  // 7. Webhook Idempotency & Message Deduplication
  it('7. deduplicates identical webhook event by wamid without duplicate processing', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const customerPhone = '+447911000222';
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+447911123456',
                  phone_number_id: PHONE_NUMBER_ID_A
                },
                contacts: [{ profile: { name: 'Bob' }, wa_id: customerPhone }],
                messages: [
                  {
                    from: customerPhone,
                    id: 'wamid_dedup_001',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'First delivery' }
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    // First POST
    const res1 = await request(app).post('/api/v1/webhooks/whatsapp').send(payload);
    expect(res1.status).toBe(200);
    expect(mockWaProvider.sentMessages.length).toBe(1);

    // Second duplicate POST with exact same wamid
    const res2 = await request(app).post('/api/v1/webhooks/whatsapp').send(payload);
    expect(res2.status).toBe(200);

    // Should NOT have triggered a second AI outbound reply
    expect(mockWaProvider.sentMessages.length).toBe(1);

    // Database webhook_events table recorded event
    const events = await db.query(`SELECT * FROM whatsapp_webhook_events WHERE event_id = 'wamid_dedup_001'`);
    expect(events.rows.length).toBe(1);
  });

  // 8. Keyword Opt-Out ("STOP")
  it('8. immediately revokes consent when customer texts STOP and suppresses marketing recovery', async () => {
    // 1. Setup config
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const customerPhone = '+447911000333';

    // 2. Pre-create active consent for customer
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/opt-in`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumber: customerPhone,
        source: 'storefront_widget',
        consentWording: 'I agree to WhatsApp notifications'
      });

    // Verify consent is active
    const consentBefore = await db.query(`SELECT * FROM whatsapp_consents WHERE phone_number = '${customerPhone}'`);
    expect(consentBefore.rows[0].opted_in).toBe(true);

    // 3. Customer sends "STOP" via webhook
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  phone_number_id: PHONE_NUMBER_ID_A
                },
                contacts: [{ wa_id: customerPhone }],
                messages: [
                  {
                    from: customerPhone,
                    id: 'wamid_stop_001',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'STOP' }
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    await request(app).post('/api/v1/webhooks/whatsapp').send(payload);

    // Verify latest consent status is now revoked (opted_in = false)
    const consentAfter = await db.query(`SELECT * FROM whatsapp_consents WHERE phone_number = '${customerPhone}' ORDER BY captured_at DESC LIMIT 1`);
    expect(consentAfter.rows[0].opted_in).toBe(false);

    // Confirmation message sent advising how to resume
    const lastSent = mockWaProvider.sentMessages[mockWaProvider.sentMessages.length - 1];
    expect(lastSent.text).toContain('unsubscribed');
    expect(lastSent.text).toContain('START');
  });

  // 9. Keyword Opt-In ("START")
  it('9. restores active consent when customer texts START', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const customerPhone = '+447911000444';

    // Start with revoked consent
    await db.query(`
      INSERT INTO whatsapp_consents (store_id, phone_number, wording, source, opted_in, revoked_at)
      VALUES ('${STORE_A_ID}', '${customerPhone}', 'Previous consent', 'widget', false, NOW())
    `);

    // Customer sends "START"
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  phone_number_id: PHONE_NUMBER_ID_A
                },
                contacts: [{ wa_id: customerPhone }],
                messages: [
                  {
                    from: customerPhone,
                    id: 'wamid_start_001',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'START' }
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    await request(app).post('/api/v1/webhooks/whatsapp').send(payload);

    const consentAfter = await db.query(`SELECT * FROM whatsapp_consents WHERE phone_number = '${customerPhone}' ORDER BY captured_at DESC LIMIT 1`);
    expect(consentAfter.rows[0].opted_in).toBe(true);
  });

  // 10. Abandoned Cart Recovery (Consented vs Unconsented)
  it('10. recovers cart for consented shopper, but strictly suppresses recovery for unconsented shopper', async () => {
    // Configure Store A
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const consentedPhone = '+447911000555';
    const unconsentedPhone = '+447911000666';

    // Give consent to consentedPhone only
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/opt-in`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumber: consentedPhone,
        source: 'checkout',
        consentWording: 'Consent to cart reminders'
      });

    // 1. Schedule & process recovery job for consented shopper
    const resSchedule1 = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/schedule`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        checkoutToken: 'tok_consented_1',
        customerPhone: consentedPhone,
        cartItems: [{ title: 'Eco Organic T-Shirt', price: 29.99, quantity: 1 }],
        recoveryUrl: 'https://store-a.com/checkouts/tok_consented_1'
      });

    expect(resSchedule1.status).toBe(201);
    const jobId1 = resSchedule1.body.data.id;

    // Process recovery job
    const resProc1 = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/${jobId1}/process`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resProc1.status).toBe(200);
    expect(resProc1.body.data.status).toBe('sent');
    expect(mockWaProvider.sentMessages.some((m: any) => m.to === consentedPhone)).toBe(true);

    // 2. Schedule & process recovery job for unconsented shopper
    const resSchedule2 = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/schedule`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        checkoutToken: 'tok_unconsented_2',
        customerPhone: unconsentedPhone,
        cartItems: [{ title: 'Eco Organic T-Shirt', price: 29.99, quantity: 1 }],
        recoveryUrl: 'https://store-a.com/checkouts/tok_unconsented_2'
      });

    expect(resSchedule2.status).toBe(201);
    const jobId2 = resSchedule2.body.data.id;

    const resProc2 = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/${jobId2}/process`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resProc2.status).toBe(200);
    expect(resProc2.body.data.status).toBe('skipped');
    expect(resProc2.body.data.skipped_reason).toContain('No active opt-in consent');
    expect(mockWaProvider.sentMessages.some((m: any) => m.to === unconsentedPhone)).toBe(false);
  });

  // 11. Cart Recovery Suppression when Order Completed
  it('11. suppresses cart recovery if customer completed purchase or cart is empty', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const customerPhone = '+447911000777';
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/opt-in`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ phoneNumber: customerPhone, consentWording: 'Consent' });

    // Schedule job
    const resSched = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/schedule`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        checkoutToken: 'tok_completed_cart',
        customerPhone,
        cartItems: [{ title: 'Canvas Tote', price: 15.00, quantity: 1 }],
        recoveryUrl: 'https://store-a.com/checkout'
      });

    expect(resSched.status).toBe(201);
    const jobId = resSched.body.data.id;

    // Simulate order already completed via events table
    const visRes = await db.query(`INSERT INTO visitors (store_id, anonymous_id, phone) VALUES ('${STORE_A_ID}', 'anon_${customerPhone}', '${customerPhone}') RETURNING id`);
    const visId = visRes.rows[0].id;
    await db.query(`
      INSERT INTO events (store_id, visitor_id, type, payload, created_at)
      VALUES ('${STORE_A_ID}', '${visId}', 'purchase_completed', '{"phone": "${customerPhone}", "checkout_token": "tok_completed_cart"}', NOW())
    `);

    // Process job
    const resProc = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/${jobId}/process`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resProc.status).toBe(200);
    expect(resProc.body.data.status).toBe('skipped');
    expect(resProc.body.data.skipped_reason).toContain('Order already completed');
  });

  // 12. Cart Recovery Idempotency
  it('12. enforces idempotency: already recovered cart is not dispatched repeatedly', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const customerPhone = '+447911000888';
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/opt-in`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ phoneNumber: customerPhone, consentWording: 'Consent' });

    const resSched = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/schedule`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        checkoutToken: 'tok_idempotent_1',
        customerPhone,
        cartItems: [{ title: 'T-Shirt', price: 29.99, quantity: 1 }],
        recoveryUrl: 'https://store-a.com'
      });
    const jobId = resSched.body.data.id;

    // Process 1st time
    await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/${jobId}/process`)
      .set('Authorization', `Bearer ${tokenA}`);

    const countBefore = mockWaProvider.sentMessages.length;

    // Process 2nd time immediately
    const resProc2 = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/${jobId}/process`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resProc2.status).toBe(200);
    expect(mockWaProvider.sentMessages.length).toBe(countBefore); // No new message sent
  });

  // 13. Order Notification via Shopify Webhook
  it('13. dispatches order confirmation WhatsApp message when order webhook arrives with customer phone', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const customerPhone = '+447911999888';

    const orderPayload = {
      id: 99887766,
      name: '#1001',
      total_price: '44.99',
      currency: 'GBP',
      billing_address: {
        phone: customerPhone
      },
      line_items: [
        { title: 'Eco Organic T-Shirt', quantity: 1, price: '29.99' },
        { title: 'Recycled Canvas Tote', quantity: 1, price: '15.00' }
      ]
    };

    const payloadString = JSON.stringify(orderPayload);
    const secret = process.env.SHOPIFY_CLIENT_SECRET || 'test_shopify_secret_change_in_production';
    const hash = crypto.createHmac('sha256', secret).update(payloadString, 'utf8').digest('base64');

    // Trigger shopify orders webhook
    const res = await request(app)
      .post('/api/v1/shopify/webhooks/orders')
      .set('X-Shopify-Topic', 'orders/create')
      .set('X-Shopify-Shop-Domain', 'london-eco.myshopify.com')
      .set('X-Shopify-Hmac-Sha256', hash)
      .set('Content-Type', 'application/json')
      .send(payloadString);

    expect(res.status).toBe(200);

    // Verify WhatsApp order notification was dispatched
    const orderMsg = mockWaProvider.sentMessages.find((m: any) => m.to === customerPhone);
    expect(orderMsg).toBeDefined();
    expect(orderMsg.text).toContain('#1001');
    expect(orderMsg.text).toContain('44.99');
  });

  // 14. Multi-Tenant Conversation Isolation
  it('14. verifies Store A cannot access Store B conversations or messages', async () => {
    // Configure Store B
    await request(app)
      .put(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_B,
        accessToken: 'token_b',
        webhookVerifyToken: VERIFY_TOKEN_B
      });

    const convBId = '11111111-2222-3333-4444-555555555555';
    // Seed conversation for Store B
    await db.query(`
      INSERT INTO whatsapp_conversations (id, store_id, phone_number, last_message_at)
      VALUES ('${convBId}', '${STORE_B_ID}', '+447999888777', NOW())
    `);

    // Merchant A requests Store B conversations -> 403
    const resConv = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/conversations`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resConv.status).toBe(403);

    // Merchant A requests Store B messages -> 403
    const resMsg = await request(app)
      .get(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/messages?conversationId=${convBId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resMsg.status).toBe(403);
  });

  // 15. Manual Test Message Dispatch
  it('15. allows merchant to dispatch a test WhatsApp notification to verify API connectivity', async () => {
    await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumberId: PHONE_NUMBER_ID_A,
        accessToken: 'token_a',
        webhookVerifyToken: VERIFY_TOKEN_A
      });

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/test`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ toPhone: '+447123456789' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.wamid).toBeDefined();
    expect(mockWaProvider.sentMessages.some((m: any) => m.to === '+447123456789')).toBe(true);
  });

  // 16. Manual Consent Revocation
  it('16. allows merchant to manually revoke customer WhatsApp consent via dashboard', async () => {
    const resOptIn = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/opt-in`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        phoneNumber: '+447911000999',
        source: 'manual',
        consentWording: 'Opted in at event'
      });

    expect(resOptIn.status).toBe(201);
    const consentId = resOptIn.body.data.id;

    // Merchant revokes consent
    const resRevoke = await request(app)
      .delete(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/consents/${consentId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(resRevoke.status).toBe(200);
    expect(resRevoke.body.success).toBe(true);

    const check = await db.query(`SELECT opted_in, revoked_at FROM whatsapp_consents WHERE id = '${consentId}'`);
    expect(check.rows[0].opted_in).toBe(false);
    expect(check.rows[0].revoked_at).toBeDefined();
  });

  // 17. Analytics Endpoint Aggregates
  it('17. accurately aggregates WhatsApp metrics for conversations, messages, recoveries, and consents', async () => {
    const convId = 'aaaaaaaa-1111-2222-3333-444444444444';
    // Seed 1 active conversation, 2 messages, 1 recovery job, 1 consent
    await db.query(`
      INSERT INTO whatsapp_conversations (id, store_id, phone_number, status)
      VALUES ('${convId}', '${STORE_A_ID}', '+447000111222', 'active')
    `);

    await db.query(`
      INSERT INTO whatsapp_messages (store_id, conversation_id, direction, content)
      VALUES 
        ('${STORE_A_ID}', '${convId}', 'inbound', 'Hi'),
        ('${STORE_A_ID}', '${convId}', 'outbound', 'Hello')
    `);

    await db.query(`
      INSERT INTO whatsapp_consents (store_id, phone_number, wording, source, opted_in)
      VALUES ('${STORE_A_ID}', '+447000111222', 'Consent', 'widget', true)
    `);

    await db.query(`
      INSERT INTO whatsapp_recovery_jobs (store_id, phone_number, product_title, idempotency_key, status)
      VALUES ('${STORE_A_ID}', '+447000111222', 'Organic Tee', 'tok_recovered_1', 'sent')
    `);

    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/analytics`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.active_conversations).toBe(1);
    expect(res.body.data.inbound_messages).toBe(1);
    expect(res.body.data.outbound_messages).toBe(1);
    expect(res.body.data.recovered_carts).toBe(1);
    expect(res.body.data.consented_contacts).toBe(1);
  });
});
