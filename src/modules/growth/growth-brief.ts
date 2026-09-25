/**
 * "What should I do for my goal?" The Growth Copilot's AI brief: it reads the real store
 * numbers (Shopify orders, funnel, ads, recovery) and the detected actions, and ranks the
 * three moves that best serve the merchant's Primary Goal, with the reason and the numbers.
 *
 * Cached per store + goal + data, so opening the page does not spend AI budget each time.
 * Without AI (no key / budget reached) a plain brief is built from the top actions instead.
 */
import crypto from 'crypto';
import { z } from 'zod';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';
import { AiCacheService } from '../ai/ai-cache.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { GrowthService } from './growth.service';

const GOAL_LABEL: Record<string, string> = {
  increase_revenue: 'Increase revenue',
  improve_roas: 'Improve ROAS (return on ad spend)',
  improve_conversion: 'Improve conversion rate',
  increase_repeat_purchases: 'Increase repeat purchases',
  recover_abandoned_carts: 'Recover abandoned carts',
  improve_ai_conversion: 'Improve AI assistant conversion',
};

const BriefSchema = z.object({
  headline: z.string().min(3).max(200),
  summary: z.string().min(3).max(900),
  priorities: z.array(z.object({
    title: z.string().min(2).max(160),
    why: z.string().min(2).max(500),
    how: z.string().min(2).max(500),
    expected_impact: z.string().max(200).optional().default(''),
    action_key: z.string().max(200).optional().nullable(),
  })).min(1).max(3),
  watch_out: z.array(z.string().max(300)).max(3).optional().default([]),
});

export interface ActionResult {
  title: string;
  revenue_change_pct: number | null;
  orders_change_pct: number | null;
  measured_at: string;
}

export type GoalBrief = z.infer<typeof BriefSchema> & {
  goal: string;
  source: 'ai' | 'rules';
  generated_at: string;
  /** Completed actions and what happened to sales in the 7 days after them */
  results?: ActionResult[];
};

function actionResults(actions: any[]): ActionResult[] {
  return actions
    .filter((a) => a.status === 'completed' && a.outcome)
    .map((a) => {
      const o = typeof a.outcome === 'string' ? JSON.parse(a.outcome) : a.outcome;
      return { title: a.title, revenue_change_pct: o.revenue_change_pct ?? null, orders_change_pct: o.orders_change_pct ?? null, measured_at: o.measured_at };
    })
    .slice(0, 5);
}

function r2(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

/** Compact, number-only picture of the store for the prompt (no customer data). */
function storeFacts(t: any, actions: any[]) {
  const s = t.storeOrders;
  return {
    currency: t.currency,
    sales_last_30_days: s ? s.totals : { orders: t.totalOrders, revenue: r2(t.totalRevenue), average_order_value: r2(t.avgOrderValue) },
    last_7_days: s?.last7 || null,
    previous_7_days: s?.prev7 || null,
    customers: s ? { customers: s.customers.customers, repeat_customer_share_pct: s.customers.repeat_customer_share_pct } : null,
    top_products: s?.top_products?.map((p: any) => ({ title: p.title, units: p.units, revenue: p.revenue })) || [],
    sold_out_bestsellers: s?.sold_out_bestsellers?.map((p: any) => p.title) || [],
    storefront: { visitors: t.totalVisitors, cart_visitors: t.cartVisitors, conversion_rate_pct: t.conversionRate, abandoned_carts: t.abandonedCartsCount },
    ads: { total_spend: r2(t.totalSpend), campaigns: (t.campaigns || []).slice(0, 8) },
    ai_assistant: { recommendations: t.totalRecommendations, ai_assisted_revenue: r2(t.aiAssistedRevenue) },
    recovery: { email: t.emailRecovery, whatsapp: t.whatsapp },
    detected_actions: actions.slice(0, 12).map((a) => ({
      action_key: a.action_key,
      title: a.title,
      priority: a.priority,
      reason: a.reason,
      estimated_opportunity: r2(a.estimated_opportunity),
      past_result: a.outcome || null,
    })),
  };
}

function rulesBrief(goal: string, actions: any[]): GoalBrief {
  const top = actions.filter((a) => a.status === 'pending' || a.status === 'in_progress').slice(0, 3);
  return {
    goal,
    source: 'rules',
    generated_at: new Date().toISOString(),
    headline: top.length ? `Top moves for "${GOAL_LABEL[goal] || goal}"` : 'No urgent action right now',
    summary: top.length
      ? 'Ranked from your live store data for your goal. Turn on AI for a written plan.'
      : 'Nothing stands out in the last 30 days. Keep an eye on new orders and the funnel.',
    priorities: top.length
      ? top.map((a) => ({ title: a.title, why: a.reason, how: 'Open the action to act on it.', expected_impact: '', action_key: a.action_key }))
      : [{ title: 'Keep collecting data', why: 'Not enough activity yet to recommend a change.', how: 'Check back after more orders arrive.', expected_impact: '', action_key: null }],
    watch_out: [],
  };
}

export async function getGoalBrief(
  storeId: string,
  opts: { db?: IDatabaseClient; refresh?: boolean; orchestrator?: AiOrchestratorService } = {}
): Promise<GoalBrief> {
  const db = opts.db || getDatabaseClient();
  const growth = new GrowthService({ db });
  const goal = (await growth.getGoal(storeId)).primary_goal || 'increase_revenue';
  const telemetry = await growth.loadTelemetry(storeId);
  const actions = await growth.detectAndSyncOpportunities(storeId, telemetry);
  const facts = storeFacts(telemetry, actions);

  const cache = new AiCacheService(db);
  const today = new Date().toISOString().slice(0, 10);
  const hash = crypto.createHash('sha256').update(JSON.stringify({ goal, today, facts })).digest('hex');
  if (!opts.refresh) {
    const cached = await cache.get<GoalBrief>(storeId, 'growth_goal_brief', hash);
    if (cached) return { ...cached, results: actionResults(actions) };
  }

  const prompt = `The merchant's PRIMARY GOAL is: ${GOAL_LABEL[goal] || goal}.

Here is their store data (real numbers from Shopify orders, the storefront funnel, ads and recovery tools) and the actions our rules detected:
${JSON.stringify(facts)}

Pick the 3 moves that will move THIS goal the most in the next 2 weeks. For each: a short title, why (quote the numbers above), how (concrete steps in the dashboard or in Shopify), and the expected impact (a range grounded in the data, or "not measurable yet"). Use action_key when the move matches a detected action. Add up to 3 "watch_out" risks you see in the data.

Rules: use ONLY numbers present in the data; never invent figures; if data is thin, say so in the summary. Plain, simple English.

Return JSON: {"headline": string, "summary": string, "priorities": [{"title","why","how","expected_impact","action_key"}], "watch_out": [string]}`;

  try {
    const orchestrator = opts.orchestrator || new AiOrchestratorService({ db });
    const ai = await orchestrator.generateStructuredJson(storeId, prompt, BriefSchema, {
      modelTier: 'analysis',
      temperature: 0.3,
      systemPrompt: 'You are a senior e-commerce growth analyst for a Shopify store. You are precise, practical and never invent numbers.',
    });
    const brief: GoalBrief = { ...ai, goal, source: 'ai', generated_at: new Date().toISOString() };
    await cache.set(storeId, 'growth_goal_brief', hash, brief, 6 * 3600);
    return { ...brief, results: actionResults(actions) };
  } catch (err) {
    logger.warn(`Growth goal brief fell back to rules for ${storeId}: ${(err as Error)?.message || err}`);
    return { ...rulesBrief(goal, actions), results: actionResults(actions) };
  }
}
