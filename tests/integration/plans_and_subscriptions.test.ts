import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { EntitlementRepository } from '../../src/modules/entitlements/entitlement.repository';
import { ALL_FEATURE_KEYS } from '../../src/modules/entitlements/entitlement.types';
import { FEATURE_SECTIONS } from '../../src/modules/plans/plan.types';
import { BudgetGuard } from '../../src/providers/ai';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Plans and store subscriptions', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let superToken: string;
  let opsToken: string;
  let merchantToken: string;

  const login = async (email: string) =>
    (await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' })).body.token;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    superToken = await login('admin@platform.com');
    opsToken = await login('ops_admin@platform.com');
    merchantToken = await login('merchantA@store.com');
  });

  afterEach(async () => {
    await db.close();
  });

  const assign = (storeId: string, body: Record<string, unknown>, token = superToken) =>
    request(app).put(`/api/v1/admin/stores/${storeId}/plan`).set('Authorization', `Bearer ${token}`).send(body);

  it('every feature key sits in exactly one section', () => {
    const listed = FEATURE_SECTIONS.flatMap((s) => s.features);
    expect(listed.sort()).toEqual([...ALL_FEATURE_KEYS].sort());
  });

  it('seeds four plans with yearly = 10 months and a section matrix', async () => {
    const res = await request(app).get('/api/v1/admin/plans').set('Authorization', `Bearer ${opsToken}`);
    expect(res.status).toBe(200);
    const plans = res.body.data.plans;
    expect(plans.map((p: any) => p.id)).toEqual(['starter', 'growth', 'pro', 'enterprise']);
    const growth = plans.find((p: any) => p.id === 'growth');
    expect(growth.price_inr_monthly).toBe(7999);
    expect(growth.yearly_price_inr).toBe(79990);
    expect(growth.features).toContain('support_tickets');
    expect(growth.features).not.toContain('meta_ads');
    expect(plans.find((p: any) => p.id === 'enterprise').price_inr_monthly).toBeNull();
    expect(res.body.data.sections).toHaveLength(6);
  });

  it('a store without a plan keeps its current features and the platform limits', async () => {
    const before = await new EntitlementRepository(db).getStoreEntitlements(STORE_A_ID);
    const res = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/plan`).set('Authorization', `Bearer ${merchantToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.plan).toBeNull();
    expect(res.body.data.subscription).toBeNull();
    expect(res.body.data.limits.ai_budget_usd).toBe(14);
    expect(res.body.data.limits.knowledge_doc_limit).toBe(25);
    const whatsapp = res.body.data.sections.flatMap((s: any) => s.features).find((f: any) => f.key === 'whatsapp');
    expect(whatsapp.badge).toBe(before.whatsapp ? 'on' : 'off');
    expect(whatsapp.available_on.name).toBe('Pro');
    expect(await new EntitlementRepository(db).getStoreEntitlements(STORE_A_ID)).toEqual(before);
  });

  it('assigning a plan switches features to the plan and sets limits', async () => {
    const res = await assign(STORE_A_ID, {
      plan_id: 'growth', status: 'active', currency: 'INR', billing_cycle: 'monthly',
      started_at: '2026-09-12', renews_at: '2026-10-12', notes: 'Paid by bank transfer',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.features_reset).toBe(true);
    const ent = await new EntitlementRepository(db).getStoreEntitlements(STORE_A_ID);
    expect(ent.support_tickets).toBe(true);
    expect(ent.email_automation).toBe(true);
    expect(ent.whatsapp).toBe(false);
    expect(ent.meta_ads).toBe(false);

    const view = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/plan`).set('Authorization', `Bearer ${merchantToken}`);
    expect(view.body.data.plan.id).toBe('growth');
    expect(view.body.data.subscription.renews_at).toBe('2026-10-12');
    expect(view.body.data.subscription.charged_price).toBe(7999);
    expect(view.body.data.subscription.notes).toBeUndefined();
    expect(view.body.data.limits).toEqual({ ai_budget_usd: 40, knowledge_doc_limit: 15 });

    // The merchant is blocked from a module outside the plan
    const blocked = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/whatsapp/overview`).set('Authorization', `Bearer ${merchantToken}`);
    expect(blocked.status).toBe(403);
  });

  it('add-ons and removals show as badges and survive a same-plan save', async () => {
    await assign(STORE_A_ID, { plan_id: 'growth' });
    const put = (key: string, enabled: boolean) =>
      request(app).put(`/api/v1/admin/stores/${STORE_A_ID}/features/${key}`).set('Authorization', `Bearer ${superToken}`).send({ enabled });
    await put('whatsapp', true);
    await put('smart_reorder', false);

    // Changing only the dates on the same plan must not wipe the overrides
    const save = await assign(STORE_A_ID, { plan_id: 'growth', renews_at: '2026-11-12', price_amount: 6500 });
    expect(save.body.data.features_reset).toBe(false);
    const all = save.body.data.sections.flatMap((s: any) => s.features);
    expect(all.find((f: any) => f.key === 'whatsapp').badge).toBe('addon');
    expect(all.find((f: any) => f.key === 'smart_reorder').badge).toBe('removed');
    expect(all.find((f: any) => f.key === 'email_automation').badge).toBe('in_plan');
    expect(save.body.data.subscription.charged_price).toBe(6500);

    const reset = await request(app).post(`/api/v1/admin/stores/${STORE_A_ID}/plan/reset-features`).set('Authorization', `Bearer ${superToken}`);
    expect(reset.status).toBe(200);
    const ent = await new EntitlementRepository(db).getStoreEntitlements(STORE_A_ID);
    expect(ent.whatsapp).toBe(false);
    expect(ent.smart_reorder).toBe(true);
  });

  it('changing a plan updates its stores but keeps their overrides', async () => {
    await assign(STORE_A_ID, { plan_id: 'growth' });
    await assign(STORE_B_ID, { plan_id: 'growth' });
    await request(app).put(`/api/v1/admin/stores/${STORE_B_ID}/features/meta_ads`).set('Authorization', `Bearer ${superToken}`).send({ enabled: true });

    const plans = (await request(app).get('/api/v1/admin/plans').set('Authorization', `Bearer ${superToken}`)).body.data.plans;
    const growth = plans.find((p: any) => p.id === 'growth');
    const features = [...growth.features.filter((f: string) => f !== 'smart_reorder'), 'meta_ads'];
    const res = await request(app).put('/api/v1/admin/plans/growth').set('Authorization', `Bearer ${superToken}`).send({ features, price_inr_monthly: 8499 });
    expect(res.status).toBe(200);
    expect(res.body.data.price_inr_monthly).toBe(8499);
    expect(res.body.data.store_count).toBe(2);

    const a = await new EntitlementRepository(db).getStoreEntitlements(STORE_A_ID);
    expect(a.meta_ads).toBe(true);
    expect(a.smart_reorder).toBe(false);
    const b = await new EntitlementRepository(db).getStoreEntitlements(STORE_B_ID);
    expect(b.meta_ads).toBe(true);
  });

  it('the AI budget follows the plan, with a per-store override', async () => {
    const period = new Date().toISOString().substring(0, 7);
    await db.query(
      `INSERT INTO ai_usage_ledger (store_id, model, input_tokens, output_tokens, estimated_cost_usd, billing_period)
       VALUES ($1, 'mock', 1, 1, 20, $2)`,
      [STORE_A_ID, period]
    );
    const guard = new BudgetGuard(db);
    expect(await guard.isBudgetExceeded(STORE_A_ID)).toBe(true); // platform default $14
    await assign(STORE_A_ID, { plan_id: 'growth' });
    expect(await guard.isBudgetExceeded(STORE_A_ID)).toBe(false); // plan $40
    await assign(STORE_A_ID, { plan_id: 'growth', ai_budget_usd: 18 });
    expect(await guard.isBudgetExceeded(STORE_A_ID)).toBe(true); // custom $18
  });

  it('the knowledge document limit follows the plan', async () => {
    await assign(STORE_A_ID, { plan_id: 'growth', knowledge_doc_limit: 1 });
    const add = (title: string) =>
      request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/agent/knowledge/documents/text`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ title, content: 'Our dog shampoo is sulphate free and safe for puppies.' });
    const first = await add('Shampoo facts');
    expect(first.status).toBeLessThan(300);
    const second = await add('More facts');
    expect(second.status).toBe(400);
    expect(JSON.stringify(second.body)).toContain('up to 1 knowledge documents');
  });

  it('validates input and restricts changes to super admins', async () => {
    expect((await assign(STORE_A_ID, { plan_id: 'growth' }, opsToken)).status).toBe(403);
    expect((await assign(STORE_A_ID, { plan_id: 'growth' }, merchantToken)).status).toBe(403);
    expect((await assign(STORE_A_ID, { plan_id: 'gold' })).status).toBe(400);
    expect((await assign(STORE_A_ID, { plan_id: 'growth', status: 'forever' })).status).toBe(400);
    expect((await assign(STORE_A_ID, { plan_id: 'growth', renews_at: '12/10/2026' })).status).toBe(400);
    expect((await assign(STORE_A_ID, { plan_id: 'growth', hack: true })).status).toBe(400);
    expect((await assign('cccccccc-0000-0000-0000-cccccccccccc', { plan_id: 'growth' })).status).toBe(404);

    const bad = await request(app).put('/api/v1/admin/plans/growth').set('Authorization', `Bearer ${superToken}`).send({ features: ['teleport'] });
    expect(bad.status).toBe(400);
    const ops = await request(app).put('/api/v1/admin/plans/growth').set('Authorization', `Bearer ${opsToken}`).send({ price_inr_monthly: 1 });
    expect(ops.status).toBe(403);

    // Merchants cannot read another store's plan
    const other = await request(app).get(`/api/v1/dashboard/${STORE_B_ID}/plan`).set('Authorization', `Bearer ${merchantToken}`);
    expect(other.status).toBe(403);
  });

  it('records assignments in the audit log', async () => {
    await assign(STORE_A_ID, { plan_id: 'starter' });
    await assign(STORE_A_ID, { plan_id: 'pro' });
    const logs = await db.query(
      "SELECT action FROM audit_logs WHERE store_id = $1 AND target_table = 'store_subscriptions' ORDER BY created_at ASC",
      [STORE_A_ID]
    );
    expect(logs.rows.map((r: any) => r.action)).toEqual(['ASSIGN_STORE_PLAN', 'UPDATE_STORE_SUBSCRIPTION']);
  });
});
