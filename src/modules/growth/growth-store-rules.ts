/**
 * Growth Copilot rules that read the store's real Shopify orders (last 30 days), and the
 * goal-based ranking of every action. The merchant's Primary Goal decides which actions
 * come first; past results (did a completed action move revenue?) nudge similar ones up.
 */
import { StoreOrderTelemetry } from '../shopify_data/order-analytics';

export type GrowthPriority = 'critical' | 'high' | 'medium' | 'low';

export interface GrowthOpportunity {
  action_key: string;
  title: string;
  priority: GrowthPriority;
  reason: string;
  estimated_opportunity: number;
  action_type: string;
  target_module: string;
  target_id?: string;
  metadata?: Record<string, any>;
}

function money(n: number, currency: string | null): string {
  return `${currency || ''} ${Math.round(n).toLocaleString('en-IN')}`.trim();
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function storeOrderRules(t: StoreOrderTelemetry): GrowthOpportunity[] {
  const out: GrowthOpportunity[] = [];
  const cur = t.currency;
  const aov = t.totals.average_order_value || 0;

  // Revenue falling week on week (only when both weeks are fully imported)
  if (t.complete_14d !== false && t.prev7.revenue > 0 && t.last7.revenue < t.prev7.revenue * 0.8 && t.prev7.orders >= 5) {
    const drop = t.prev7.revenue - t.last7.revenue;
    out.push({
      action_key: 'revenue_decline_week',
      title: 'Revenue is down this week',
      priority: 'high',
      reason: `Last 7 days: ${money(t.last7.revenue, cur)} from ${t.last7.orders} orders, vs ${money(t.prev7.revenue, cur)} from ${t.prev7.orders} orders the week before (${Math.round((1 - t.last7.revenue / t.prev7.revenue) * 100)}% lower). Ask AI which products and channels dropped.`,
      estimated_opportunity: r2(drop * 0.5),
      action_type: 'ASK_AI',
      target_module: 'ai-agent',
      target_id: 'revenue',
      metadata: { last7: t.last7.revenue, prev7: t.prev7.revenue },
    });
  }

  // Best sellers that are sold out
  for (const p of t.sold_out_bestsellers) {
    out.push({
      action_key: 'bestseller_out_of_stock',
      title: `Restock "${p.title}"`,
      priority: 'critical',
      reason: `One of your top sellers (${p.units} units, ${money(p.revenue, cur)} in 30 days) is out of stock, so every visitor who wants it leaves without buying.`,
      estimated_opportunity: r2(p.revenue / 4),
      action_type: 'REVIEW_PRODUCT',
      target_module: 'shopify-connection',
      target_id: String(p.product_id || p.title).slice(0, 200),
      metadata: { units_30d: p.units, revenue_30d: p.revenue },
    });
  }

  // Few customers come back
  const c = t.customers;
  if (c.customers >= 20 && c.repeat_customer_share_pct < 20) {
    out.push({
      action_key: 'repeat_rate_low',
      title: 'Bring first-time buyers back',
      priority: 'high',
      reason: `Only ${c.repeat_customer_share_pct}% of your ${c.customers} buyers in the last 30 days are returning customers. Reorder reminders and a post-purchase email can lift repeat sales.`,
      estimated_opportunity: r2(c.customers * 0.05 * (aov || c.revenue_per_customer)),
      action_type: 'OPEN_REORDER',
      target_module: 'reorder-reminders',
      target_id: 'repeat',
      metadata: { repeat_share_pct: c.repeat_customer_share_pct, customers: c.customers },
    });
  }

  // Sales depend heavily on discounts
  if (t.totals.orders >= 10 && t.totals.discount_share_pct >= 25) {
    out.push({
      action_key: 'discount_dependence',
      title: 'Discounts are eating your margin',
      priority: 'medium',
      reason: `${t.totals.discount_share_pct}% of gross sales (${money(t.totals.discounts, cur)}) went to discounts in 30 days. Test a smaller code or free shipping above a threshold instead.`,
      estimated_opportunity: r2(t.totals.discounts * 0.2),
      action_type: 'ASK_AI',
      target_module: 'ai-agent',
      target_id: 'discounts',
      metadata: { discount_share_pct: t.totals.discount_share_pct },
    });
  }

  // Many refunds
  if (t.totals.orders >= 10 && t.totals.refund_rate_pct >= 8) {
    out.push({
      action_key: 'refund_rate_high',
      title: 'Refunds are high',
      priority: 'high',
      reason: `${t.totals.refund_rate_pct}% of sales (${money(t.totals.refunded, cur)}) was refunded in 30 days. Check support tickets for the common reason (size, damage, delay) and fix it at the source.`,
      estimated_opportunity: r2(t.totals.refunded * 0.3),
      action_type: 'VIEW_TICKETS',
      target_module: 'support-tickets',
      target_id: 'refunds',
      metadata: { refund_rate_pct: t.totals.refund_rate_pct },
    });
  }

  // Almost every order is a single item: room for bundles / cross-sell
  if (t.totals.orders >= 20 && t.totals.single_item_share_pct >= 70) {
    out.push({
      action_key: 'bundle_opportunity',
      title: 'Grow order value with bundles',
      priority: 'medium',
      reason: `${t.totals.single_item_share_pct}% of orders contain a single item (average order ${money(aov, cur)}). Let your assistant suggest a matching add-on, or create a bundle of your top sellers.`,
      estimated_opportunity: r2(t.totals.orders * 0.1 * aov * 0.5),
      action_type: 'VIEW_AI_ANALYTICS',
      target_module: 'my-agent',
      target_id: 'bundles',
      metadata: { single_item_share_pct: t.totals.single_item_share_pct },
    });
  }

  return out;
}

/** Which actions serve each Primary Goal. */
const GOAL_MATCH: Record<string, (o: GrowthOpportunity) => boolean> = {
  increase_revenue: (o) => ['revenue_decline_week', 'bestseller_out_of_stock', 'bundle_opportunity', 'cart_checkout_conversion', 'eligible_cart_recovery'].includes(o.action_key),
  improve_roas: (o) => o.action_type === 'VIEW_CAMPAIGN' || o.action_type === 'VIEW_ATTRIBUTION',
  improve_conversion: (o) => o.action_type === 'REVIEW_PRODUCT' || /conversion/.test(o.action_key),
  increase_repeat_purchases: (o) => o.action_type === 'OPEN_REORDER' || o.action_key === 'repeat_rate_low',
  recover_abandoned_carts: (o) => o.action_type === 'OPEN_CART_RECOVERY' || o.action_type === 'OPEN_WHATSAPP_RECOVERY',
  improve_ai_conversion: (o) => o.action_key === 'boost_ai_assistant' || o.action_key === 'bundle_opportunity',
};

const RANK: GrowthPriority[] = ['low', 'medium', 'high', 'critical'];

function bump(p: GrowthPriority, steps: number): GrowthPriority {
  return RANK[Math.max(0, Math.min(RANK.length - 1, RANK.indexOf(p) + steps))];
}

/**
 * Goal actions go up two levels (the biggest one to critical); an action type whose earlier
 * completion was followed by higher revenue goes up one more.
 */
export function prioritizeForGoal(
  opps: GrowthOpportunity[],
  goal: string,
  provenActionTypes: Set<string> = new Set()
): GrowthOpportunity[] {
  const matches = GOAL_MATCH[goal] || (() => false);
  const goalOpps = opps.filter(matches).sort((a, b) => b.estimated_opportunity - a.estimated_opportunity);
  const topGoalKey = goalOpps[0] ? `${goalOpps[0].action_key}|${goalOpps[0].target_id || ''}` : null;

  return opps.map((o) => {
    let priority = o.priority;
    const meta = { ...(o.metadata || {}) };
    if (matches(o)) {
      priority = `${o.action_key}|${o.target_id || ''}` === topGoalKey ? 'critical' : bump(priority, 2);
      meta.matches_goal = goal;
    }
    if (provenActionTypes.has(o.action_type)) {
      priority = bump(priority, 1);
      meta.proven_before = true;
    }
    return { ...o, priority, metadata: meta };
  });
}
