import { IDatabaseClient } from '../../database/client';

export interface ActivityFeedItem {
  id: string;
  type: string;
  label: string;
  detail: string;
  icon: string;
  badge_color: string;
  created_at: Date;
  visitor_email?: string;
  visitor_id?: string;
}

export interface FunnelStage {
  stage: string;
  count: number;
  percentage: number; // relative to top of funnel
  dropoff_rate: number; // dropoff from previous stage
}

export interface ConversionFunnelData {
  timeframe_days: number;
  total_visitors: number;
  stages: FunnelStage[];
  overall_conversion_rate: number;
  /** Real Shopify orders in the same period (all channels), when orders are synced */
  store_orders: { orders: number; revenue: number } | null;
  /** True once the Shopify checkout pixel has sent an event (purchases are then tracked per shopper) */
  checkout_tracking: boolean;
}

export interface ProductPerformanceMetric {
  product_id: string;
  title: string;
  image_url: string;
  price: number;
  currency: string;
  recommendations_count: number;
  clicks_count: number;
  cart_adds_count: number;
  purchases_count: number;
  conversion_rate: number;
}

export class AnalyticsRepository {
  constructor(private db: IDatabaseClient) {}

  /**
   * 1. Active Shoppers Count
   * Calculates distinct shoppers with events within the specified inactivity window (default: 5 minutes)
   */
  async getActiveShoppersCount(storeId: string, windowMinutes: number = 5): Promise<number> {
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
    const res = await this.db.query(
      `SELECT COUNT(DISTINCT visitor_id) AS active_count
       FROM events
       WHERE store_id = $1 AND created_at >= $2`,
      [storeId, cutoff]
    );

    return parseInt(res.rows[0]?.active_count || '0', 10);
  }

  /**
   * 2. Live Activity Feed
   * Retrieves the most recent real-time actions performed by shoppers across the store
   */
  async getLiveActivityFeed(storeId: string, limit: number = 30): Promise<ActivityFeedItem[]> {
    const res = await this.db.query(
      `SELECT 
         e.id,
         e.type,
         e.payload,
         e.created_at,
         e.visitor_id,
         v.email,
         v.anonymous_id
       FROM events e
       LEFT JOIN visitors v ON v.id = e.visitor_id
       WHERE e.store_id = $1
       ORDER BY e.created_at DESC
       LIMIT $2`,
      [storeId, limit]
    );

    return res.rows.map((row: any) => {
      let payload = row.payload;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { payload = {}; }
      }
      payload = payload || {};

      let label = 'Activity Detected';
      let detail = 'Visitor browsed store';
      let icon = '👀';
      let badgeColor = '#64748b';

      switch (row.type) {
        case 'page_view':
          label = 'Page Viewed';
          detail = payload.path ? `Viewed ${payload.path}` : 'Viewed storefront page';
          icon = '🌐';
          badgeColor = '#3b82f6';
          break;
        case 'widget_opened':
          label = 'Assistant Opened';
          detail = 'Customer opened shopping assistant';
          icon = '💬';
          badgeColor = '#6366f1';
          break;
        case 'email_submitted':
          label = 'Lead Captured';
          detail = row.email ? `Contact: ${row.email}` : 'Contact information submitted';
          icon = '📧';
          badgeColor = '#8b5cf6';
          break;
        case 'marketing_opted_in':
          label = 'Marketing Opt-In';
          detail = 'Customer consented to recovery offers';
          icon = '⭐';
          badgeColor = '#10b981';
          break;
        case 'product_view':
          label = 'Product Viewed';
          detail = payload.title ? `Viewed "${payload.title}"` : 'Viewed a product page';
          icon = '👁️';
          badgeColor = '#0ea5e9';
          break;
        case 'checkout_started':
          label = 'Checkout Started';
          detail = payload.total_price ? `Checkout for ${payload.currency || ''} ${payload.total_price}` : 'Shopper started checkout';
          icon = '💳';
          badgeColor = '#f59e0b';
          break;
        case 'product_click':
          label = 'Product Clicked';
          detail = payload.title ? `Clicked "${payload.title}"` : 'Clicked recommended product';
          icon = '🔍';
          badgeColor = '#06b6d4';
          break;
        case 'add_to_cart':
          label = 'Added to Cart';
          detail = payload.title
            ? `Added "${payload.title}" (${payload.currency || 'INR'} ${payload.price || ''})`
            : 'Added product to cart';
          icon = '🛒';
          badgeColor = '#10b981';
          break;
        case 'purchase_completed':
          label = 'Purchase Completed';
          detail = payload.total_price
            ? `Order #${payload.order_number || ''} for ${payload.currency || '$'}${payload.total_price}`
            : 'Purchase successfully completed';
          icon = '🎉';
          badgeColor = '#22c55e';
          break;
        case 'heartbeat':
          label = 'Active Shopper';
          detail = 'Browsing store catalog';
          icon = '🟢';
          badgeColor = '#10b981';
          break;
        default:
          label = row.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          detail = payload.title || payload.message || 'Storefront action recorded';
          break;
      }

      return {
        id: row.id,
        type: row.type,
        label,
        detail,
        icon,
        badge_color: badgeColor,
        created_at: row.created_at,
        visitor_email: row.email || undefined,
        visitor_id: row.visitor_id,
      };
    });
  }

  /**
   * 3. Conversion Funnel
   * Generates step-by-step conversion funnel from real event metrics
   */
  async getConversionFunnel(storeId: string, days: number = 7): Promise<ConversionFunnelData> {
    const cutoff = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
    const timeFilter = cutoff ? `AND created_at >= $2` : '';
    const params: any[] = [storeId];
    if (cutoff) params.push(cutoff);

    // SQL Aggregation of distinct visitors per funnel stage
    const res = await this.db.query(
      `SELECT
         COUNT(DISTINCT visitor_id) AS total_visitors,
         COUNT(DISTINCT CASE WHEN type IN ('widget_opened', 'chat_started') THEN visitor_id END) AS chat_visitors,
         COUNT(DISTINCT CASE WHEN type IN ('product_click', 'product_view') THEN visitor_id END) AS engaged_visitors,
         COUNT(DISTINCT CASE WHEN type = 'add_to_cart' THEN visitor_id END) AS cart_visitors,
         COUNT(DISTINCT CASE WHEN type = 'checkout_started' THEN visitor_id END) AS checkout_visitors,
         COUNT(DISTINCT CASE WHEN type = 'purchase_completed' THEN visitor_id END) AS purchase_visitors
       FROM events
       WHERE store_id = $1 ${timeFilter}`,
      params
    );

    // Also count total recommendations from recommendations table
    const recsRes = await this.db.query(
      `SELECT COUNT(DISTINCT session_id) AS recs_sessions
       FROM recommendations
       WHERE store_id = $1 ${timeFilter}`,
      params
    );

    const counts = res.rows[0] || {};
    const totalVisitors = Math.max(parseInt(counts.total_visitors || '0', 10), 1); // Avoid div by zero
    const actualTotal = parseInt(counts.total_visitors || '0', 10);
    const chats = parseInt(counts.chat_visitors || '0', 10);
    const engaged = parseInt(counts.engaged_visitors || '0', 10);
    const carts = parseInt(counts.cart_visitors || '0', 10);
    const purchases = parseInt(counts.purchase_visitors || '0', 10);
    const checkouts = parseInt(counts.checkout_visitors || '0', 10);

    // Checkout is only visible once the Shopify pixel is installed; before that the stage is left out
    const pixelRes = await this.db.query(
      `SELECT 1 FROM events WHERE store_id = $1 AND payload->>'source' = 'shopify_pixel' LIMIT 1`,
      [storeId]
    );
    const checkoutTracking = pixelRes.rows.length > 0;

    let storeOrders: ConversionFunnelData['store_orders'] = null;
    try {
      const ordersRes = await this.db.query(
        `SELECT COUNT(*) AS orders, COALESCE(SUM(total_price - total_refunded), 0) AS revenue, MAX(created_at_shop) AS latest
         FROM shopify_orders WHERE store_id = $1 AND cancelled_at IS NULL AND is_test = false
         ${cutoff ? 'AND created_at_shop >= $2' : ''}`,
        params
      );
      const anyOrders = await this.db.query('SELECT 1 FROM shopify_orders WHERE store_id = $1 LIMIT 1', [storeId]);
      if (anyOrders.rows.length > 0) {
        storeOrders = {
          orders: parseInt(ordersRes.rows[0]?.orders || '0', 10),
          revenue: Math.round(parseFloat(ordersRes.rows[0]?.revenue || '0') * 100) / 100,
        };
      }
    } catch {
      storeOrders = null; // table missing before migration 040
    }

    const rawStages = [
      { stage: 'Store Visitors', count: actualTotal },
      { stage: 'AI Chats Initiated', count: chats },
      { stage: 'Products Explored', count: engaged },
      { stage: 'Added to Cart', count: carts },
      ...(checkoutTracking ? [{ stage: 'Checkout Started', count: checkouts }] : []),
      { stage: 'Completed Purchases', count: purchases },
    ];

    const stages: FunnelStage[] = rawStages.map((st, idx) => {
      const pct = actualTotal > 0 ? Math.round((st.count / totalVisitors) * 100) : 0;
      let dropoff = 0;
      if (idx > 0) {
        const prevCount = rawStages[idx - 1].count;
        dropoff = prevCount > 0 ? Math.round(((prevCount - st.count) / prevCount) * 100) : 0;
      }
      return {
        stage: st.stage,
        count: st.count,
        percentage: Math.min(pct, 100),
        dropoff_rate: Math.max(dropoff, 0),
      };
    });

    const overallConvRate = actualTotal > 0 ? parseFloat(((purchases / actualTotal) * 100).toFixed(1)) : 0;

    return {
      timeframe_days: days,
      total_visitors: actualTotal,
      stages,
      overall_conversion_rate: overallConvRate,
      store_orders: storeOrders,
      checkout_tracking: checkoutTracking,
    };
  }

  /**
   * 4. Recommendation Performance
   * Analyzes top recommended products and their engagement / conversion rates
   */
  async getRecommendationPerformance(storeId: string, limit: number = 10): Promise<ProductPerformanceMetric[]> {
    // 1. Fetch top recommended products
    const recsRes = await this.db.query(
      `SELECT 
         r.product_id,
         COUNT(*) AS recommendations_count,
         MAX(r.title) AS title,
         MAX(r.image_url) AS image_url,
         MAX(r.price) AS price,
         MAX(r.currency) AS currency
       FROM recommendations r
       WHERE r.store_id = $1
       GROUP BY r.product_id
       ORDER BY recommendations_count DESC
       LIMIT $2`,
      [storeId, limit]
    );

    if (recsRes.rows.length === 0) {
      return [];
    }

    const metrics: ProductPerformanceMetric[] = [];

    for (const row of recsRes.rows) {
      const prodId = row.product_id;
      const recCount = parseInt(row.recommendations_count || '0', 10);

      // Count clicks from events
      const clicksRes = await this.db.query(
        `SELECT COUNT(*) AS clicks_count
         FROM events
         WHERE store_id = $1 AND type = 'product_click' AND (payload->>'product_id' = $2 OR payload->>'product_id' LIKE $3)`,
        [storeId, prodId, `%${prodId}%`]
      );
      const clicks = parseInt(clicksRes.rows[0]?.clicks_count || '0', 10);

      // Count add to carts from events
      const cartsRes = await this.db.query(
        `SELECT COUNT(*) AS cart_adds_count
         FROM events
         WHERE store_id = $1 AND type = 'add_to_cart' AND (payload->>'product_id' = $2 OR payload->>'product_id' LIKE $3)`,
        [storeId, prodId, `%${prodId}%`]
      );
      const cartAdds = parseInt(cartsRes.rows[0]?.cart_adds_count || '0', 10);

      // Count purchases from events where reliable attribution exists
      const purchaseRes = await this.db.query(
        `SELECT COUNT(*) AS purchase_count
         FROM events
         WHERE store_id = $1 AND type = 'purchase_completed' AND (payload->>'product_id' = $2 OR payload::text LIKE $3)`,
        [storeId, prodId, `%"product_id":"${prodId}"%`]
      );
      const purchases = parseInt(purchaseRes.rows[0]?.purchase_count || '0', 10);

      const convRate = recCount > 0 ? parseFloat(((cartAdds / recCount) * 100).toFixed(1)) : 0;

      metrics.push({
        product_id: prodId,
        title: row.title || 'Product',
        image_url: row.image_url || '',
        price: parseFloat(row.price || '0'),
        currency: row.currency || 'INR',
        recommendations_count: recCount,
        clicks_count: clicks,
        cart_adds_count: cartAdds,
        purchases_count: purchases,
        conversion_rate: convRate,
      });
    }

    return metrics;
  }
}
