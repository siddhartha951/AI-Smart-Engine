import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { ALL_FEATURE_KEYS, FeatureKey } from '../entitlements/entitlement.types';
import { EntitlementRepository } from '../entitlements/entitlement.repository';
import { AuditRepository } from '../merchant/audit.repository';
import {
  BillingCycle,
  Plan,
  StoreSubscription,
  SubscriptionStatus,
  normalizeFeatureList,
  withAlwaysIncluded,
} from './plan.types';

export interface PlanPatch {
  name?: string;
  tagline?: string | null;
  price_inr_monthly?: number | null;
  price_usd_monthly?: number | null;
  ai_budget_usd?: number | null;
  knowledge_doc_limit?: number | null;
  features?: FeatureKey[];
  is_active?: boolean;
}

export interface SubscriptionInput {
  plan_id: string;
  billing_cycle: BillingCycle;
  price_amount: number | null;
  currency: string;
  status: SubscriptionStatus;
  started_at: string | null;
  renews_at: string | null;
  trial_ends_at: string | null;
  ai_budget_usd: number | null;
  knowledge_doc_limit: number | null;
  notes: string | null;
}

export interface EffectiveLimits {
  /** null = no plan assigned (or no limit set): callers keep the platform default. */
  ai_budget_usd: number | null;
  knowledge_doc_limit: number | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** DATE columns come back as a local-midnight Date from pg; keep the calendar day. */
function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function mapPlan(row: any): Plan {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline ?? null,
    price_inr_monthly: toNumber(row.price_inr_monthly),
    price_usd_monthly: toNumber(row.price_usd_monthly),
    ai_budget_usd: toNumber(row.ai_budget_usd),
    knowledge_doc_limit: toNumber(row.knowledge_doc_limit),
    features: withAlwaysIncluded(normalizeFeatureList(row.features)),
    sort_order: Number(row.sort_order) || 0,
    is_active: row.is_active !== false,
  };
}

function mapSubscription(row: any): StoreSubscription {
  return {
    store_id: row.store_id,
    plan_id: row.plan_id,
    billing_cycle: row.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
    price_amount: toNumber(row.price_amount),
    currency: row.currency || 'INR',
    status: row.status,
    started_at: toDateString(row.started_at),
    renews_at: toDateString(row.renews_at),
    trial_ends_at: toDateString(row.trial_ends_at),
    ai_budget_usd: toNumber(row.ai_budget_usd),
    knowledge_doc_limit: toNumber(row.knowledge_doc_limit),
    notes: row.notes ?? null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/** Full feature map for a plan: included features on, everything else off. */
export function planFeatureMap(plan: Plan): Record<FeatureKey, boolean> {
  const map = {} as Record<FeatureKey, boolean>;
  for (const key of ALL_FEATURE_KEYS) map[key] = plan.features.includes(key);
  return map;
}

export class PlanRepository {
  private db: IDatabaseClient;
  private entitlements: EntitlementRepository;
  private audit: AuditRepository;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
    this.entitlements = new EntitlementRepository(this.db);
    this.audit = new AuditRepository(this.db);
  }

  async listPlans(): Promise<Plan[]> {
    const res = await this.db.query('SELECT * FROM plans ORDER BY sort_order ASC, id ASC');
    return res.rows.map(mapPlan);
  }

  async getPlan(planId: string): Promise<Plan | null> {
    const res = await this.db.query('SELECT * FROM plans WHERE id = $1', [planId]);
    return res.rows[0] ? mapPlan(res.rows[0]) : null;
  }

  /**
   * Updates a plan. When its feature list changes, stores on the plan follow the change for
   * every feature they have NOT overridden (their switch still matches the old plan default);
   * add-ons and removals the admin made for a single store are kept.
   */
  async updatePlan(planId: string, patch: PlanPatch, adminUserId: string): Promise<Plan | null> {
    const before = await this.getPlan(planId);
    if (!before) return null;
    const next: Plan = {
      ...before,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    } as Plan;
    next.features = withAlwaysIncluded(normalizeFeatureList(next.features));

    await this.db.query(
      `UPDATE plans SET
         name = $2, tagline = $3, price_inr_monthly = $4, price_usd_monthly = $5,
         ai_budget_usd = $6, knowledge_doc_limit = $7, features = $8::jsonb, is_active = $9,
         updated_at = NOW()
       WHERE id = $1`,
      [
        planId,
        next.name,
        next.tagline,
        next.price_inr_monthly,
        next.price_usd_monthly,
        next.ai_budget_usd,
        next.knowledge_doc_limit,
        JSON.stringify(next.features),
        next.is_active,
      ]
    );

    const changed = ALL_FEATURE_KEYS.filter(
      (key) => before.features.includes(key) !== next.features.includes(key)
    );
    if (changed.length > 0) {
      const subs = await this.db.query<{ store_id: string }>(
        'SELECT store_id FROM store_subscriptions WHERE plan_id = $1',
        [planId]
      );
      for (const { store_id } of subs.rows) {
        const current = await this.entitlements.getStoreEntitlements(store_id);
        const updates: Partial<Record<FeatureKey, boolean>> = {};
        for (const key of changed) {
          const wasDefault = before.features.includes(key);
          if (current[key] === wasDefault) updates[key] = next.features.includes(key);
        }
        await this.entitlements.writeEntitlements(store_id, updates);
      }
    }

    await this.audit.logAction(adminUserId, null, 'UPDATE_PLAN', 'plans', before, next);
    return this.getPlan(planId);
  }

  async getSubscription(storeId: string): Promise<StoreSubscription | null> {
    const res = await this.db.query('SELECT * FROM store_subscriptions WHERE store_id = $1', [storeId]);
    return res.rows[0] ? mapSubscription(res.rows[0]) : null;
  }

  /**
   * Assigns (or updates) a store's plan. When `applyPlanFeatures` is true the store's feature
   * switches are reset to exactly what the plan includes.
   */
  async assignPlan(
    storeId: string,
    input: SubscriptionInput,
    adminUserId: string,
    applyPlanFeatures: boolean
  ): Promise<StoreSubscription> {
    const plan = await this.getPlan(input.plan_id);
    if (!plan) throw new Error(`Unknown plan: ${input.plan_id}`);
    const previous = await this.getSubscription(storeId);
    const featuresBefore = await this.entitlements.getStoreEntitlements(storeId);

    await this.db.query(
      `INSERT INTO store_subscriptions (
         store_id, plan_id, billing_cycle, price_amount, currency, status,
         started_at, renews_at, trial_ends_at, ai_budget_usd, knowledge_doc_limit, notes,
         updated_by, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (store_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         billing_cycle = EXCLUDED.billing_cycle,
         price_amount = EXCLUDED.price_amount,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         started_at = EXCLUDED.started_at,
         renews_at = EXCLUDED.renews_at,
         trial_ends_at = EXCLUDED.trial_ends_at,
         ai_budget_usd = EXCLUDED.ai_budget_usd,
         knowledge_doc_limit = EXCLUDED.knowledge_doc_limit,
         notes = EXCLUDED.notes,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        storeId,
        input.plan_id,
        input.billing_cycle,
        input.price_amount,
        input.currency,
        input.status,
        input.started_at,
        input.renews_at,
        input.trial_ends_at,
        input.ai_budget_usd,
        input.knowledge_doc_limit,
        input.notes,
        adminUserId,
      ]
    );

    let featuresAfter = featuresBefore;
    if (applyPlanFeatures) {
      featuresAfter = planFeatureMap(plan);
      await this.entitlements.writeEntitlements(storeId, featuresAfter);
    }

    const saved = (await this.getSubscription(storeId))!;
    await this.audit.logAction(
      adminUserId,
      storeId,
      previous ? 'UPDATE_STORE_SUBSCRIPTION' : 'ASSIGN_STORE_PLAN',
      'store_subscriptions',
      { subscription: previous, features: featuresBefore },
      { subscription: saved, features: featuresAfter }
    );
    return saved;
  }

  /** Puts every feature switch back to what the store's plan includes. */
  async resetFeaturesToPlan(storeId: string, adminUserId: string): Promise<boolean> {
    const sub = await this.getSubscription(storeId);
    const plan = sub ? await this.getPlan(sub.plan_id) : null;
    if (!plan) return false;
    const before = await this.entitlements.getStoreEntitlements(storeId);
    const after = planFeatureMap(plan);
    await this.entitlements.writeEntitlements(storeId, after);
    await this.audit.logAction(
      adminUserId,
      storeId,
      'RESET_FEATURES_TO_PLAN',
      'store_feature_entitlements',
      { features: before },
      { plan_id: plan.id, features: after }
    );
    return true;
  }

  async countStoresByPlan(): Promise<Record<string, number>> {
    const res = await this.db.query<{ plan_id: string; count: string }>(
      'SELECT plan_id, COUNT(*) AS count FROM store_subscriptions GROUP BY plan_id'
    );
    const counts: Record<string, number> = {};
    for (const row of res.rows) counts[row.plan_id] = Number(row.count) || 0;
    return counts;
  }

  /** Per-store override first, then the plan's value; both null when no plan is assigned. */
  async getEffectiveLimits(storeId: string): Promise<EffectiveLimits> {
    const res = await this.db.query(
      `SELECT s.ai_budget_usd AS sub_ai, s.knowledge_doc_limit AS sub_docs,
              p.ai_budget_usd AS plan_ai, p.knowledge_doc_limit AS plan_docs
       FROM store_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.store_id = $1`,
      [storeId]
    );
    const row = res.rows[0];
    if (!row) return { ai_budget_usd: null, knowledge_doc_limit: null };
    return {
      ai_budget_usd: toNumber(row.sub_ai) ?? toNumber(row.plan_ai),
      knowledge_doc_limit: toNumber(row.sub_docs) ?? toNumber(row.plan_docs),
    };
  }
}

/**
 * Limits lookup that never breaks the caller: on any error (e.g. the plans migration has not
 * run yet) it reports "no plan", so the platform defaults stay in force.
 */
export async function safeEffectiveLimits(db: IDatabaseClient, storeId: string): Promise<EffectiveLimits> {
  try {
    return await new PlanRepository(db).getEffectiveLimits(storeId);
  } catch {
    return { ai_budget_usd: null, knowledge_doc_limit: null };
  }
}
