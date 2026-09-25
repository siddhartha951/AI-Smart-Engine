import { ALL_FEATURE_KEYS, FeatureKey } from '../entitlements/entitlement.types';

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'past_due', 'paused', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Yearly billing charges 10 months (2 months free). */
export const YEARLY_MONTHS_CHARGED = 10;

export interface Plan {
  id: string;
  name: string;
  tagline: string | null;
  price_inr_monthly: number | null;
  price_usd_monthly: number | null;
  ai_budget_usd: number | null;
  knowledge_doc_limit: number | null;
  features: FeatureKey[];
  sort_order: number;
  is_active: boolean;
}

export interface StoreSubscription {
  store_id: string;
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
  updated_at: string | null;
}

export interface FeatureSection {
  id: string;
  name: string;
  features: FeatureKey[];
}

/**
 * How features are grouped everywhere a person sees them (admin store page, plans matrix,
 * merchant "What your plan includes"). Every feature key appears in exactly one section.
 */
export const FEATURE_SECTIONS: FeatureSection[] = [
  { id: 'home', name: 'Home & analytics', features: ['overview', 'live_pulse', 'funnel', 'growth_copilot'] },
  { id: 'assistant', name: 'AI Assistant', features: ['widget', 'catalogue'] },
  { id: 'inbox', name: 'Inbox & customers', features: ['leads', 'support_tickets', 'freshdesk'] },
  { id: 'marketing', name: 'Marketing', features: ['email_automation', 'smart_reorder', 'whatsapp'] },
  { id: 'ads', name: 'Ads', features: ['meta_ads', 'ads_explorer', 'ad_creative', 'ad_intelligence'] },
  { id: 'ai_tools', name: 'AI tools', features: ['ai_agent_chat', 'ai_store_analysis'] },
];

/** Short, merchant-facing names (the catalogue names are longer admin descriptions). */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  overview: 'Home and KPIs',
  live_pulse: 'Live Pulse',
  funnel: 'Conversion funnel',
  growth_copilot: 'Growth Copilot',
  widget: 'Storefront assistant and widget',
  catalogue: 'Shopify catalog and variants',
  leads: 'Leads and opt-ins',
  support_tickets: 'Support tickets',
  freshdesk: 'Freshdesk integration',
  email_automation: 'Email recovery',
  smart_reorder: 'Smart reorder reminders',
  whatsapp: 'WhatsApp',
  meta_ads: 'Meta Ads performance',
  ads_explorer: 'Creatives library',
  ad_creative: 'Create ads with AI',
  ad_intelligence: 'Attribution',
  ai_agent_chat: 'Ask AI (business analyst)',
  ai_store_analysis: 'AI store audit',
};

/**
 * Features every plan includes. The admin still switches them per store (store feature
 * switches), but they cannot be taken out of a plan.
 */
export const ALWAYS_INCLUDED_FEATURES: FeatureKey[] = ['freshdesk'];

/** A plan's feature list plus the always-included features, in catalogue order. */
export function withAlwaysIncluded(features: FeatureKey[]): FeatureKey[] {
  const set = new Set<FeatureKey>([...features, ...ALWAYS_INCLUDED_FEATURES]);
  return ALL_FEATURE_KEYS.filter((key) => set.has(key));
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (ALL_FEATURE_KEYS as string[]).includes(value);
}

/** Keeps only known feature keys, de-duplicated, in catalogue order. */
export function normalizeFeatureList(value: unknown): FeatureKey[] {
  let list: unknown = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const wanted = new Set(list.filter(isFeatureKey));
  return ALL_FEATURE_KEYS.filter((key) => wanted.has(key));
}

/** List price for a cycle in the plan's own currency, or null for custom-priced plans. */
export function planListPrice(plan: Plan, currency: string, cycle: BillingCycle): number | null {
  const monthly = currency === 'USD' ? plan.price_usd_monthly : plan.price_inr_monthly;
  if (monthly === null || monthly === undefined) return null;
  return cycle === 'yearly' ? monthly * YEARLY_MONTHS_CHARGED : monthly;
}

/** The cheapest active plan that includes a feature (for "available on Pro" badges). */
export function cheapestPlanWith(feature: FeatureKey, plans: Plan[]): Plan | null {
  return (
    plans
      .filter((p) => p.is_active && p.features.includes(feature))
      .sort((a, b) => a.sort_order - b.sort_order)[0] || null
  );
}
