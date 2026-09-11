import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { WatiWhatsAppProvider } from '../../src/providers/whatsapp/wati.whatsapp.provider';
import { MockWhatsAppProvider } from '../../src/providers/whatsapp/mock.whatsapp.provider';
import { MetaWhatsAppCloudProvider } from '../../src/providers/whatsapp/meta.whatsapp.provider';
import { getWhatsAppProvider, setWhatsAppProvider, setWhatsAppProviderForType } from '../../src/providers/whatsapp';
import { decryptString } from '../../src/utils/crypto';

describe('Phase 13 Extension: WATI WhatsApp Provider Integration', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // London Eco Apparel (WATI)
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Highland Peak Gear (Meta)

  const WATI_ENDPOINT = 'https://live-server-100500.wati.io';
  const WATI_TOKEN_RAW = 'wati_secret_bearer_token_abc_123_456_789';
  const WATI_VERIFY_TOKEN = 'secret_wati_verify_token_store_a';

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    // Reset provider overrides before each test
    setWhatsAppProvider(null);
    setWhatsAppProviderForType('wati', null);
    setWhatsAppProviderForType('meta', null);
    setWhatsAppProviderForType('mock', null);

    app = createApp({ db });

    // Seed products for Store A
    await db.query(`
      INSERT INTO products (id, store_id, shopify_id, variant_id, title, handle, price, currency, in_stock, category)
      VALUES 
        ('prod_wati_a_1', '${STORE_A_ID}', 'prod_wati_a_1', 'var_wati_a_1', 'Eco Organic T-Shirt', 'eco-organic-t-shirt', 29.99, 'GBP', true, 'apparel'),
        ('prod_wati_a_2', '${STORE_A_ID}', 'prod_wati_a_2', 'var_wati_a_2', 'Recycled Canvas Tote', 'recycled-canvas-tote', 15.00, 'GBP', true, 'accessories')
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
    setWhatsAppProvider(null);
    setWhatsAppProviderForType('wati', null);
    setWhatsAppProviderForType('meta', null);
    setWhatsAppProviderForType('mock', null);
    vi.restoreAllMocks();
    await db.close();
  });

  // =========================================================================
  // 1. WATI Provider Class & Protocol Normalization
  // =========================================================================

  describe('1. WatiWhatsAppProvider Unit Logic', () => {
    it('1.1 correctly initializes provider and implements IWhatsAppProvider interface', () => {
      const provider = new WatiWhatsAppProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.sendMessage).toBe('function');
      expect(typeof provider.verifyWebhookChallenge).toBe('function');
      expect(typeof provider.validateSignature).toBe('function');
      expect(typeof provider.parseWebhook).toBe('function');
    });

    it('1.2 validates missing endpoint, access token, or recipient phone number', async () => {
      const provider = new WatiWhatsAppProvider();

      // Missing endpoint & token
      const res1 = await provider.sendMessage({
        to: '+447911123456',
        message: { type: 'text', text: { body: 'Hello' } },
      });
      expect(res1.success).toBe(false);
      expect(res1.statusCode).toBe(401);
      expect(res1.error).toContain('Missing WATI API Endpoint URL or Access Token');

      // Missing recipient phone
      const res2 = await provider.sendMessage({
        apiEndpoint: WATI_ENDPOINT,
        accessToken: WATI_TOKEN_RAW,
        to: '',
        message: { type: 'text', text: { body: 'Hello' } },
      });
      expect(res2.success).toBe(false);
      expect(res2.statusCode).toBe(400);
      expect(res2.error).toContain('Recipient phone number is required');
    });

    it('1.3 formats session message URL and Bearer authorization correctly', async () => {
      const provider = new WatiWhatsAppProvider();
      let capturedUrl = '';
      let capturedHeaders: any = {};
      let capturedBody: any = null;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers;
        capturedBody = init?.body ? JSON.parse(init.body) : null;
        return new Response(JSON.stringify({
          result: 'success',
          whatsappMessageId: 'wati_msg_session_9988',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      const res = await provider.sendMessage({
        apiEndpoint: `${WATI_ENDPOINT}/`, // trailing slash should be cleaned
        accessToken: WATI_TOKEN_RAW,
        channelPhoneNumber: '+44 7911 000000',
        to: '+44 (7911) 123-456', // non-digits should be stripped
        message: {
          type: 'text',
          text: { body: 'Hello from AI Smart Engine!' },
        },
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('wati_msg_session_9988');
      expect(capturedUrl).toBe(`${WATI_ENDPOINT}/api/v1/sendSessionMessage/447911123456?messageText=Hello%20from%20AI%20Smart%20Engine!`);
      expect(capturedHeaders['Authorization']).toBe(`Bearer ${WATI_TOKEN_RAW}`);
      expect(capturedBody).toEqual({ channelPhoneNumber: '447911000000' });
    });

    it('1.4 formats template message API request correctly', async () => {
      const provider = new WatiWhatsAppProvider();
      let capturedUrl = '';
      let capturedBody: any = null;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        capturedUrl = String(url);
        capturedBody = init?.body ? JSON.parse(init.body) : null;
        return new Response(JSON.stringify({
          result: 'success',
          whatsappMessageId: 'wati_msg_tmpl_7766',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      const res = await provider.sendMessage({
        apiEndpoint: WATI_ENDPOINT,
        accessToken: WATI_TOKEN_RAW,
        to: '+1-555-432-1098',
        message: {
          type: 'template',
          template: {
            name: 'order_update_v1',
            language: { code: 'en_US' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Alice' },
                  { type: 'text', text: '#1024' },
                ],
              },
            ],
          },
        },
      });

      expect(res.success).toBe(true);
      expect(res.messageId).toBe('wati_msg_tmpl_7766');
      expect(capturedUrl).toBe(`${WATI_ENDPOINT}/api/v1/sendTemplateMessage?whatsappNumber=15554321098`);
      expect(capturedBody.template_name).toBe('order_update_v1');
      expect(capturedBody.parameters).toEqual([
        { name: 'param_1', value: 'Alice' },
        { name: 'param_2', value: '#1024' },
      ]);
    });

    it('1.5 handles WATI API errors and HTTP failure codes gracefully', async () => {
      const provider = new WatiWhatsAppProvider();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded or quota exhausted',
          info: 'Payment required',
        }), { status: 429, headers: { 'Content-Type': 'application/json' } });
      });

      const res = await provider.sendMessage({
        apiEndpoint: WATI_ENDPOINT,
        accessToken: WATI_TOKEN_RAW,
        to: '+447911123456',
        message: { type: 'text', text: { body: 'Ping' } },
      });

      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(429);
      expect(res.error).toContain('WATI API error (429)');
      expect(res.error).toContain('Payment required');
    });

    it('1.6 normalizes inbound customer messages in parseWebhook', () => {
      const provider = new WatiWhatsAppProvider();

      const watiPayload = {
        eventType: 'message',
        waId: '447911123456',
        senderName: 'John Doe',
        text: 'Do you have sustainable hoodies in stock?',
        whatsappMessageId: 'wati_inbound_1001',
        channelPhoneNumber: '+447911000000',
        timestamp: '1726056000',
      };

      const events = provider.parseWebhook(watiPayload);
      expect(events.length).toBe(1);
      const evt = events[0];
      expect(evt.customerName).toBe('John Doe');
      expect(evt.displayPhoneNumber).toBe('+447911000000');
      expect(evt.message?.from).toBe('+447911123456');
      expect(evt.message?.messageId).toBe('wati_inbound_1001');
      expect(evt.message?.text).toBe('Do you have sustainable hoodies in stock?');
    });

    it('1.7 normalizes delivery and read receipts in parseWebhook', () => {
      const provider = new WatiWhatsAppProvider();

      // Delivered receipt
      const deliveredPayload = {
        eventType: 'sentMessageDELIVERED_v2',
        whatsappMessageId: 'wati_msg_session_9988',
        channelPhoneNumber: '+447911000000',
        timestamp: '1726056100',
      };
      const events1 = provider.parseWebhook(deliveredPayload);
      expect(events1.length).toBe(1);
      expect(events1[0].status?.messageId).toBe('wati_msg_session_9988');
      expect(events1[0].status?.status).toBe('delivered');

      // Read receipt
      const readPayload = {
        eventType: 'sentMessageREAD_v2',
        whatsappMessageId: 'wati_msg_session_9988',
        channelPhoneNumber: '+447911000000',
        timestamp: '1726056200',
      };
      const events2 = provider.parseWebhook(readPayload);
      expect(events2.length).toBe(1);
      expect(events2[0].status?.status).toBe('read');
    });

    it('1.8 verifies signature/secret using timingSafeEqual', () => {
      const provider = new WatiWhatsAppProvider();
      const secret = 'my_super_secret_key_12345';

      expect(provider.validateSignature(Buffer.from(''), secret, secret)).toBe(true);
      expect(provider.validateSignature(Buffer.from(''), 'wrong_key', secret)).toBe(false);
      expect(provider.validateSignature(Buffer.from(''), '', secret)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Multi-Provider Factory Resolution
  // =========================================================================

  describe('2. WhatsApp Provider Factory & Dynamic Resolution', () => {
    it('2.1 getWhatsAppProvider instantiates appropriate provider class for each type', () => {
      const meta = getWhatsAppProvider('meta');
      expect(meta).toBeInstanceOf(MetaWhatsAppCloudProvider);

      const wati = getWhatsAppProvider('wati');
      expect(wati).toBeInstanceOf(WatiWhatsAppProvider);

      const mock = getWhatsAppProvider('mock');
      expect(mock).toBeInstanceOf(MockWhatsAppProvider);
    });

    it('2.2 setWhatsAppProviderForType allows granular per-type mocking without affecting other types', () => {
      const customMockWati = new MockWhatsAppProvider();
      setWhatsAppProviderForType('wati', customMockWati);

      // WATI resolves to custom mock
      expect(getWhatsAppProvider('wati')).toBe(customMockWati);
      // Meta resolves to real MetaWhatsAppCloudProvider instance
      expect(getWhatsAppProvider('meta')).toBeInstanceOf(MetaWhatsAppCloudProvider);
    });

    it('2.3 setWhatsAppProvider global override preserves backward compatibility for existing tests', () => {
      const globalMock = new MockWhatsAppProvider();
      setWhatsAppProvider(globalMock);

      expect(getWhatsAppProvider('meta')).toBe(globalMock);
      expect(getWhatsAppProvider('wati')).toBe(globalMock);
    });
  });

  // =========================================================================
  // 3. Database Persistence & AES-256-GCM Encryption
  // =========================================================================

  describe('3. WATI Configuration, Encryption & Secret Masking', () => {
    it('3.1 saves WATI config and encrypts WATI Bearer token at rest with AES-256-GCM', async () => {
      const res = await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: WATI_ENDPOINT,
          watiAccessToken: WATI_TOKEN_RAW,
          displayPhoneNumber: '+447911000000',
          webhookVerifyToken: WATI_VERIFY_TOKEN,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.provider).toBe('wati');
      expect(res.body.data.configured).toBe(true);
      expect(res.body.data.status).toBe('connected');
      expect(res.body.data.wati_api_endpoint).toBe(WATI_ENDPOINT);
      expect(res.body.data.has_wati_token).toBe(true);

      // Verify direct database row
      const dbRow = await db.query(`SELECT * FROM whatsapp_configs WHERE store_id = '${STORE_A_ID}'`);
      expect(dbRow.rows.length).toBe(1);
      const row = dbRow.rows[0];

      expect(row.provider).toBe('wati');
      expect(row.wati_api_endpoint).toBe(WATI_ENDPOINT);
      expect(row.encrypted_wati_token).toBeDefined();
      expect(row.encrypted_wati_token).not.toBe(WATI_TOKEN_RAW);
      expect(row.encrypted_wati_token).not.toContain(WATI_TOKEN_RAW);

      // Decrypt to confirm IV and auth tag validity
      const decrypted = decryptString(row.encrypted_wati_token);
      expect(decrypted).toBe(WATI_TOKEN_RAW);
    });

    it('3.2 never exposes plain text or encrypted WATI token on GET /config', async () => {
      await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: WATI_ENDPOINT,
          watiAccessToken: WATI_TOKEN_RAW,
          webhookVerifyToken: WATI_VERIFY_TOKEN,
        });

      const res = await request(app)
        .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.provider).toBe('wati');
      expect(res.body.data.has_wati_token).toBe(true);
      expect(res.body.data.encrypted_wati_token).toBeUndefined();
      expect(res.body.data.wati_access_token).toBeUndefined();
      expect(res.body.data.wati_token).toBeUndefined();
    });

    it('3.3 strictly enforces multi-tenant isolation on WATI credentials', async () => {
      // Store A configured with WATI
      await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: WATI_ENDPOINT,
          watiAccessToken: WATI_TOKEN_RAW,
          webhookVerifyToken: WATI_VERIFY_TOKEN,
        });

      // Merchant B cannot read Store A's WATI config
      const resGet = await request(app)
        .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(resGet.status).toBe(403);

      // Merchant B cannot overwrite Store A's WATI config
      const resPut = await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: 'https://malicious-wati.com',
          watiAccessToken: 'hacked_token',
        });
      expect(resPut.status).toBe(403);
    });
  });

  // =========================================================================
  // 4. Store-Level Provider Independence & Switching
  // =========================================================================

  describe('4. Store-Level Provider Independence & Switching', () => {
    it('4.1 allows Store A to run WATI while Store B runs Meta simultaneously', async () => {
      // Configure Store A with WATI
      await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: WATI_ENDPOINT,
          watiAccessToken: WATI_TOKEN_RAW,
          displayPhoneNumber: '+447911000000',
        });

      // Configure Store B with Meta
      await request(app)
        .put(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          provider: 'meta',
          phoneNumberId: 'phone_id_store_b_2002',
          wabaId: 'waba_id_store_b',
          accessToken: 'meta_secret_token_store_b',
          displayPhoneNumber: '+15550001111',
        });

      // Inspect Store A
      const resA = await request(app)
        .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resA.body.data.provider).toBe('wati');
      expect(resA.body.data.has_wati_token).toBe(true);
      expect(resA.body.data.has_access_token).toBe(false);

      // Inspect Store B
      const resB = await request(app)
        .get(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(resB.body.data.provider).toBe('meta');
      expect(resB.body.data.has_access_token).toBe(true);
      expect(resB.body.data.has_wati_token).toBe(false);
    });

    it('4.2 allows a single store to switch from Meta to WATI seamlessly', async () => {
      // Step 1: Configure as Meta
      await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'meta',
          phoneNumberId: 'phone_meta_old',
          accessToken: 'token_meta_old',
        });

      let res = await request(app)
        .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.body.data.provider).toBe('meta');

      // Step 2: Switch to WATI
      await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: WATI_ENDPOINT,
          watiAccessToken: WATI_TOKEN_RAW,
        });

      res = await request(app)
        .get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.body.data.provider).toBe('wati');
      expect(res.body.data.wati_api_endpoint).toBe(WATI_ENDPOINT);
      expect(res.body.data.has_wati_token).toBe(true);
    });
  });

  // =========================================================================
  // 5. WATI Webhook Route Security & Multi-Tenant Ingestion
  // =========================================================================

  describe('5. WATI Webhook Ingestion (/api/v1/webhooks/whatsapp/wati/:storeId)', () => {
    let mockWatiProvider: MockWhatsAppProvider;

    beforeEach(async () => {
      // Configure Store A with WATI
      await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: WATI_ENDPOINT,
          watiAccessToken: WATI_TOKEN_RAW,
          displayPhoneNumber: '+447911000000',
          webhookVerifyToken: WATI_VERIFY_TOKEN,
        });

      // Use a controllable MockWhatsAppProvider for WATI outbound checks
      mockWatiProvider = new MockWhatsAppProvider();
      setWhatsAppProviderForType('wati', mockWatiProvider);
    });

    it('5.1 rejects webhook if storeId does not exist or has disconnected provider', async () => {
      const nonExistentStore = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${nonExistentStore}?token=${WATI_VERIFY_TOKEN}`)
        .send({ eventType: 'message', text: 'Hi', waId: '447911123456' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden: Store not found or WATI not connected');
    });

    it('5.2 rejects webhook if query or header token does not match store webhook_verify_token', async () => {
      // Invalid query token
      const resInvalidQuery = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=wrong_token`)
        .send({ eventType: 'message', text: 'Hi', waId: '447911123456' });

      expect(resInvalidQuery.status).toBe(403);
      expect(resInvalidQuery.body.error).toContain('Forbidden: Invalid WATI webhook token');

      // Invalid header token
      const resInvalidHeader = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}`)
        .set('x-wati-token', 'wrong_header_token')
        .send({ eventType: 'message', text: 'Hi', waId: '447911123456' });

      expect(resInvalidHeader.status).toBe(403);
    });

    it('5.3 accepts valid webhook with query token and triggers AI Assistant grounded response', async () => {
      const customerPhone = '+447911123456';

      const res = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=${WATI_VERIFY_TOKEN}`)
        .send({
          eventType: 'message',
          waId: '447911123456',
          senderName: 'Alice Green',
          text: 'What kind of t-shirts do you sell?',
          whatsappMessageId: 'wati_msg_inbound_101',
          timestamp: String(Math.floor(Date.now() / 1000)),
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');

      // Verify AI Shopping Assistant generated and dispatched a grounded reply via WATI
      expect(mockWatiProvider.sentMessages.length).toBe(1);
      const sent = mockWatiProvider.sentMessages[0];
      expect(sent.to).toBe(customerPhone);
      expect(sent.message.type).toBe('text');
      expect(sent.message.text.body).toContain('EcoStylist AI');
      expect(sent.message.text.body).toContain('product_recommendation');

      // Verify conversation and message saved in DB
      const convRes = await db.query(`SELECT * FROM whatsapp_conversations WHERE store_id = '${STORE_A_ID}' AND phone_number = '${customerPhone}'`);
      expect(convRes.rows.length).toBe(1);
      expect(convRes.rows[0].customer_name).toBe('Alice Green');

      const msgs = await db.query(`SELECT * FROM whatsapp_messages WHERE conversation_id = '${convRes.rows[0].id}' ORDER BY created_at ASC`);
      expect(msgs.rows.length).toBe(2); // 1 inbound + 1 outbound
      expect(msgs.rows[0].direction).toBe('inbound');
      expect(msgs.rows[0].content).toContain('What kind of t-shirts do you sell?');
      expect(msgs.rows[1].direction).toBe('outbound');
      expect(msgs.rows[1].content).toContain('EcoStylist AI');
    });

    it('5.4 deduplicates repeated WATI webhook deliveries by whatsappMessageId', async () => {
      const payload = {
        eventType: 'message',
        waId: '447911123456',
        senderName: 'Alice Green',
        text: 'Do you sell organic bags?',
        whatsappMessageId: 'wati_dup_test_102',
        timestamp: String(Math.floor(Date.now() / 1000)),
      };

      // 1st delivery
      const res1 = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=${WATI_VERIFY_TOKEN}`)
        .send(payload);
      expect(res1.status).toBe(200);
      expect(mockWatiProvider.sentMessages.length).toBe(1);

      // 2nd delivery with identical messageId
      const res2 = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=${WATI_VERIFY_TOKEN}`)
        .send(payload);
      expect(res2.status).toBe(200);

      // Provider must NOT have received a 2nd outbound message
      expect(mockWatiProvider.sentMessages.length).toBe(1);
    });

    it('5.5 processes STOP keyword via WATI webhook to revoke consent immediately', async () => {
      const customerPhone = '+447911123456';

      // First give consent
      await db.query(`
        INSERT INTO whatsapp_consents (store_id, phone_number, wording, source, opted_in)
        VALUES ('${STORE_A_ID}', '${customerPhone}', 'Marketing updates', 'checkout_checkbox', true)
      `);

      const res = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=${WATI_VERIFY_TOKEN}`)
        .send({
          eventType: 'message',
          waId: '447911123456',
          text: 'STOP',
          whatsappMessageId: 'wati_stop_msg_103',
          timestamp: String(Math.floor(Date.now() / 1000)),
        });

      expect(res.status).toBe(200);

      // Verify consent status updated to revoked (opted_in = false) in DB
      const consentRes = await db.query(`SELECT * FROM whatsapp_consents WHERE store_id = '${STORE_A_ID}' AND phone_number = '${customerPhone}' ORDER BY captured_at DESC LIMIT 1`);
      expect(consentRes.rows[0].opted_in).toBe(false);

      // Verify polite opt-out confirmation message was dispatched
      expect(mockWatiProvider.sentMessages.length).toBe(1);
      expect(mockWatiProvider.sentMessages[0].message.text.body).toContain('unsubscribed');
      expect(mockWatiProvider.sentMessages[0].message.text.body).toContain('START');
    });

    it('5.6 processes START keyword via WATI webhook to re-enable consent', async () => {
      const customerPhone = '+447911123456';

      // First revoked
      await db.query(`
        INSERT INTO whatsapp_consents (store_id, phone_number, wording, source, opted_in, revoked_at)
        VALUES ('${STORE_A_ID}', '${customerPhone}', 'Previous consent', 'manual', false, NOW())
      `);

      const res = await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=${WATI_VERIFY_TOKEN}`)
        .send({
          eventType: 'message',
          waId: '447911123456',
          text: 'START',
          whatsappMessageId: 'wati_start_msg_104',
          timestamp: String(Math.floor(Date.now() / 1000)),
        });

      expect(res.status).toBe(200);

      // Verify consent status is opted_in
      const consentRes = await db.query(`SELECT * FROM whatsapp_consents WHERE store_id = '${STORE_A_ID}' AND phone_number = '${customerPhone}' ORDER BY captured_at DESC LIMIT 1`);
      expect(consentRes.rows[0].opted_in).toBe(true);

      // Verify welcome back message sent
      expect(mockWatiProvider.sentMessages.length).toBe(1);
      expect(mockWatiProvider.sentMessages[0].message.text.body).toContain('Welcome to');
    });

    it('5.7 updates outbound message status to delivered and read from WATI status webhooks', async () => {
      // Seed an existing outbound message with wamid
      const convRes = await db.query(`
        INSERT INTO whatsapp_conversations (store_id, phone_number)
        VALUES ('${STORE_A_ID}', '+447911123456')
        RETURNING id
      `);
      const convId = convRes.rows[0].id;

      await db.query(`
        INSERT INTO whatsapp_messages (store_id, conversation_id, direction, content, wamid, status)
        VALUES ('${STORE_A_ID}', '${convId}', 'outbound', 'Order update', 'wati_msg_stat_5544', 'sent')
      `);

      // Delivery status
      await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=${WATI_VERIFY_TOKEN}`)
        .send({
          eventType: 'sentMessageDELIVERED_v2',
          whatsappMessageId: 'wati_msg_stat_5544',
          timestamp: String(Math.floor(Date.now() / 1000)),
        });

      let check = await db.query(`SELECT status FROM whatsapp_messages WHERE wamid = 'wati_msg_stat_5544'`);
      expect(check.rows[0].status).toBe('delivered');

      // Read status
      await request(app)
        .post(`/api/v1/webhooks/whatsapp/wati/${STORE_A_ID}?token=${WATI_VERIFY_TOKEN}`)
        .send({
          eventType: 'sentMessageREAD_v2',
          whatsappMessageId: 'wati_msg_stat_5544',
          timestamp: String(Math.floor(Date.now() / 1000)),
        });

      check = await db.query(`SELECT status FROM whatsapp_messages WHERE wamid = 'wati_msg_stat_5544'`);
      expect(check.rows[0].status).toBe('read');
    });
  });

  // =========================================================================
  // 6. End-to-End Business Outbound Dispatches via WATI
  // =========================================================================

  describe('6. Outbound Business Dispatches with WATI Provider', () => {
    let mockWatiProvider: MockWhatsAppProvider;

    beforeEach(async () => {
      // Configure Store A with WATI
      await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: WATI_ENDPOINT,
          watiAccessToken: WATI_TOKEN_RAW,
          displayPhoneNumber: '+447911000000',
        });

      mockWatiProvider = new MockWhatsAppProvider();
      setWhatsAppProviderForType('wati', mockWatiProvider);
    });

    it('6.1 sends test message successfully through WATI provider', async () => {
      const res = await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/test`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phone: '+447911123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.success).toBe(true);

      expect(mockWatiProvider.sentMessages.length).toBe(1);
      const sent = mockWatiProvider.sentMessages[0];
      expect(sent.to).toBe('+447911123456');
      expect(sent.message.text.body).toContain('WATI');
      expect(sent.apiEndpoint).toBe(WATI_ENDPOINT);
      expect(sent.accessToken).toBe(WATI_TOKEN_RAW);
    });

    it('6.2 dispatches abandoned cart recovery via WATI when user has opted in', async () => {
      const customerPhone = '+447911123456';

      // Grant consent
      await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/opt-in`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          phoneNumber: customerPhone,
          consentWording: 'Checkout consent checkbox',
        });

      // Create visitor
      const visRes = await db.query(`INSERT INTO visitors (store_id, anonymous_id, phone) VALUES ('${STORE_A_ID}', 'vis_wati_shopper', '${customerPhone}') RETURNING id`);
      const visitorId = visRes.rows[0].id;

      // Schedule recovery job
      const schedRes = await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/schedule`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          customerPhone,
          visitorId,
          checkoutToken: 'cart_wati_abc_123',
          productId: 'prod_wati_a_1',
          productTitle: 'Eco Organic T-Shirt',
          price: 29.99,
          currency: 'GBP',
          recoveryUrl: 'https://store.myshopify.com/checkouts/c/wati123',
        });

      expect(schedRes.status).toBe(201);
      const jobId = schedRes.body.data.id;

      // Process recovery job
      const procRes = await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/${jobId}/process`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(procRes.status).toBe(200);
      expect(procRes.body.data.success).toBe(true);
      expect(procRes.body.data.status).toBe('sent');

      expect(mockWatiProvider.sentMessages.length).toBe(1);
      const sent = mockWatiProvider.sentMessages[0];
      expect(sent.to).toBe(customerPhone);
      expect(sent.message.text.body).toContain('Eco Organic T-Shirt');
      expect(sent.message.text.body).toContain('29.99');
      expect(sent.message.text.body).toContain('https://store.myshopify.com/checkouts/c/wati123');

      // Verify event tagged with provider 'wati'
      const events = await db.query(`SELECT * FROM events WHERE store_id = '${STORE_A_ID}' AND type = 'whatsapp_recovery_sent'`);
      expect(events.rows.length).toBe(1);
      expect(events.rows[0].payload.provider).toBe('wati');
    });

    it('6.3 suppresses abandoned cart recovery if order completed prior to dispatch', async () => {
      const customerPhone = '+447911123456';
      const checkoutToken = 'cart_wati_already_purchased';

      await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/opt-in`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phoneNumber: customerPhone, consentWording: 'Checkout consent' });

      const schedRes = await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/schedule`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          customerPhone,
          checkoutToken,
          productTitle: 'Eco Organic T-Shirt',
          price: 29.99,
        });

      expect(schedRes.status).toBe(201);
      const jobId = schedRes.body.data.id;

      // Simulate completed purchase for this checkoutToken
      const visRes = await db.query(`INSERT INTO visitors (store_id, anonymous_id, phone) VALUES ('${STORE_A_ID}', 'anon_${customerPhone}', '${customerPhone}') RETURNING id`);
      const visId = visRes.rows[0].id;
      await db.query(`
        INSERT INTO events (store_id, visitor_id, type, payload, created_at)
        VALUES ('${STORE_A_ID}', '${visId}', 'purchase_completed', '{"order_id": "1001", "cart_token": "${checkoutToken}"}', NOW())
      `);

      // Process job
      const procRes = await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/recovery/${jobId}/process`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(procRes.status).toBe(200);
      expect(procRes.body.data.status).toBe('skipped');
      expect(procRes.body.data.skipped_reason).toContain('Order already completed');

      // Outbound message was suppressed
      expect(mockWatiProvider.sentMessages.length).toBe(0);
    });

    it('6.4 dispatches test message with customized recipient via WATI', async () => {
      const customerPhone = '+447911999888';

      const resOrder = await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/test`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phone: customerPhone });

      expect(resOrder.status).toBe(200);
      expect(mockWatiProvider.sentMessages.length).toBe(1);
      expect(mockWatiProvider.sentMessages[0].to).toBe(customerPhone);
    });
  });

  // =========================================================================
  // 7. Full Regression Guard for Meta WhatsApp Cloud API
  // =========================================================================

  describe('7. Meta WhatsApp Regression Guard', () => {
    it('7.1 verifies Meta provider continues to operate with all existing Phase 13 logic', async () => {
      const mockMetaProvider = new MockWhatsAppProvider();
      setWhatsAppProviderForType('meta', mockMetaProvider);

      // Configure Store B with Meta
      await request(app)
        .put(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          provider: 'meta',
          phoneNumberId: 'meta_phone_12345',
          wabaId: 'meta_waba_12345',
          accessToken: 'meta_access_token_secure',
          displayPhoneNumber: '+15551234567',
        });

      // Dispatch test message
      const res = await request(app)
        .post(`/api/v1/dashboard/${STORE_B_ID}/whatsapp/test`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ phone: '+15559876543' });

      expect(res.status).toBe(200);
      expect(mockMetaProvider.sentMessages.length).toBe(1);
      expect(mockMetaProvider.sentMessages[0].phoneNumberId).toBe('meta_phone_12345');
      expect(mockMetaProvider.sentMessages[0].accessToken).toBe('meta_access_token_secure');
      expect(mockMetaProvider.sentMessages[0].message.text.body).toContain('META');
    });
  });

  // =========================================================================
  // 8. Robust WATI Credential Handling & Large JWT Tokens
  // =========================================================================

  describe('8. Robust WATI Credential & Large Token Handling', () => {
    it('8.1 safely stores long JWT bearer token in webhook_verify_token (> 255 chars)', async () => {
      // Create a 350-character JWT token string
      const rawJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE5OTk5OTk5OTksInN0b3JlSWQiOiJzdG9yZV8xMjM0NTY3OCIsInJvbGUiOiJ1c2VyIiwiaXNzIjoid2F0aS5pbyIsImF1ZCI6ImFpLXNtYXJ0LWVuZ2luZSIsImV4dHJhX2RhdGFfZmllbGQiOiJsb25nX3N0cmluZ192YWx1ZV90b19leGNlZWRfdHdvX2h1bmRyZWRfZmlmdHlfZml2ZV9jaGFyYWN0ZXJzX2NvbXBsZXRlbHkifQ.' +
        '4z6Nvx9U2kL2Q3P4R5T6V7X8Z9A0B1C2D3E4F5G6H7I8J9K0L1M2N3O4P5Q6R7S8';
      const bearerToken = 'Bearer ' + rawJwt;

      expect(bearerToken.length).toBeGreaterThan(255);

      const res = await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: 'https://live-mt-server.wati.io/10248349',
          displayPhoneNumber: '9336167136',
          watiAccessToken: bearerToken,
          webhookVerifyToken: bearerToken,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.configured).toBe(true);
      expect(res.body.data.provider).toBe('wati');
      expect(res.body.data.webhook_verify_token).toBe(bearerToken);

      // Verify in database: token decrypted has Bearer prefix stripped
      const dbRow = await db.query(`SELECT * FROM whatsapp_configs WHERE store_id = '${STORE_A_ID}'`);
      expect(dbRow.rows.length).toBe(1);
      const decrypted = decryptString(dbRow.rows[0].encrypted_wati_token);
      expect(decrypted.startsWith('Bearer ')).toBe(false);
      expect(decrypted).toBe(rawJwt);
    });

    it('8.2 rejects invalid WATI API endpoint with clean validation error message', async () => {
      const res = await request(app)
        .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          provider: 'wati',
          watiApiEndpoint: 'invalid-url-without-protocol',
          displayPhoneNumber: '9336167136',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.message).toContain('WATI API Endpoint URL must start with http:// or https://');
    });

    it('8.3 allows saving WATI config and constructing WhatsAppService when SHOPIFY_ADAPTER_MODE is real', async () => {
      const prevMode = process.env.SHOPIFY_ADAPTER_MODE;
      try {
        process.env.SHOPIFY_ADAPTER_MODE = 'real';
        const res = await request(app)
          .put(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/config`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            provider: 'wati',
            watiApiEndpoint: 'https://live-mt-server.wati.io/10248349',
            displayPhoneNumber: '+919336167136',
            watiAccessToken: 'my_real_wati_token_secret',
            webhookVerifyToken: 'my_real_webhook_token',
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.configured).toBe(true);
        expect(res.body.data.provider).toBe('wati');
      } finally {
        process.env.SHOPIFY_ADAPTER_MODE = prevMode;
      }
    });
  });
});
