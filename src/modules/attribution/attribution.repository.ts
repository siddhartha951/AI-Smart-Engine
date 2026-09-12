import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import {
  MarketingTouchpoint,
  AdSpend,
  OrderAttribution,
  AttributionModel,
  AttributionOverview,
  ChannelPerformance,
  CampaignPerformance,
  CustomerJourneyTimeline,
  CustomerJourneyTouchpoint,
} from '../../database/types';
import { TenantIsolationError, ValidationError } from '../../utils/errors';

export class AttributionRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  // ==========================================
  // 1. Marketing Touchpoints Ingestion
  // ==========================================

  async recordTouchpoint(
    storeId: string,
    data: {
      visitorId: string;
      sessionId?: string | null;
      touchpointType?: string;
      source?: string;
      medium?: string;
      campaign?: string;
      content?: string;
      term?: string;
      fbclid?: string;
      gclid?: string;
      ttclid?: string;
      landingPageUrl?: string;
      referrerUrl?: string;
      createdAt?: Date;
    }
  ): Promise<MarketingTouchpoint> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    if (!data.visitorId) throw new ValidationError('visitor_id is required');

    const res = await this.db.query<MarketingTouchpoint>(
      `INSERT INTO marketing_touchpoints (
         store_id, visitor_id, session_id, touchpoint_type,
         source, medium, campaign, content, term,
         fbclid, gclid, ttclid, landing_page_url, referrer_url, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        storeId,
        data.visitorId,
        data.sessionId || null,
        data.touchpointType || 'landing',
        (data.source || 'direct').toLowerCase().trim(),
        (data.medium || 'none').toLowerCase().trim(),
        (data.campaign || 'none').trim(),
        (data.content || '').trim(),
        (data.term || '').trim(),
        (data.fbclid || '').trim(),
        (data.gclid || '').trim(),
        (data.ttclid || '').trim(),
        data.landingPageUrl || '',
        data.referrerUrl || '',
        data.createdAt || new Date(),
      ]
    );

    return res.rows[0];
  }

  async getVisitorTouchpoints(
    storeId: string,
    visitorId: string,
    beforeDate?: Date
  ): Promise<MarketingTouchpoint[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    let query = `
      SELECT * FROM marketing_touchpoints 
      WHERE store_id = $1 AND visitor_id = $2
    `;
    const params: any[] = [storeId, visitorId];

    if (beforeDate) {
      params.push(beforeDate);
      query += ` AND created_at <= $${params.length}`;
    }

    query += ` ORDER BY created_at ASC`;
    const res = await this.db.query<MarketingTouchpoint>(query, params);
    return res.rows;
  }

  // ==========================================
  // 2. Ad Spend Management
  // ==========================================

  async upsertAdSpend(
    storeId: string,
    data: {
      spendDate: string; // YYYY-MM-DD
      platform: string;
      campaign: string;
      spendAmount: number;
      currency?: string;
      notes?: string;
    }
  ): Promise<AdSpend> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    if (data.spendAmount < 0) {
      throw new ValidationError('Ad spend amount cannot be negative');
    }

    const spendDate = data.spendDate.trim();
    const platform = data.platform.toLowerCase().trim();
    const campaign = data.campaign.trim() || 'general';
    const currency = (data.currency || 'GBP').toUpperCase().trim();
    const notes = data.notes || '';

    // pg-mem safe SELECT then UPDATE or INSERT
    const check = await this.db.query<AdSpend>(
      `SELECT * FROM ad_spend 
       WHERE store_id = $1 AND spend_date = $2 AND platform = $3 AND campaign = $4`,
      [storeId, spendDate, platform, campaign]
    );

    if (check.rows.length > 0) {
      const res = await this.db.query<AdSpend>(
        `UPDATE ad_spend 
         SET spend_amount = $1, currency = $2, notes = $3, updated_at = NOW() 
         WHERE store_id = $4 AND spend_date = $5 AND platform = $6 AND campaign = $7 
         RETURNING *`,
        [data.spendAmount, currency, notes, storeId, spendDate, platform, campaign]
      );
      return res.rows[0];
    } else {
      const res = await this.db.query<AdSpend>(
        `INSERT INTO ad_spend (store_id, spend_date, platform, campaign, spend_amount, currency, notes) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [storeId, spendDate, platform, campaign, data.spendAmount, currency, notes]
      );
      return res.rows[0];
    }
  }

  async listAdSpend(
    storeId: string,
    filters?: {
      fromDate?: string;
      toDate?: string;
      platform?: string;
      campaign?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ spend: AdSpend[]; total: number }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    let whereSql = 'WHERE store_id = $1';
    const params: any[] = [storeId];

    if (filters?.fromDate) {
      params.push(filters.fromDate);
      whereSql += ` AND spend_date >= $${params.length}`;
    }
    if (filters?.toDate) {
      params.push(filters.toDate);
      whereSql += ` AND spend_date <= $${params.length}`;
    }
    if (filters?.platform) {
      params.push(filters.platform.toLowerCase().trim());
      whereSql += ` AND platform = $${params.length}`;
    }
    if (filters?.campaign) {
      params.push(filters.campaign.trim());
      whereSql += ` AND campaign = $${params.length}`;
    }

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ad_spend ${whereSql}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;
    params.push(limit, offset);

    const listRes = await this.db.query<AdSpend>(
      `SELECT * FROM ad_spend ${whereSql} 
       ORDER BY spend_date DESC, created_at DESC 
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { spend: listRes.rows, total };
  }

  async deleteAdSpend(storeId: string, id: string): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query(
      `DELETE FROM ad_spend WHERE store_id = $1 AND id = $2`,
      [storeId, id]
    );
    return (res.rowCount || 0) > 0;
  }

  // ==========================================
  // 3. Order Attribution Persistence
  // ==========================================

  async getOrderAttribution(storeId: string, orderId: string): Promise<OrderAttribution | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<OrderAttribution>(
      `SELECT * FROM order_attributions WHERE store_id = $1 AND order_id = $2`,
      [storeId, orderId]
    );
    return res.rows[0] || null;
  }

  async recordOrderAttribution(
    storeId: string,
    data: {
      orderId: string;
      orderNumber?: string | null;
      visitorId?: string | null;
      customerEmail?: string | null;
      orderRevenue: number;
      currency?: string;
      orderCreatedAt: Date;
      firstTouchpointId?: string | null;
      firstTouchSource?: string;
      firstTouchCampaign?: string;
      lastTouchpointId?: string | null;
      lastTouchSource?: string;
      lastTouchCampaign?: string;
      touchpointCount: number;
      isAiAssisted: boolean;
      aiAssistedRevenue: number;
      aiSessionId?: string | null;
      matchedRecommendationIds?: string[];
    },
    linearSplits: Array<{
      touchpointId: string;
      weight: number;
      attributedRevenue: number;
      source: string;
      campaign: string;
    }>
  ): Promise<OrderAttribution> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // Deduplication check: if order attribution already exists, return it
    const existing = await this.getOrderAttribution(storeId, data.orderId);
    if (existing) {
      return existing;
    }

    const res = await this.db.query<OrderAttribution>(
      `INSERT INTO order_attributions (
         store_id, order_id, order_number, visitor_id, customer_email,
         order_revenue, currency, order_created_at,
         first_touchpoint_id, first_touch_source, first_touch_campaign,
         last_touchpoint_id, last_touch_source, last_touch_campaign,
         touchpoint_count, is_ai_assisted, ai_assisted_revenue,
         ai_session_id, matched_recommendation_ids
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        storeId,
        data.orderId,
        data.orderNumber || null,
        data.visitorId || null,
        data.customerEmail || null,
        data.orderRevenue,
        data.currency || 'GBP',
        data.orderCreatedAt,
        data.firstTouchpointId || null,
        data.firstTouchSource || 'direct',
        data.firstTouchCampaign || 'none',
        data.lastTouchpointId || null,
        data.lastTouchSource || 'direct',
        data.lastTouchCampaign || 'none',
        data.touchpointCount,
        data.isAiAssisted,
        data.aiAssistedRevenue,
        data.aiSessionId || null,
        data.matchedRecommendationIds || [],
      ]
    );

    const saved = res.rows[0];

    // Insert linear touchpoint splits
    for (const split of linearSplits) {
      await this.db.query(
        `INSERT INTO order_attribution_touchpoints (
           store_id, order_id, touchpoint_id, weight, attributed_revenue, source, campaign
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          storeId,
          data.orderId,
          split.touchpointId,
          split.weight,
          split.attributedRevenue,
          split.source,
          split.campaign,
        ]
      );
    }

    return saved;
  }

  // ==========================================
  // 4. Analytics, ROAS & Performance Aggregation
  // ==========================================

  async getAttributionOverview(
    storeId: string,
    model: AttributionModel = 'last_touch',
    dateRange?: { fromDate?: string; toDate?: string }
  ): Promise<AttributionOverview> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    let spendWhere = 'WHERE store_id = $1';
    let orderWhere = 'WHERE store_id = $1';
    const spendParams: any[] = [storeId];
    const orderParams: any[] = [storeId];

    if (dateRange?.fromDate) {
      spendParams.push(dateRange.fromDate);
      spendWhere += ` AND spend_date >= $${spendParams.length}`;

      orderParams.push(dateRange.fromDate);
      orderWhere += ` AND order_created_at >= $${orderParams.length}`;
    }
    if (dateRange?.toDate) {
      spendParams.push(dateRange.toDate);
      spendWhere += ` AND spend_date <= $${spendParams.length}`;

      orderParams.push(dateRange.toDate);
      orderWhere += ` AND order_created_at <= $${orderParams.length}`;
    }

    // 1. Total Ad Spend
    const spendRes = await this.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(spend_amount), 0) as total FROM ad_spend ${spendWhere}`,
      spendParams
    );
    const totalSpend = parseFloat(spendRes.rows[0]?.total || '0');

    // 2. Orders & Attributed Revenue
    const orderRes = await this.db.query<{
      total_orders: string;
      total_revenue: string;
      ai_revenue: string;
      currency: string;
    }>(
      `SELECT 
         COUNT(*) as total_orders,
         COALESCE(SUM(order_revenue), 0) as total_revenue,
         COALESCE(SUM(ai_assisted_revenue), 0) as ai_revenue,
         MAX(currency) as currency
       FROM order_attributions ${orderWhere}`,
      orderParams
    );

    const totalOrders = parseInt(orderRes.rows[0]?.total_orders || '0', 10);
    const attributedRevenue = parseFloat(orderRes.rows[0]?.total_revenue || '0');
    const aiAssistedRevenue = parseFloat(orderRes.rows[0]?.ai_revenue || '0');
    const currency = orderRes.rows[0]?.currency || 'GBP';

    // ROAS = Attributed Revenue / Spend (Safe division)
    const roas = totalSpend > 0
      ? Number((attributedRevenue / totalSpend).toFixed(2))
      : 0.0;

    return {
      model,
      total_spend: Number(totalSpend.toFixed(2)),
      attributed_revenue: Number(attributedRevenue.toFixed(2)),
      total_orders: totalOrders,
      roas,
      ai_assisted_revenue: Number(aiAssistedRevenue.toFixed(2)),
      currency,
    };
  }

  async getChannelPerformance(
    storeId: string,
    model: AttributionModel = 'last_touch',
    dateRange?: { fromDate?: string; toDate?: string }
  ): Promise<ChannelPerformance[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // 1. Get spend aggregated by platform/channel
    let spendWhere = 'WHERE store_id = $1';
    const spendParams: any[] = [storeId];
    if (dateRange?.fromDate) {
      spendParams.push(dateRange.fromDate);
      spendWhere += ` AND spend_date >= $${spendParams.length}`;
    }
    if (dateRange?.toDate) {
      spendParams.push(dateRange.toDate);
      spendWhere += ` AND spend_date <= $${spendParams.length}`;
    }

    const spendRes = await this.db.query<{ platform: string; spend: string }>(
      `SELECT platform, COALESCE(SUM(spend_amount), 0) as spend 
       FROM ad_spend ${spendWhere} 
       GROUP BY platform`,
      spendParams
    );

    const spendMap = new Map<string, number>();
    for (const r of spendRes.rows) {
      spendMap.set(r.platform.toLowerCase(), parseFloat(r.spend || '0'));
    }

    // 2. Get revenue and orders aggregated by channel depending on model
    let orderWhere = 'WHERE store_id = $1';
    const orderParams: any[] = [storeId];
    if (dateRange?.fromDate) {
      orderParams.push(dateRange.fromDate);
      orderWhere += ` AND order_created_at >= $${orderParams.length}`;
    }
    if (dateRange?.toDate) {
      orderParams.push(dateRange.toDate);
      orderWhere += ` AND order_created_at <= $${orderParams.length}`;
    }

    const channelMap = new Map<string, { orders: number; revenue: number }>();

    if (model === 'linear') {
      let tpWhere = 'WHERE oat.store_id = $1';
      const tpParams: any[] = [storeId];
      if (dateRange?.fromDate) {
        tpParams.push(dateRange.fromDate);
        tpWhere += ` AND oat.created_at >= $${tpParams.length}`;
      }
      if (dateRange?.toDate) {
        tpParams.push(dateRange.toDate);
        tpWhere += ` AND oat.created_at <= $${tpParams.length}`;
      }

      const linearRes = await this.db.query<{
        source: string;
        orders_count: string;
        revenue: string;
      }>(
        `SELECT 
           oat.source,
           COUNT(DISTINCT oat.order_id) as orders_count,
           COALESCE(SUM(oat.attributed_revenue), 0) as revenue
         FROM order_attribution_touchpoints oat
         ${tpWhere}
         GROUP BY oat.source`,
        tpParams
      );

      for (const r of linearRes.rows) {
        const ch = (r.source || 'direct').toLowerCase();
        channelMap.set(ch, {
          orders: parseInt(r.orders_count || '0', 10),
          revenue: parseFloat(r.revenue || '0'),
        });
      }
    } else {
      const sourceCol = model === 'first_touch' ? 'first_touch_source' : 'last_touch_source';
      const ordersRes = await this.db.query<{
        channel: string;
        orders: string;
        revenue: string;
      }>(
        `SELECT 
           ${sourceCol} as channel,
           COUNT(*) as orders,
           COALESCE(SUM(order_revenue), 0) as revenue
         FROM order_attributions
         ${orderWhere}
         GROUP BY ${sourceCol}`,
        orderParams
      );

      for (const r of ordersRes.rows) {
        const ch = (r.channel || 'direct').toLowerCase();
        channelMap.set(ch, {
          orders: parseInt(r.orders || '0', 10),
          revenue: parseFloat(r.revenue || '0'),
        });
      }
    }

    // Combine all unique channels from spend and orders
    const allChannels = new Set<string>([...spendMap.keys(), ...channelMap.keys()]);
    if (allChannels.size === 0) {
      allChannels.add('direct');
    }

    const results: ChannelPerformance[] = [];
    for (const ch of allChannels) {
      const spend = spendMap.get(ch) || 0;
      const orderData = channelMap.get(ch) || { orders: 0, revenue: 0 };
      const roas = spend > 0 ? Number((orderData.revenue / spend).toFixed(2)) : 0.0;

      results.push({
        channel: ch,
        spend: Number(spend.toFixed(2)),
        orders: orderData.orders,
        attributed_revenue: Number(orderData.revenue.toFixed(2)),
        roas,
        currency: 'GBP',
      });
    }

    return results.sort((a, b) => b.attributed_revenue - a.attributed_revenue);
  }

  async getCampaignPerformance(
    storeId: string,
    model: AttributionModel = 'last_touch',
    dateRange?: { fromDate?: string; toDate?: string }
  ): Promise<CampaignPerformance[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    let spendWhere = 'WHERE store_id = $1';
    const spendParams: any[] = [storeId];
    if (dateRange?.fromDate) {
      spendParams.push(dateRange.fromDate);
      spendWhere += ` AND spend_date >= $${spendParams.length}`;
    }
    if (dateRange?.toDate) {
      spendParams.push(dateRange.toDate);
      spendWhere += ` AND spend_date <= $${spendParams.length}`;
    }

    const spendRes = await this.db.query<{
      campaign: string;
      platform: string;
      spend: string;
    }>(
      `SELECT campaign, platform, COALESCE(SUM(spend_amount), 0) as spend 
       FROM ad_spend ${spendWhere} 
       GROUP BY campaign, platform`,
      spendParams
    );

    const campMap = new Map<string, { source: string; spend: number; orders: number; revenue: number }>();
    for (const r of spendRes.rows) {
      campMap.set(r.campaign, {
        source: r.platform,
        spend: parseFloat(r.spend || '0'),
        orders: 0,
        revenue: 0,
      });
    }

    let orderWhere = 'WHERE store_id = $1';
    const orderParams: any[] = [storeId];
    if (dateRange?.fromDate) {
      orderParams.push(dateRange.fromDate);
      orderWhere += ` AND order_created_at >= $${orderParams.length}`;
    }
    if (dateRange?.toDate) {
      orderParams.push(dateRange.toDate);
      orderWhere += ` AND order_created_at <= $${orderParams.length}`;
    }

    if (model === 'linear') {
      let tpWhere = 'WHERE oat.store_id = $1';
      const tpParams: any[] = [storeId];
      if (dateRange?.fromDate) {
        tpParams.push(dateRange.fromDate);
        tpWhere += ` AND oat.created_at >= $${tpParams.length}`;
      }
      if (dateRange?.toDate) {
        tpParams.push(dateRange.toDate);
        tpWhere += ` AND oat.created_at <= $${tpParams.length}`;
      }

      const linearRes = await this.db.query<{
        campaign: string;
        source: string;
        orders_count: string;
        revenue: string;
      }>(
        `SELECT 
           oat.campaign,
           oat.source,
           COUNT(DISTINCT oat.order_id) as orders_count,
           COALESCE(SUM(oat.attributed_revenue), 0) as revenue
         FROM order_attribution_touchpoints oat
         ${tpWhere}
         GROUP BY oat.campaign, oat.source`,
        tpParams
      );

      for (const r of linearRes.rows) {
        const camp = r.campaign || 'none';
        const existing = campMap.get(camp) || {
          source: r.source || 'direct',
          spend: 0,
          orders: 0,
          revenue: 0,
        };
        existing.orders = parseInt(r.orders_count || '0', 10);
        existing.revenue = parseFloat(r.revenue || '0');
        campMap.set(camp, existing);
      }
    } else {
      const campCol = model === 'first_touch' ? 'first_touch_campaign' : 'last_touch_campaign';
      const sourceCol = model === 'first_touch' ? 'first_touch_source' : 'last_touch_source';

      const campOrdersRes = await this.db.query<{
        campaign: string;
        source: string;
        orders: string;
        revenue: string;
      }>(
        `SELECT 
           ${campCol} as campaign,
           ${sourceCol} as source,
           COUNT(*) as orders,
           COALESCE(SUM(order_revenue), 0) as revenue
         FROM order_attributions
         ${orderWhere}
         GROUP BY ${campCol}, ${sourceCol}`,
        orderParams
      );

      for (const r of campOrdersRes.rows) {
        const camp = r.campaign || 'none';
        const existing = campMap.get(camp) || {
          source: r.source || 'direct',
          spend: 0,
          orders: 0,
          revenue: 0,
        };
        existing.orders = parseInt(r.orders || '0', 10);
        existing.revenue = parseFloat(r.revenue || '0');
        campMap.set(camp, existing);
      }
    }

    const results: CampaignPerformance[] = [];
    for (const [campName, data] of campMap.entries()) {
      const roas = data.spend > 0 ? Number((data.revenue / data.spend).toFixed(2)) : 0.0;
      results.push({
        campaign: campName,
        source: data.source,
        spend: Number(data.spend.toFixed(2)),
        orders: data.orders,
        attributed_revenue: Number(data.revenue.toFixed(2)),
        roas,
        currency: 'GBP',
      });
    }

    return results.sort((a, b) => b.attributed_revenue - a.attributed_revenue);
  }

  // ==========================================
  // 5. Customer Journey Reconstruction
  // ==========================================

  async getCustomerJourney(storeId: string, orderId: string): Promise<CustomerJourneyTimeline | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const orderAttr = await this.getOrderAttribution(storeId, orderId);
    if (!orderAttr) return null;

    const timeline: CustomerJourneyTouchpoint[] = [];

    // 1. Pull touchpoints
    if (orderAttr.visitor_id) {
      const touchpoints = await this.getVisitorTouchpoints(
        storeId,
        orderAttr.visitor_id,
        orderAttr.order_created_at
      );

      for (const tp of touchpoints) {
        timeline.push({
          id: tp.id,
          type: 'touchpoint',
          title: `Touchpoint: ${tp.source.toUpperCase()} (${tp.medium || 'cpc'})`,
          subtitle: `Campaign: ${tp.campaign || 'none'}${tp.fbclid ? ' • Meta Click' : ''}${tp.gclid ? ' • Google Click' : ''}${tp.ttclid ? ' • TikTok Click' : ''}`,
          timestamp: tp.created_at,
          metadata: {
            source: tp.source,
            medium: tp.medium,
            campaign: tp.campaign,
            content: tp.content,
            landing_page: tp.landing_page_url,
            referrer: tp.referrer_url,
          },
        });
      }

      // 2. Pull AI Chat Sessions
      const chatRes = await this.db.query(
        `SELECT id, started_at, summary FROM chat_sessions 
         WHERE store_id = $1 AND visitor_id = $2 AND started_at <= $3 
         ORDER BY started_at ASC`,
        [storeId, orderAttr.visitor_id, orderAttr.order_created_at]
      );

      for (const cs of chatRes.rows) {
        timeline.push({
          id: cs.id,
          type: 'ai_session',
          title: 'AI Shopping Assistant Conversation',
          subtitle: cs.summary || 'Shopper explored catalogue recommendations',
          timestamp: cs.started_at,
          metadata: { sessionId: cs.id },
        });
      }

      // 3. Pull Cart Add events
      const cartRes = await this.db.query(
        `SELECT id, created_at, payload FROM events 
         WHERE store_id = $1 AND visitor_id = $2 AND type = 'add_to_cart' AND created_at <= $3 
         ORDER BY created_at ASC`,
        [storeId, orderAttr.visitor_id, orderAttr.order_created_at]
      );

      for (const c of cartRes.rows) {
        timeline.push({
          id: c.id,
          type: 'cart_add',
          title: 'Added Item to Cart',
          subtitle: c.payload?.title || 'Product item added from assistant',
          timestamp: c.created_at,
          metadata: c.payload || {},
        });
      }
    }

    // 4. Add the purchase event itself
    timeline.push({
      id: orderAttr.order_id,
      type: 'order',
      title: `Shopify Purchase: #${orderAttr.order_number || orderAttr.order_id}`,
      subtitle: `Total: ${orderAttr.currency} ${Number(orderAttr.order_revenue).toFixed(2)}${orderAttr.is_ai_assisted ? ' • AI-Assisted' : ''}`,
      timestamp: orderAttr.order_created_at,
      metadata: {
        revenue: orderAttr.order_revenue,
        currency: orderAttr.currency,
        is_ai_assisted: orderAttr.is_ai_assisted,
        ai_assisted_revenue: orderAttr.ai_assisted_revenue,
      },
    });

    // Sort complete journey chronologically
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return {
      order_id: orderAttr.order_id,
      order_number: orderAttr.order_number,
      order_revenue: orderAttr.order_revenue,
      currency: orderAttr.currency,
      visitor_id: orderAttr.visitor_id,
      customer_email: orderAttr.customer_email,
      first_touch: {
        source: orderAttr.first_touch_source,
        campaign: orderAttr.first_touch_campaign,
      },
      last_touch: {
        source: orderAttr.last_touch_source,
        campaign: orderAttr.last_touch_campaign,
      },
      is_ai_assisted: orderAttr.is_ai_assisted,
      ai_assisted_revenue: orderAttr.ai_assisted_revenue,
      timeline,
    };
  }
}
