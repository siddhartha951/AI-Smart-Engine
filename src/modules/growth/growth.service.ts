import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { GrowthRepository } from './growth.repository';
import {
  GrowthOverview,
  GrowthAction,
  GrowthGoal,
  GrowthActionStatus,
  MerchantGoalType,
  WeeklyGrowthSummary,
} from '../../database/types';
import { TenantIsolationError, ValidationError } from '../../utils/errors';
import { getAiProvider } from '../../providers/ai';
import { logger } from '../../utils/logger';

export class GrowthService {
  private db: IDatabaseClient;
  private repo: GrowthRepository;

  constructor(opts?: { db?: IDatabaseClient; repo?: GrowthRepository }) {
    this.db = opts?.db || getDatabaseClient();
    this.repo = opts?.repo || new GrowthRepository(this.db);
  }

  // ==========================================
  // 1. Growth Overview
  // ==========================================

  async getOverview(storeId: string): Promise<GrowthOverview> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const telemetry = await this.repo.getRawTelemetry(storeId);
    const actions = await this.detectAndSyncOpportunities(storeId, telemetry);

    // Sum estimated opportunity across active pending actions
    const totalOpportunity = actions
      .filter(a => a.status === 'pending' || a.status === 'in_progress')
      .reduce((sum, a) => sum + Number(a.estimated_opportunity || 0), 0);

    const blendedRoas = telemetry.totalSpend > 0
      ? parseFloat((telemetry.totalRevenue / telemetry.totalSpend).toFixed(2))
      : 0;

    return {
      total_revenue: telemetry.totalRevenue,
      total_orders: telemetry.totalOrders,
      average_order_value: parseFloat(telemetry.avgOrderValue.toFixed(2)),
      conversion_rate: telemetry.conversionRate,
      total_ad_spend: telemetry.totalSpend,
      blended_roas: blendedRoas,
      ai_assisted_revenue: telemetry.aiAssistedRevenue,
      abandoned_carts_count: telemetry.abandonedCartsCount,
      reorder_schedules_due: telemetry.reordersDue,
      estimated_growth_opportunity: parseFloat(totalOpportunity.toFixed(2)),
      currency: telemetry.currency,
    };
  }

  // ==========================================
  // 2. Deterministic Opportunity Detection
  // ==========================================

  async detectAndSyncOpportunities(storeId: string, telemetryOverride?: any): Promise<GrowthAction[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const telemetry = telemetryOverride || await this.repo.getRawTelemetry(storeId);
    const goal = await this.repo.getGrowthGoal(storeId);
    const primaryGoal = goal.primary_goal || 'increase_revenue';

    const aov = telemetry.avgOrderValue > 0 ? telemetry.avgOrderValue : 50.00;
    const rawOpportunities: Array<{
      action_key: string;
      title: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
      reason: string;
      estimated_opportunity: number;
      action_type: string;
      target_module: string;
      target_id?: string;
      metadata?: Record<string, any>;
    }> = [];

    // ----------------------------------------------------
    // RULE 1: High Product Views / Clicks + Low Add to Cart
    // ----------------------------------------------------
    if (telemetry.totalProductClicks >= 10 && telemetry.cartVisitors < telemetry.totalProductClicks * 0.15) {
      const estimatedOpp = parseFloat((telemetry.totalProductClicks * 0.05 * aov).toFixed(2));
      rawOpportunities.push({
        action_key: 'product_conversion_opportunity',
        title: 'Optimize product page conversion',
        priority: 'medium',
        reason: `${telemetry.totalProductClicks} product explorations recorded, but only ${telemetry.cartVisitors} cart additions (${((telemetry.cartVisitors / Math.max(telemetry.totalProductClicks, 1)) * 100).toFixed(1)}% conversion).`,
        estimated_opportunity: estimatedOpp,
        action_type: 'REVIEW_PRODUCT',
        target_module: 'shopify-connection',
        target_id: 'catalog',
        metadata: { product_clicks: telemetry.totalProductClicks, cart_visitors: telemetry.cartVisitors }
      });
    }

    // ----------------------------------------------------
    // RULE 2: High Add to Cart + Low Purchase Conversion
    // ----------------------------------------------------
    const cartDropoffs = telemetry.cartVisitors - telemetry.purchaseVisitors;
    if (telemetry.cartVisitors >= 5 && cartDropoffs > 0) {
      const estimatedOpp = parseFloat((cartDropoffs * 0.10 * aov).toFixed(2));
      rawOpportunities.push({
        action_key: 'cart_checkout_conversion',
        title: 'High cart checkout abandonment detected',
        priority: 'high',
        reason: `${cartDropoffs} shoppers added products to cart but dropped off before completing purchase.`,
        estimated_opportunity: estimatedOpp,
        action_type: 'OPEN_CART_RECOVERY',
        target_module: 'email-automation',
        target_id: 'recovery',
        metadata: { cart_dropoffs: cartDropoffs }
      });
    }

    // ----------------------------------------------------
    // RULE 3 & RULE 8: Ad Spend & Campaign Efficiency
    // ----------------------------------------------------
    for (const camp of telemetry.campaigns) {
      // Rule 8: Spend > 0 but 0 attributed orders
      if (camp.spend > 0 && camp.orders === 0) {
        rawOpportunities.push({
          action_key: `zero_conv_campaign_${camp.campaign}`,
          title: `Zero-conversion review: ${camp.campaign}`,
          priority: 'critical',
          reason: `Campaign "${camp.campaign}" spent ${telemetry.currency} ${camp.spend.toFixed(2)} with 0 attributed orders.`,
          estimated_opportunity: camp.spend,
          action_type: 'VIEW_CAMPAIGN',
          target_module: 'ad-intelligence',
          target_id: camp.campaign,
          metadata: { spend: camp.spend, orders: camp.orders, channel: camp.channel }
        });
      }
      // Rule 3: High Spend (> 50) and Low ROAS (< 2.0x)
      else if (camp.spend >= 50 && camp.roas < 2.0) {
        const estimatedOpp = parseFloat((camp.spend * 0.35).toFixed(2));
        rawOpportunities.push({
          action_key: `low_roas_campaign_${camp.campaign}`,
          title: `Optimize low ROAS campaign: ${camp.campaign}`,
          priority: 'high',
          reason: `Campaign "${camp.campaign}" on ${camp.channel} is generating ${camp.roas}x ROAS (target: ≥ 2.0x).`,
          estimated_opportunity: estimatedOpp,
          action_type: 'VIEW_CAMPAIGN',
          target_module: 'ad-intelligence',
          target_id: camp.campaign,
          metadata: { spend: camp.spend, revenue: camp.revenue, roas: camp.roas }
        });
      }
    }

    // ----------------------------------------------------
    // RULE 4: Customers Approaching Reorder Date
    // ----------------------------------------------------
    if (telemetry.reordersDue > 0) {
      const estimatedOpp = parseFloat((telemetry.reordersDue * aov * 0.35).toFixed(2));
      rawOpportunities.push({
        action_key: 'reorder_reminders_due',
        title: `${telemetry.reordersDue} customer reorders due`,
        priority: 'high',
        reason: `${telemetry.reordersDue} consumable product reminder schedules are due for dispatch in the next 7 days.`,
        estimated_opportunity: estimatedOpp,
        action_type: 'OPEN_REORDER',
        target_module: 'reorder-reminders',
        target_id: 'schedules',
        metadata: { reorders_due: telemetry.reordersDue }
      });
    }

    // ----------------------------------------------------
    // RULE 5: Abandoned Carts Eligible for Recovery
    // ----------------------------------------------------
    if (telemetry.eligibleAbandonedCarts > 0) {
      const estimatedOpp = parseFloat((telemetry.eligibleAbandonedCarts * aov * 0.15).toFixed(2));
      rawOpportunities.push({
        action_key: 'eligible_cart_recovery',
        title: `Recover ${telemetry.eligibleAbandonedCarts} eligible abandoned carts`,
        priority: 'high',
        reason: `${telemetry.eligibleAbandonedCarts} shoppers consented to marketing and abandoned their carts with uncompleted orders.`,
        estimated_opportunity: estimatedOpp,
        action_type: 'OPEN_CART_RECOVERY',
        target_module: 'email-automation',
        target_id: 'abandoned-carts',
        metadata: { eligible_count: telemetry.eligibleAbandonedCarts }
      });
    }

    // ----------------------------------------------------
    // RULE 6: AI-Assisted Conversion Opportunity
    // ----------------------------------------------------
    if (telemetry.totalRecommendations >= 5 && telemetry.aiAssistedRevenue === 0) {
      const estimatedOpp = parseFloat((telemetry.totalRecommendations * aov * 0.08).toFixed(2));
      rawOpportunities.push({
        action_key: 'boost_ai_assistant',
        title: 'Activate shopping assistant engagement',
        priority: 'medium',
        reason: `${telemetry.totalRecommendations} recommendations generated, but no AI-assisted revenue recorded yet. Ensure assistant greeting is enabled.`,
        estimated_opportunity: estimatedOpp,
        action_type: 'VIEW_AI_ANALYTICS',
        target_module: 'my-agent',
        target_id: 'assistant-settings',
        metadata: { recommendations: telemetry.totalRecommendations }
      });
    }

    // ----------------------------------------------------
    // RULE 7: High Traffic + Low Storefront Conversion
    // ----------------------------------------------------
    if (telemetry.totalVisitors >= 30 && telemetry.conversionRate < 1.5) {
      const estimatedOpp = parseFloat((telemetry.totalVisitors * 0.015 * aov).toFixed(2));
      rawOpportunities.push({
        action_key: 'traffic_conversion_opportunity',
        title: 'Storewide conversion below 1.5% benchmark',
        priority: 'medium',
        reason: `Current store conversion rate is ${telemetry.conversionRate}% across ${telemetry.totalVisitors} visitors. Review landing pages and product hooks.`,
        estimated_opportunity: estimatedOpp,
        action_type: 'VIEW_ATTRIBUTION',
        target_module: 'ad-intelligence',
        target_id: 'attribution-overview',
        metadata: { conversion_rate: telemetry.conversionRate, visitors: telemetry.totalVisitors }
      });
    }

    // ----------------------------------------------------
    // Apply Dynamic Goal-Based Prioritization
    // ----------------------------------------------------
    const prioritized = rawOpportunities.map(opp => {
      let finalPriority = opp.priority;

      if (primaryGoal === 'improve_roas' && (opp.action_key.includes('campaign') || opp.action_type === 'VIEW_CAMPAIGN')) {
        finalPriority = 'critical';
      } else if (primaryGoal === 'recover_abandoned_carts' && opp.action_type === 'OPEN_CART_RECOVERY') {
        finalPriority = 'critical';
      } else if (primaryGoal === 'increase_repeat_purchases' && opp.action_type === 'OPEN_REORDER') {
        finalPriority = 'critical';
      } else if (primaryGoal === 'improve_ai_conversion' && opp.action_key.includes('ai')) {
        finalPriority = 'critical';
      } else if (primaryGoal === 'improve_conversion' && (opp.action_key.includes('conversion') || opp.action_type === 'REVIEW_PRODUCT')) {
        finalPriority = 'high';
      }

      return {
        ...opp,
        priority: finalPriority,
      };
    });

    // Upsert into growth_actions
    for (const opp of prioritized) {
      await this.repo.upsertAction(storeId, opp);
    }

    return this.repo.getActions(storeId);
  }

  // ==========================================
  // 3. Action Management
  // ==========================================

  async getTodayActions(storeId: string): Promise<GrowthAction[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    return this.detectAndSyncOpportunities(storeId);
  }

  async updateActionStatus(
    storeId: string,
    actionId: string,
    status: GrowthActionStatus,
    userId?: string | null,
    notes?: string | null
  ): Promise<GrowthAction> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    if (!actionId) throw new ValidationError('action_id is required');

    const updated = await this.repo.updateActionStatus(storeId, actionId, status, userId, notes);
    if (!updated) {
      throw new ValidationError(`Action ${actionId} not found`);
    }
    return updated;
  }

  async getActionHistory(storeId: string) {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    return this.repo.getActionHistory(storeId);
  }

  // ==========================================
  // 4. Goals Management
  // ==========================================

  async getGoal(storeId: string): Promise<GrowthGoal> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    return this.repo.getGrowthGoal(storeId);
  }

  async setGoal(
    storeId: string,
    primaryGoal: MerchantGoalType,
    targetMetric?: string | null,
    targetValue?: number | null
  ): Promise<GrowthGoal> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const validGoals: MerchantGoalType[] = [
      'increase_revenue',
      'improve_roas',
      'improve_conversion',
      'increase_repeat_purchases',
      'recover_abandoned_carts',
      'improve_ai_conversion'
    ];
    if (!validGoals.includes(primaryGoal)) {
      throw new ValidationError(`Invalid goal: ${primaryGoal}. Must be one of: ${validGoals.join(', ')}`);
    }

    const goal = await this.repo.setGrowthGoal(storeId, primaryGoal, targetMetric, targetValue);
    // Trigger immediate re-prioritization of actions
    await this.detectAndSyncOpportunities(storeId);
    return goal;
  }

  // ==========================================
  // 5. Weekly / Daily Summary
  // ==========================================

  async getWeeklySummary(storeId: string): Promise<WeeklyGrowthSummary> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const telemetry = await this.repo.getRawTelemetry(storeId);
    const actions = await this.repo.getActions(storeId);
    const topActions = actions.slice(0, 3);

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const roas = telemetry.totalSpend > 0
      ? parseFloat((telemetry.totalRevenue / telemetry.totalSpend).toFixed(2))
      : 0;

    const whatChanged: string[] = [];
    if (telemetry.totalRevenue > 0) {
      whatChanged.push(`Generated ${telemetry.currency} ${telemetry.totalRevenue.toFixed(2)} across ${telemetry.totalOrders} total orders.`);
    } else {
      whatChanged.push('Store launched telemetry tracking; awaiting first storefront transactions.');
    }

    if (roas > 0) {
      whatChanged.push(`Overall ad ROAS stands at ${roas}x on ${telemetry.currency} ${telemetry.totalSpend.toFixed(2)} total recorded spend.`);
    }

    if (telemetry.reordersDue > 0) {
      whatChanged.push(`${telemetry.reordersDue} consumable replenishment reminders are scheduled for repeat buyers.`);
    }

    if (telemetry.eligibleAbandonedCarts > 0) {
      whatChanged.push(`${telemetry.eligibleAbandonedCarts} consented abandoned carts are available for multi-channel recovery.`);
    }

    if (telemetry.aiAssistedRevenue > 0) {
      whatChanged.push(`AI Assistant has influenced ${telemetry.currency} ${telemetry.aiAssistedRevenue.toFixed(2)} in sales.`);
    }

    return {
      period_start: sevenDaysAgo.toISOString().split('T')[0],
      period_end: now.toISOString().split('T')[0],
      metrics: {
        revenue: telemetry.totalRevenue,
        orders: telemetry.totalOrders,
        conversion_rate: telemetry.conversionRate,
        ad_spend: telemetry.totalSpend,
        roas,
        ai_assisted_revenue: telemetry.aiAssistedRevenue,
        recovered_revenue: 0, // Tracked when recovery clicks convert
        reorder_revenue: 0,
        currency: telemetry.currency
      },
      what_changed: whatChanged,
      top_actions: topActions
    };
  }

  // ==========================================
  // 6. AI Explanation (Anti-Hallucination)
  // ==========================================

  async explainGrowth(storeId: string): Promise<{
    explanation: string;
    key_takeaways: string[];
    verified_metrics: Record<string, any>;
  }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const telemetry = await this.repo.getRawTelemetry(storeId);
    const goal = await this.repo.getGrowthGoal(storeId);
    const actions = await this.repo.getActions(storeId);

    const roas = telemetry.totalSpend > 0
      ? parseFloat((telemetry.totalRevenue / telemetry.totalSpend).toFixed(2))
      : 0;

    const verifiedMetrics = {
      primary_goal: goal.primary_goal,
      total_revenue: telemetry.totalRevenue,
      total_orders: telemetry.totalOrders,
      conversion_rate: `${telemetry.conversionRate}%`,
      total_ad_spend: telemetry.totalSpend,
      roas: `${roas}x`,
      ai_assisted_revenue: telemetry.aiAssistedRevenue,
      abandoned_carts: telemetry.abandonedCartsCount,
      reorders_due: telemetry.reordersDue,
      top_action: actions[0]?.title || 'Maintain current growth trajectory',
      currency: telemetry.currency
    };

    let explanationText = '';
    const keyTakeaways: string[] = [];

    try {
      const aiProvider = getAiProvider();
      const prompt = `You are the AI Merchant Growth Copilot for an e-commerce store.
Analyze the following VERIFIED real store metrics and provide a concise, executive 3-4 sentence growth summary and 3 bulleted strategic takeaways.
DO NOT fabricate numbers or promise guaranteed revenue. Explain what the numbers indicate.

Verified Metrics:
- Primary Store Goal: ${verifiedMetrics.primary_goal}
- Total Revenue: ${verifiedMetrics.currency} ${verifiedMetrics.total_revenue}
- Total Orders: ${verifiedMetrics.total_orders}
- Conversion Rate: ${verifiedMetrics.conversion_rate}
- Ad Spend: ${verifiedMetrics.currency} ${verifiedMetrics.total_ad_spend}
- ROAS: ${verifiedMetrics.roas}
- AI-Assisted Revenue: ${verifiedMetrics.currency} ${verifiedMetrics.ai_assisted_revenue}
- Abandoned Carts: ${verifiedMetrics.abandoned_carts}
- Due Reorders: ${verifiedMetrics.reorders_due}
- Recommended Next Step: ${verifiedMetrics.top_action}

Respond strictly in JSON format:
{
  "explanation": "concise executive summary...",
  "key_takeaways": ["takeaway 1", "takeaway 2", "takeaway 3"]
}`;

      const res = await aiProvider.generateResponse([
        { role: 'system', content: 'You are an e-commerce growth analyst. Always respond in valid JSON.' },
        { role: 'user', content: prompt }
      ], {
        storeId,
        sessionId: 'growth_copilot',
        catalogSubset: [],
        storePolicies: { delivery_policy: '', returns_policy: '', faq_content: '' },
        assistantSettings: { assistant_name: 'Growth Copilot', allowed_topics: ['analytics', 'growth'] }
      });


      try {
        const parsed = JSON.parse(res.content.replace(/```json/g, '').replace(/```/g, '').trim());
        explanationText = parsed.explanation || '';
        if (Array.isArray(parsed.key_takeaways)) {
          keyTakeaways.push(...parsed.key_takeaways);
        }
      } catch (_) {
        explanationText = res.content.trim();
      }
    } catch (err) {
      logger.warn(`AI Provider explanation fallback for store ${storeId}: ${err}`);
    }

    // Deterministic fallback if AI provider is unavailable or returned empty
    if (!explanationText) {
      explanationText = `Your store has generated ${verifiedMetrics.currency} ${telemetry.totalRevenue.toFixed(2)} across ${telemetry.totalOrders} orders with a ${telemetry.conversionRate}% storefront conversion rate. To accelerate progress toward your goal of "${goal.primary_goal}", prioritize your top action: "${verifiedMetrics.top_action}".`;
      keyTakeaways.push(
        `Conversion Rate is at ${telemetry.conversionRate}%; optimize product and checkout funnels.`,
        telemetry.totalSpend > 0 ? `Ad ROAS is ${roas}x on ${telemetry.currency} ${telemetry.totalSpend.toFixed(2)} spend.` : `No active ad spend recorded; verify campaign tracking.`,
        telemetry.reordersDue > 0 ? `${telemetry.reordersDue} reorder reminder notifications are due for repeat customers.` : `Focus on recovering ${telemetry.abandonedCartsCount} abandoned carts.`
      );
    }

    return {
      explanation: explanationText,
      key_takeaways: keyTakeaways.slice(0, 3),
      verified_metrics: verifiedMetrics,
    };
  }
}
