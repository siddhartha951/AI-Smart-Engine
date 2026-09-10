import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Phase 9: Merchant Onboarding Wizard', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let superAdminToken: string;
  let onboardingToken: string;
  let merchantId: string;
  let storeId: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();
    app = createApp({ db });

    // 1. Get super admin token
    const resSA = await request(app).post('/api/v1/auth/login').send({ email: 'admin@platform.com', password: 'password123' });
    superAdminToken = resSA.body.token;

    // 2. Create a new merchant via admin API to generate an invite token
    const createRes = await request(app)
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Onboard Test', contact_email: 'onboard@test.com' });
    merchantId = createRes.body.data.id;

    // 3. Invite the merchant to get the onboarding_token
    const inviteRes = await request(app)
      .post(`/api/v1/admin/merchants/${merchantId}/invite`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    onboardingToken = inviteRes.body.data.onboarding_token;
  });

  afterEach(async () => {
    await db.close();
  });

  // =========================================================================
  // 1. Token Validation
  // =========================================================================
  it('Rejects requests with missing or invalid tokens', async () => {
    const res = await request(app).get('/api/v1/onboarding/verify');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing or invalid');

    const res2 = await request(app)
      .get('/api/v1/onboarding/verify')
      .set('Authorization', 'Bearer invalid-token-123');
    expect(res2.status).toBe(401);
    expect(res2.body.error).toContain('Invalid onboarding token');
  });

  it('Verifies a valid onboarding token', async () => {
    const res = await request(app)
      .get('/api/v1/onboarding/verify')
      .set('Authorization', `Bearer ${onboardingToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Onboard Test');
    expect(res.body.data.status).toBe('invited');
  });

  // =========================================================================
  // 2. Full State Machine Flow (Step 1 -> 6)
  // =========================================================================
  it('Completes the entire onboarding flow successfully', async () => {
    
    // STEP 1: Business Details
    const step1Res = await request(app)
      .post('/api/v1/onboarding/step1-business')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({
        merchant_name: 'Onboard Test Inc',
        brand_name: 'Test Brand',
        contact_email: 'onboard@test.com',
        shop_domain: 'onboard-test.myshopify.com',
        currency: 'GBP',
        timezone: 'Europe/London',
        password: 'securePassword123'
      });
    expect(step1Res.status).toBe(200);
    expect(step1Res.body.store_id).toBeDefined();
    storeId = step1Res.body.store_id;

    // Check merchant status
    const mCheck = await db.query('SELECT status FROM merchants WHERE id = $1', [merchantId]);
    expect(mCheck.rows[0].status).toBe('onboarding');

    // STEP 2: Shopify Connection
    const step2Res = await request(app)
      .post('/api/v1/onboarding/step2-shopify')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({
        store_id: storeId,
        admin_token: 'shpat_secret_12345',
        storefront_token: 'shps_secret_12345'
      });
    expect(step2Res.status).toBe(200);

    // Verify credentials are encrypted in DB
    const credsCheck = await db.query('SELECT encrypted_admin_token, encryption_iv FROM store_credentials WHERE store_id = $1', [storeId]);
    expect(credsCheck.rows.length).toBe(1);
    expect(credsCheck.rows[0].encrypted_admin_token).not.toContain('shpat_secret');
    expect(credsCheck.rows[0].encryption_iv).toBeDefined();

    // STEP 3: Assistant Setup
    const step3Res = await request(app)
      .post('/api/v1/onboarding/step3-assistant')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({
        store_id: storeId,
        assistant_name: 'AI Helper',
        welcome_message: 'Hello!',
        tone: 'Friendly',
        allowed_categories: ['All'],
        delivery_policy: '3 days',
        returns_policy: '30 days',
        faq_content: 'No FAQs'
      });
    expect(step3Res.status).toBe(200);

    // STEP 4: Email Setup
    const step4Res = await request(app)
      .post('/api/v1/onboarding/step4-email')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({
        store_id: storeId,
        sender_name: 'Test Store',
        sender_email: 'hello@test.com',
        recovery_enabled: true,
        marketing_consent_wording: 'I agree'
      });
    expect(step4Res.status).toBe(200);

    // STEP 5: Sync
    const step5Res = await request(app)
      .post('/api/v1/onboarding/step5-sync')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({ store_id: storeId });
    expect(step5Res.status).toBe(200);
    expect(step5Res.body.synced_products).toBe(42);

    // STEP 6: Finish
    const step6Res = await request(app)
      .post('/api/v1/onboarding/step6-finish')
      .set('Authorization', `Bearer ${onboardingToken}`)
      .send({ store_id: storeId });
    expect(step6Res.status).toBe(200);
    expect(step6Res.body.embed_script).toContain('data-widget-key=');

    // 3. Post-Onboarding Checks
    const finalMCheck = await db.query('SELECT status, onboarding_token FROM merchants WHERE id = $1', [merchantId]);
    expect(finalMCheck.rows[0].status).toBe('active');
    expect(finalMCheck.rows[0].onboarding_token).toBeNull(); // Token is consumed

    const finalSCheck = await db.query('SELECT status FROM stores WHERE id = $1', [storeId]);
    expect(finalSCheck.rows[0].status).toBe('active');

    // 4. Token cannot be reused
    const reVerifyRes = await request(app)
      .get('/api/v1/onboarding/verify')
      .set('Authorization', `Bearer ${onboardingToken}`);
    expect(reVerifyRes.status).toBe(401); // Since token was nullified in DB, it no longer matches

    // 5. Merchant can now login with password set in Step 1
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'onboard@test.com', password: 'securePassword123' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
  });
});
