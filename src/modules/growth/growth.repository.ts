import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import {
  GrowthGoal,
  GrowthAction,
  GrowthActionHistory,
  GrowthActionStatus,
  MerchantGoalType,
} from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export class GrowthRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  // ==========================================
  // 1. Merchant Goals
  // ==========================================

  async getGrowthGoal(storeId: string): Promise<GrowthGoal> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<GrowthGoal>(
      `SELECT * FROM growth_goals WHERE store_id = $1`,
      [storeId]
    );

    if (res.rows.length > 0) {
      return res.rows[0];
    }

    // Default goal if none exists
    const inserted = await this.db.query<GrowthGoal>(
      `INSERT INTO growth_goals (store_id, primary_goal, target_metric, target_value, created_at, updated_at)
       VALUES ($1, 'increase_revenue', 'total_revenue', 10000.00, NOW(), NOW())
       RETURNING *`,
      [storeId]
    );
    return inserted.rows[0];
  }

  async setGrowthGoal(
    storeId: string,
    primaryGoal: MerchantGoalType,
    targetMetric?: string | null,
    targetValue?: number | null
  ): Promise<GrowthGoal> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const existing = await this.db.query(
      `SELECT id FROM growth_goals WHERE store_id = $1`,
      [storeId]
    );

    if (existing.rows.length > 0) {
      const res = await this.db.query<GrowthGoal>(
        `UPDATE growth_goals
         SET primary_goal = $2,
             target_metric = $3,
             target_value = $4,
             updated_at = NOW()
         WHERE store_id = $1
         RETURNING *`,
        [storeId, primaryGoal, targetMetric || null, targetValue || null]
      );
      return res.rows[0];
    }

    const res = await this.db.query<GrowthGoal>(
      `INSERT INTO growth_goals (store_id, primary_goal, target_metric, target_value, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING *`,
      [storeId, primaryGoal, targetMetric || null, targetValue || null]
    );
    return res.rows[0];
  }

  // ==========================================
  // 2. Growth Actions
  // ==========================================

  async getActions(storeId: string, status?: GrowthActionStatus): Promise<GrowthAction[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    let sql = `SELECT * FROM growth_actions WHERE store_id = $1`;
    const params: any[] = [storeId];

    if (status) {
      sql += ` AND status = $2`;
      params.push(status);
    } else {
      sql += ` AND status != 'dismissed'`;
    }

    sql += ` ORDER BY CASE priority
      WHEN 'critical' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE 5 END ASC, estimated_opportunity DESC, created_at DESC`;

    const res = await this.db.query<GrowthAction>(sql, params);
    return res.rows;
  }

  async getActionById(storeId: string, actionId: string): Promise<GrowthAction | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<GrowthAction>(
      `SELECT * FROM growth_actions WHERE store_id = $1 AND id = $2`,
      [storeId, actionId]
    );
    return res.rows[0] || null;
  }

  async upsertAction(
    storeId: string,
    action: {
      action_key: string;
      title: string;
      priority: string;
      reason: string;
      estimated_opportunity: number;
      action_type: string;
      target_module: string;
      target_id?: string;
      status?: GrowthActionStatus;
      metadata?: Record<string, any>;
    }
  ): Promise<GrowthAction> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const targetId = action.target_id || '';
    const existing = await this.db.query<GrowthAction>(
      `SELECT id, status FROM growth_actions WHERE store_id = $1 AND action_key = $2 AND target_id = $3`,
      [storeId, action.action_key, targetId]
    );

    if (existing.rows.length > 0) {
      // Preserve status if already completed or dismissed
      const currentStatus = existing.rows[0].status;
      const statusToSet = currentStatus === 'completed' || currentStatus === 'dismissed'
        ? currentStatus
        : (action.status || currentStatus || 'pending');

      const res = await this.db.query<GrowthAction>(
        `UPDATE growth_actions
         SET title = $4,
             priority = $5,
             reason = $6,
             estimated_opportunity = $7,
             action_type = $8,
             target_module = $9,
             status = $10,
             metadata = $11,
             updated_at = NOW()
         WHERE store_id = $1 AND action_key = $2 AND target_id = $3
         RETURNING *`,
        [
          storeId,
          action.action_key,
          targetId,
          action.title,
          action.priority,
          action.reason,
          action.estimated_opportunity,
          action.action_type,
          action.target_module,
          statusToSet,
          JSON.stringify(action.metadata || {})
        ]
      );
      return res.rows[0];
    }

    const res = await this.db.query<GrowthAction>(
      `INSERT INTO growth_actions (
         store_id, action_key, title, priority, reason, estimated_opportunity,
         action_type, target_module, target_id, status, metadata, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [
        storeId,
        action.action_key,
        action.title,
        action.priority,
        action.reason,
        action.estimated_opportunity,
        action.action_type,
        action.target_module,
        targetId,
        action.status || 'pending',
        JSON.stringify(action.metadata || {})
      ]
    );
    return res.rows[0];
  }

  async updateActionStatus(
    storeId: string,
    actionId: string,
    status: GrowthActionStatus,
    userId?: string | null,
    notes?: string | null
  ): Promise<GrowthAction | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const action = await this.getActionById(storeId, actionId);
    if (!action) return null;

    const res = await this.db.query<GrowthAction>(
      `UPDATE growth_actions
       SET status = $3,
           updated_at = NOW()
       WHERE store_id = $1 AND id = $2
       RETURNING *`,
      [storeId, actionId, status]
    );

    // Record action history
    await this.db.query(
      `INSERT INTO growth_action_history (store_id, action_id, action_key, action_type, status, user_id, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [storeId, actionId, action.action_key, action.action_type, status, userId || null, notes || null]
    );

    return res.rows[0];
  }

  async getActionHistory(storeId: string, limit: number = 50): Promise<GrowthActionHistory[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<GrowthActionHistory>(
      `SELECT * FROM growth_action_history WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [storeId, limit]
    );
    return res.rows;
  }

  // ==========================================
  // 3. Multi-Module Telemetry Aggregation
  // ==========================================

  async getRawTelemetry(storeId: string) {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // 1. Store Currency & Name
    const storeRes = await this.db.query(
      `SELECT brand_name, currency FROM stores WHERE id = $1`,
      [storeId]
    );
    const store = storeRes.rows[0] || {};
    // Same fallback as the rest of the dashboard (/features, /home) so pages never disagree
    const currency = store.currency || 'INR';

    // 2. Orders & Revenue from order_attributions
    const ordersRes = await this.db.query(
      `SELECT 
         COUNT(*) as total_orders,
         COALESCE(SUM(order_revenue), 0) as total_revenue,
         COALESCE(AVG(order_revenue), 0) as avg_order_value,
         COALESCE(SUM(CASE WHEN is_ai_assisted THEN order_revenue ELSE 0 END), 0) as ai_assisted_revenue,
         COUNT(CASE WHEN is_ai_assisted THEN 1 END) as ai_assisted_orders
       FROM order_attributions
       WHERE store_id = $1`,
      [storeId]
    );
    const ordersData = ordersRes.rows[0] || {};
    let totalOrders = parseInt(ordersData.total_orders || '0', 10);
    let totalRevenue = parseFloat(ordersData.total_revenue || '0');
    let avgOrderValue = parseFloat(ordersData.avg_order_value || '0');
    const aiAssistedRevenue = parseFloat(ordersData.ai_assisted_revenue || '0');
    const aiAssistedOrders = parseInt(ordersData.ai_assisted_orders || '0', 10);

    // Fallback to events if order_attributions is empty
    if (totalOrders === 0) {
      const fallbackOrders = await this.db.query(
        `SELECT 
           COUNT(*) as total_orders,
           COALESCE(SUM(CAST(payload->>'total_price' AS NUMERIC)), 0) as total_revenue
         FROM events
         WHERE store_id = $1 AND type = 'purchase_completed'`,
        [storeId]
      );
      if (fallbackOrders.rows.length > 0 && parseInt(fallbackOrders.rows[0].total_orders, 10) > 0) {
        totalOrders = parseInt(fallbackOrders.rows[0].total_orders, 10);
        totalRevenue = parseFloat(fallbackOrders.rows[0].total_revenue);
        avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      }
    }

    // 3. Ad Spend & ROAS
    const spendRes = await this.db.query(
      `SELECT COALESCE(SUM(spend_amount), 0) as total_spend FROM ad_spend WHERE store_id = $1`,
      [storeId]
    );
    const totalSpend = parseFloat(spendRes.rows[0]?.total_spend || '0');

    // 4. Funnel Visitors
    const funnelRes = await this.db.query(
      `SELECT 
         COUNT(DISTINCT visitor_id) as total_visitors,
         COUNT(DISTINCT CASE WHEN type = 'add_to_cart' THEN visitor_id END) as cart_visitors,
         COUNT(DISTINCT CASE WHEN type = 'purchase_completed' THEN visitor_id END) as purchase_visitors
       FROM events
       WHERE store_id = $1`,
      [storeId]
    );
    const funnelData = funnelRes.rows[0] || {};
    const totalVisitors = parseInt(funnelData.total_visitors || '0', 10);
    const cartVisitors = parseInt(funnelData.cart_visitors || '0', 10);
    const purchaseVisitors = parseInt(funnelData.purchase_visitors || '0', 10);
    const conversionRate = totalVisitors > 0 ? parseFloat(((purchaseVisitors / totalVisitors) * 100).toFixed(2)) : 0;

    // 5. Abandoned Carts
    // Distinct visitors who added to cart but never completed a purchase
    const abandonedRes = await this.db.query(
      `SELECT COUNT(DISTINCT e.visitor_id) as abandoned_count
       FROM events e
       WHERE e.store_id = $1 AND e.type = 'add_to_cart'
       AND e.visitor_id NOT IN (
         SELECT visitor_id FROM events WHERE store_id = $1 AND type = 'purchase_completed'
       )`,
      [storeId]
    );
    const abandonedCartsCount = parseInt(abandonedRes.rows[0]?.abandoned_count || '0', 10);

    // Consented abandoned carts (eligible for recovery)
    const eligibleAbandonedRes = await this.db.query(
      `SELECT COUNT(DISTINCT e.visitor_id) as eligible_count
       FROM events e
       JOIN visitors v ON v.id = e.visitor_id AND v.store_id = e.store_id
       LEFT JOIN marketing_consents mc ON mc.store_id = v.store_id AND mc.visitor_id = v.id AND mc.opted_in = true
       LEFT JOIN whatsapp_consents wc ON wc.store_id = v.store_id AND wc.visitor_id = v.id AND wc.opted_in = true
       WHERE e.store_id = $1 AND e.type = 'add_to_cart'
       AND (mc.id IS NOT NULL OR wc.id IS NOT NULL)
       AND e.visitor_id NOT IN (
         SELECT visitor_id FROM events WHERE store_id = $1 AND type = 'purchase_completed'
       )`,
      [storeId]
    );
    const eligibleAbandonedCarts = parseInt(eligibleAbandonedRes.rows[0]?.eligible_count || '0', 10);

    // 6. Replenishment Schedules Due
    const reordersRes = await this.db.query(
      `SELECT 
         COUNT(*) as due_count,
         COUNT(CASE WHEN status = 'repurchased' THEN 1 END) as converted_count,
         COALESCE(SUM(CASE WHEN status = 'repurchased' THEN 1 ELSE 0 END), 0) as reorder_orders
       FROM replenishment_schedules
       WHERE store_id = $1 AND status = 'pending' AND reminder_at <= NOW() + INTERVAL '7 days'`,
      [storeId]
    );
    const reordersDue = parseInt(reordersRes.rows[0]?.due_count || '0', 10);

    // 7. Campaign ROAS Breakdown
    const campaignRes = await this.db.query(
      `SELECT 
         s.campaign,
         s.platform as channel,
         COALESCE(SUM(s.spend_amount), 0) as spend,
         COALESCE(a.revenue, 0) as revenue,
         COALESCE(a.orders, 0) as orders
       FROM ad_spend s
       LEFT JOIN (
         SELECT 
           campaign,
           SUM(attributed_revenue) as revenue,
           COUNT(DISTINCT order_id) as orders
         FROM order_attribution_touchpoints
         WHERE store_id = $1
         GROUP BY campaign
       ) a ON a.campaign = s.campaign
       WHERE s.store_id = $1
       GROUP BY s.campaign, s.platform, a.revenue, a.orders`,
      [storeId]
    );

    // 8. AI Recommendations & Clicks
    const aiRecsRes = await this.db.query(
      `SELECT 
         COUNT(*) as total_recommendations,
         COUNT(DISTINCT session_id) as rec_sessions
       FROM recommendations
       WHERE store_id = $1`,
      [storeId]
    );
    const totalRecommendations = parseInt(aiRecsRes.rows[0]?.total_recommendations || '0', 10);

    const productClickRes = await this.db.query(
      `SELECT COUNT(*) as click_count FROM events WHERE store_id = $1 AND type = 'product_click'`,
      [storeId]
    );
    const totalProductClicks = parseInt(productClickRes.rows[0]?.click_count || '0', 10);

    // 9. Email Recovery Performance (connects the email module to growth telemetry)
    const emailRes = await this.db.query(
      `SELECT
         COUNT(*) as jobs_total,
         COUNT(*) FILTER (WHERE status = 'sent') as jobs_sent,
         COUNT(*) FILTER (WHERE status = 'failed') as jobs_failed,
         COUNT(*) FILTER (WHERE status = 'cancelled') as jobs_cancelled
       FROM email_campaign_events
       WHERE store_id = $1`,
      [storeId]
    );
    const emailJobs = emailRes.rows[0] || {};
    const emailJobsTotal = parseInt(emailJobs.jobs_total || '0', 10);
    const emailJobsSent = parseInt(emailJobs.jobs_sent || '0', 10);
    const emailJobsFailed = parseInt(emailJobs.jobs_failed || '0', 10);
    const emailJobsCancelled = parseInt(emailJobs.jobs_cancelled || '0', 10);

    // Revenue recovered via email: purchases by visitors who received a sent
    // recovery email before completing the purchase. Written without a
    // correlated subquery for pg-mem compatibility (tests run on pg-mem).
    const emailRecoveredRes = await this.db.query(
      `SELECT
         COUNT(DISTINCT e.visitor_id) as recovered_shoppers,
         COALESCE(SUM(CAST(e.payload->>'total_price' AS NUMERIC)), 0) as recovered_revenue
       FROM events e
       JOIN (
         SELECT visitor_id, MIN(sent_at) as first_sent_at
         FROM email_campaign_events
         WHERE store_id = $1 AND status = 'sent' AND sent_at IS NOT NULL
         GROUP BY visitor_id
       ) fre ON fre.visitor_id = e.visitor_id AND fre.first_sent_at <= e.created_at
       WHERE e.store_id = $1
         AND e.type = 'purchase_completed'
         AND e.payload->>'total_price' IS NOT NULL
         AND e.payload->>'total_price' <> ''`,
      // Exactly one bound value: Postgres rejects extra parameters (this broke every Growth Copilot endpoint)
      [storeId]
    );
    const emailRecovered = emailRecoveredRes.rows[0] || {};
    const emailRecoveredShoppers = parseInt(emailRecovered.recovered_shoppers || '0', 10);
    const emailRecoveredRevenue = parseFloat(emailRecovered.recovered_revenue || '0');

    // 10. WhatsApp Performance (connects the whatsapp module to growth telemetry)
    // whatsapp_* tables ship with newer migrations; degrade gracefully if absent.
    let whatsappSent = 0;
    let whatsappConversations = 0;
    let whatsappRecoveryJobsTotal = 0;
    let whatsappRecoveryJobsSent = 0;
    try {
      const waRes = await this.db.query(
        `SELECT
           COUNT(*) FILTER (WHERE direction = 'outbound' AND status IN ('sent', 'delivered', 'read')) as sent_count,
           COUNT(DISTINCT conversation_id) as conversation_count
         FROM whatsapp_messages
         WHERE store_id = $1`,
        [storeId]
      );
      whatsappSent = parseInt(waRes.rows[0]?.sent_count || '0', 10);
      whatsappConversations = parseInt(waRes.rows[0]?.conversation_count || '0', 10);

      const waJobsRes = await this.db.query(
        `SELECT
           COUNT(*) as jobs_total,
           COUNT(*) FILTER (WHERE status = 'sent') as jobs_sent
         FROM whatsapp_recovery_jobs
         WHERE store_id = $1`,
        [storeId]
      );
      whatsappRecoveryJobsTotal = parseInt(waJobsRes.rows[0]?.jobs_total || '0', 10);
      whatsappRecoveryJobsSent = parseInt(waJobsRes.rows[0]?.jobs_sent || '0', 10);
    } catch (waErr: any) {
      logger.warn(`WhatsApp telemetry unavailable for store ${storeId}: ${waErr?.message || waErr}`);
    }

    return {
      storeId,
      currency,
      totalOrders,
      totalRevenue,
      avgOrderValue,
      aiAssistedRevenue,
      aiAssistedOrders,
      totalSpend,
      totalVisitors,
      cartVisitors,
      purchaseVisitors,
      conversionRate,
      abandonedCartsCount,
      eligibleAbandonedCarts,
      reordersDue,
      campaigns: campaignRes.rows.map((r: any) => ({
        campaign: r.campaign,
        channel: r.channel,
        spend: parseFloat(r.spend || '0'),
        revenue: parseFloat(r.revenue || '0'),
        orders: parseInt(r.orders || '0', 10),
        roas: parseFloat(r.spend) > 0 ? parseFloat((parseFloat(r.revenue) / parseFloat(r.spend)).toFixed(2)) : 0
      })),
      totalRecommendations,
      totalProductClicks,
      emailRecovery: {
        jobsTotal: emailJobsTotal,
        jobsSent: emailJobsSent,
        jobsFailed: emailJobsFailed,
        jobsCancelled: emailJobsCancelled,
        recoveredShoppers: emailRecoveredShoppers,
        recoveredRevenue: emailRecoveredRevenue,
      },
      whatsapp: {
        messagesSent: whatsappSent,
        conversations: whatsappConversations,
        recoveryJobsTotal: whatsappRecoveryJobsTotal,
        recoveryJobsSent: whatsappRecoveryJobsSent,
      },
    };
  }
}
