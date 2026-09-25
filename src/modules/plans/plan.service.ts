import { IDatabaseClient } from '../../database/client';
import { getEnvConfig } from '../../config/env';
import { FeatureKey } from '../entitlements/entitlement.types';
import { EntitlementRepository } from '../entitlements/entitlement.repository';
import { MAX_KNOWLEDGE_DOCUMENTS } from '../knowledge/knowledge-document.repository';
import { PlanRepository } from './plan.repository';
import {
  FEATURE_LABELS,
  FEATURE_SECTIONS,
  Plan,
  StoreSubscription,
  cheapestPlanWith,
  ALWAYS_INCLUDED_FEATURES,
  planListPrice,
} from './plan.types';

/** in_plan / addon / removed when the store has a plan; on / off for stores without one. */
export type FeatureBadge = 'in_plan' | 'addon' | 'removed' | 'off' | 'on';

export interface PlanFeatureView {
  key: FeatureKey;
  label: string;
  enabled: boolean;
  in_plan: boolean | null;
  badge: FeatureBadge;
  /** Cheapest plan that includes the feature, for "available on Pro" hints. */
  available_on: { id: string; name: string } | null;
}

export interface StorePlanView {
  plan: Plan | null;
  subscription: (StoreSubscription & { list_price: number | null; charged_price: number | null }) | null;
  limits: { ai_budget_usd: number; knowledge_doc_limit: number };
  usage: { ai_cost_usd: number; knowledge_documents: number };
  sections: { id: string; name: string; features: PlanFeatureView[] }[];
  enabled_count: number;
  total_features: number;
}

function badgeFor(enabled: boolean, inPlan: boolean | null): FeatureBadge {
  if (inPlan === null) return enabled ? 'on' : 'off';
  if (enabled) return inPlan ? 'in_plan' : 'addon';
  return inPlan ? 'removed' : 'off';
}

export async function buildStorePlanView(db: IDatabaseClient, storeId: string): Promise<StorePlanView> {
  const plans = new PlanRepository(db);
  const period = new Date().toISOString().substring(0, 7);
  const [subscription, allPlans, features, limits, aiRes, docsRes] = await Promise.all([
    plans.getSubscription(storeId),
    plans.listPlans(),
    new EntitlementRepository(db).getStoreEntitlements(storeId),
    plans.getEffectiveLimits(storeId),
    db.query(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM ai_usage_ledger
       WHERE store_id = $1 AND billing_period = $2`,
      [storeId, period]
    ),
    db.query('SELECT COUNT(*) AS count FROM store_knowledge_documents WHERE store_id = $1', [storeId]),
  ]);

  const plan = subscription ? allPlans.find((p) => p.id === subscription.plan_id) || null : null;
  let enabledCount = 0;
  const sections = FEATURE_SECTIONS.map((section) => ({
    id: section.id,
    name: section.name,
    features: section.features.map((key) => {
      const enabled = features[key] === true;
      if (enabled) enabledCount += 1;
      const inPlan = plan ? plan.features.includes(key) : null;
      // Features in every plan are switched per store by the admin: no plan would unlock them
      const cheapest = ALWAYS_INCLUDED_FEATURES.includes(key) ? null : cheapestPlanWith(key, allPlans);
      return {
        key,
        label: FEATURE_LABELS[key],
        enabled,
        in_plan: inPlan,
        badge: badgeFor(enabled, inPlan),
        available_on: cheapest ? { id: cheapest.id, name: cheapest.name } : null,
      };
    }),
  }));

  const listPrice = plan && subscription ? planListPrice(plan, subscription.currency, subscription.billing_cycle) : null;

  return {
    plan,
    subscription: subscription
      ? { ...subscription, list_price: listPrice, charged_price: subscription.price_amount ?? listPrice }
      : null,
    limits: {
      ai_budget_usd: limits.ai_budget_usd ?? getEnvConfig().AI_MONTHLY_BUDGET_STOP_USD,
      knowledge_doc_limit: limits.knowledge_doc_limit ?? MAX_KNOWLEDGE_DOCUMENTS,
    },
    usage: {
      ai_cost_usd: Number(aiRes.rows[0]?.total || 0),
      knowledge_documents: Number(docsRes.rows[0]?.count || 0),
    },
    sections,
    enabled_count: enabledCount,
    total_features: FEATURE_SECTIONS.reduce((n, s) => n + s.features.length, 0),
  };
}
