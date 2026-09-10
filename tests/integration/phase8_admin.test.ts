import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';

describe('Phase 8: Admin Dashboard', () => {
  let db: InMemoryPostgresClient;
  let app: any;

  const MERCHANT_A_ID = '11111111-1111-1111-1111-111111111111';

  let tokenSuperAdmin: string;
  let tokenOpsAdmin: string;
  let tokenMerchant: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();
    app = createApp({ db });

    // Login super admin (admin@platform.com was migrated to super_admin)
    const resSA = await request(app).post('/api/v1/auth/login').send({ email: 'admin@platform.com', password: 'password123' });
    tokenSuperAdmin = resSA.body.token;

    // Login ops admin
    const resOps = await request(app).post('/api/v1/auth/login').send({ email: 'ops_admin@platform.com', password: 'password123' });
    tokenOpsAdmin = resOps.body.token;

    // Login merchant
    const resMerch = await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' });
    tokenMerchant = resMerch.body.token;
  });

  afterEach(async () => {
    await db.close();
  });

  // =========================================================================
  // 1. Merchant denied access to ALL admin routes
  // =========================================================================
  it('Merchant is denied access to admin overview', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${tokenMerchant}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: admin access required');
  });

  it('Merchant is denied access to admin merchants list', async () => {
    const res = await request(app)
      .get('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${tokenMerchant}`);
    expect(res.status).toBe(403);
  });

  it('Merchant is denied access to platform config', async () => {
    const res = await request(app)
      .get('/api/v1/admin/platform/config')
      .set('Authorization', `Bearer ${tokenMerchant}`);
    expect(res.status).toBe(403);
  });

  it('Merchant is denied access to create merchant', async () => {
    const res = await request(app)
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${tokenMerchant}`)
      .send({ name: 'Hack', contact_email: 'hack@evil.com' });
    expect(res.status).toBe(403);
  });

  it('Merchant is denied access to global pause', async () => {
    const res = await request(app)
      .post('/api/v1/admin/platform/global-pause')
      .set('Authorization', `Bearer ${tokenMerchant}`);
    expect(res.status).toBe(403);
  });

  // =========================================================================
  // 2. Ops Admin restrictions
  // =========================================================================
  it('Ops admin CAN access admin overview', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${tokenOpsAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('Ops admin CAN list merchants', async () => {
    const res = await request(app)
      .get('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${tokenOpsAdmin}`);
    expect(res.status).toBe(200);
  });

  it('Ops admin CANNOT delete a merchant', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/merchants/${MERCHANT_A_ID}`)
      .set('Authorization', `Bearer ${tokenOpsAdmin}`)
      .send({ confirm_action: 'DELETE' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: super admin access required');
  });

  it('Ops admin CANNOT update platform config', async () => {
    const res = await request(app)
      .put('/api/v1/admin/platform/config')
      .set('Authorization', `Bearer ${tokenOpsAdmin}`)
      .send({ monthly_ai_budget_usd: 100 });
    expect(res.status).toBe(403);
  });

  it('Ops admin CANNOT trigger global pause', async () => {
    const res = await request(app)
      .post('/api/v1/admin/platform/global-pause')
      .set('Authorization', `Bearer ${tokenOpsAdmin}`);
    expect(res.status).toBe(403);
  });

  // =========================================================================
  // 3. Super Admin full access
  // =========================================================================
  it('Super admin can access overview with all metrics', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('merchants');
    expect(data).toHaveProperty('totals');
    expect(data).toHaveProperty('ai_budget');
    expect(data).toHaveProperty('top_consumers');
    expect(data.ai_budget).toHaveProperty('monthly_budget_usd');
    expect(data.ai_budget).toHaveProperty('total_spend_usd');
  });

  it('Super admin can read platform config', async () => {
    const res = await request(app)
      .get('/api/v1/admin/platform/config')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.data.monthly_ai_budget_usd).toBeDefined();
  });

  it('Super admin can update platform config', async () => {
    const res = await request(app)
      .put('/api/v1/admin/platform/config')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ monthly_ai_budget_usd: 25.00 });
    expect(res.status).toBe(200);

    const getRes = await request(app)
      .get('/api/v1/admin/platform/config')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(parseFloat(getRes.body.data.monthly_ai_budget_usd)).toBe(25);
  });

  // =========================================================================
  // 4. Merchant lifecycle: create → invite → pause → resume → disable → enable
  // =========================================================================
  it('Full merchant lifecycle', async () => {
    // Create
    const createRes = await request(app)
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ name: 'Test Merchant', contact_email: 'test@newstore.com', shop_domain: 'new.myshopify.com', brand_name: 'New Store' });
    expect(createRes.status).toBe(201);
    const merchantId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe('draft');

    // Invite
    const inviteRes = await request(app)
      .post(`/api/v1/admin/merchants/${merchantId}/invite`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(inviteRes.status).toBe(200);
    expect(inviteRes.body.data.onboarding_token).toBeDefined();

    // Pause
    const pauseRes = await request(app)
      .post(`/api/v1/admin/merchants/${merchantId}/pause`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(pauseRes.status).toBe(200);

    // Resume
    const resumeRes = await request(app)
      .post(`/api/v1/admin/merchants/${merchantId}/resume`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(resumeRes.status).toBe(200);

    // Disable (requires confirmation)
    const disableRes = await request(app)
      .post(`/api/v1/admin/merchants/${merchantId}/disable`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ confirm_action: 'DISABLE' });
    expect(disableRes.status).toBe(200);

    // Enable
    const enableRes = await request(app)
      .post(`/api/v1/admin/merchants/${merchantId}/enable`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(enableRes.status).toBe(200);
  });

  // =========================================================================
  // 5. Audit logging — every mutation creates an entry
  // =========================================================================
  it('Creates audit log entries for merchant mutations', async () => {
    // Create a merchant
    const createRes = await request(app)
      .post('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({ name: 'Audit Test', contact_email: 'audit@test.com' });
    const merchantId = createRes.body.data.id;

    // Pause it
    await request(app)
      .post(`/api/v1/admin/merchants/${merchantId}/pause`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);

    // Check audit log
    const auditRes = await request(app)
      .get(`/api/v1/admin/merchants/${merchantId}/audit`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(auditRes.status).toBe(200);
    
    const actions = auditRes.body.data.map((a: any) => a.action);
    expect(actions).toContain('CREATE_MERCHANT');
    expect(actions).toContain('PAUSE_MERCHANT');
  });

  // =========================================================================
  // 6. Credential safety — never expose raw tokens
  // =========================================================================
  it('Merchant detail never exposes raw Shopify credentials', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/merchants/${MERCHANT_A_ID}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    // Must not contain any encrypted token values
    expect(body).not.toContain('enc_mock_admin_token');
    expect(body).not.toContain('enc_mock_storefront_token');
    expect(body).not.toContain('encryption_iv');
    expect(body).not.toContain('iv_mock_store');

    // But should indicate whether credentials are configured
    const store = res.body.data.stores[0];
    expect(store).toHaveProperty('has_shopify_credentials');
    expect(store.has_shopify_credentials).toBe(true);
  });

  // =========================================================================
  // 7. Confirm-action guard
  // =========================================================================
  it('Disable without confirmation returns 400', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/merchants/${MERCHANT_A_ID}/disable`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('confirm_action');
  });

  it('Delete without confirmation returns 400', async () => {
    const res = await request(app)
      .delete(`/api/v1/admin/merchants/${MERCHANT_A_ID}`)
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('confirm_action');
  });

  // =========================================================================
  // 8. Global pause/resume
  // =========================================================================
  it('Global pause disables all agents', async () => {
    const res = await request(app)
      .post('/api/v1/admin/platform/global-pause')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(res.status).toBe(200);

    // Overview should show global_pause = true
    const overviewRes = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(overviewRes.body.data.global_pause).toBe(true);
  });

  it('Global resume re-enables all agents', async () => {
    // Pause first
    await request(app)
      .post('/api/v1/admin/platform/global-pause')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);

    // Resume
    const res = await request(app)
      .post('/api/v1/admin/platform/global-resume')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(res.status).toBe(200);

    const overviewRes = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`);
    expect(overviewRes.body.data.global_pause).toBe(false);
  });
});
