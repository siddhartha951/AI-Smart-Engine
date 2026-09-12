import crypto from 'crypto';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';

export interface CompactProductSummary {
  id: string;
  title: string;
  price: number;
  currency: string;
  category: string;
  in_stock: boolean;
  handle: string;
}

export interface StoreIntelligenceContext {
  storeId: string;
  brandName: string;
  shopDomain: string;
  currency: string;
  policies: {
    delivery: string;
    returns: string;
    faq: string;
  };
  catalogue: {
    totalProducts: number;
    inStockCount: number;
    outOfStockCount: number;
    categories: string[];
    topProducts: CompactProductSummary[];
  };
  leadsAndCustomers: {
    totalVisitors: number;
    identifiedLeads: number;
    marketingOptInCount: number;
    totalChatSessions: number;
  };
  funnelAndSales: {
    pageViews: number;
    addCartEvents: number;
    purchaseEvents: number;
    totalRevenue: number;
    averageOrderValue: number;
    cartToPurchaseRate: number;
  };
  marketing: {
    recoveryJobsTotal: number;
    recoveryJobsSent: number;
    replenishmentSchedulesActive: number;
    totalTouchpoints: number;
    topAttributionSources: Array<{ source: string; revenue: number; orders: number }>;
    totalAdSpend: number;
    blendedRoas: number;
  };
  dataHash: string;
}

export class AiContextService {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  /**
   * Assembles a bounded, compact Store Intelligence Context scoped strictly to storeId.
   */
  async getStoreContext(storeId: string): Promise<StoreIntelligenceContext> {
    const [
      storeRes,
      policiesRes,
      assistantRes,
      productStatsRes,
      topProductsRes,
      visitorsRes,
      consentsRes,
      chatRes,
      eventsRes,
      revenueRes,
      emailRes,
      replenishRes,
      touchpointsRes,
      attributionRes,
      adSpendRes,
    ] = await Promise.all([
      // 1. Store
      this.db.query('SELECT brand_name, shop_domain FROM stores WHERE id = $1', [storeId]),
      // 2. Policies
      this.db.query('SELECT delivery_policy, returns_policy, faq_content FROM store_policies WHERE store_id = $1', [storeId]),
      // 3. Assistant
      this.db.query('SELECT assistant_name, is_active FROM assistant_settings WHERE store_id = $1', [storeId]),
      // 4. Products stats
      this.db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE in_stock = true) as in_stock,
          COUNT(*) FILTER (WHERE in_stock = false) as out_of_stock,
          ARRAY_AGG(DISTINCT category) FILTER (WHERE category IS NOT NULL AND category != '') as categories
        FROM products 
        WHERE store_id = $1
      `, [storeId]),
      // 5. Top products sample (up to 12)
      this.db.query(`
        SELECT id, title, price, currency, category, in_stock, handle
        FROM products 
        WHERE store_id = $1
        ORDER BY in_stock DESC, updated_at DESC
        LIMIT 12
      `, [storeId]),
      // 6. Visitors & leads
      this.db.query(`
        SELECT 
          COUNT(*) as total_visitors,
          COUNT(*) FILTER (WHERE email IS NOT NULL OR phone IS NOT NULL) as identified_leads
        FROM visitors 
        WHERE store_id = $1
      `, [storeId]),
      // 7. Consents
      this.db.query('SELECT COUNT(*) as count FROM marketing_consents WHERE store_id = $1 AND opted_in = true', [storeId]),
      // 8. Chats
      this.db.query('SELECT COUNT(*) as count FROM chat_sessions WHERE store_id = $1', [storeId]),
      // 9. Funnel events
      this.db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE type = 'page_view') as pvs,
          COUNT(*) FILTER (WHERE type = 'add_to_cart') as atcs,
          COUNT(*) FILTER (WHERE type = 'purchase_completed') as purchases
        FROM events 
        WHERE store_id = $1
      `, [storeId]),
      // 10. Revenue
      this.db.query(`
        SELECT 
          COALESCE(SUM(order_revenue), 0) as total_rev,
          COUNT(*) as order_count,
          COALESCE(AVG(order_revenue), 0) as aov
        FROM order_attributions 
        WHERE store_id = $1
      `, [storeId]),
      // 11. Email recovery
      this.db.query(`
        SELECT 
          COUNT(*) as total_jobs,
          COUNT(*) FILTER (WHERE status = 'sent') as sent_jobs
        FROM email_campaign_events 
        WHERE store_id = $1
      `, [storeId]),
      // 12. Replenishment schedules
      this.db.query(`
        SELECT COUNT(*) as active_count 
        FROM replenishment_schedules 
        WHERE store_id = $1 AND status = 'active'
      `, [storeId]),
      // 13. Touchpoints
      this.db.query('SELECT COUNT(*) as count FROM marketing_touchpoints WHERE store_id = $1', [storeId]),
      // 14. Attribution top channels
      this.db.query(`
        SELECT 
          COALESCE(last_touch_source, 'direct') as source,
          COUNT(*) as orders,
          COALESCE(SUM(order_revenue), 0) as revenue
        FROM order_attributions 
        WHERE store_id = $1
        GROUP BY COALESCE(last_touch_source, 'direct')
        ORDER BY revenue DESC
        LIMIT 5
      `, [storeId]),
      // 15. Ad spend
      this.db.query(`
        SELECT COALESCE(SUM(spend_amount), 0) as total_spend 
        FROM ad_spend 
        WHERE store_id = $1
      `, [storeId]),
    ]);

    const store = storeRes.rows[0] || {};
    const policies = policiesRes.rows[0] || {};
    const pStats = productStatsRes.rows[0] || {};
    const vStats = visitorsRes.rows[0] || {};
    const eStats = eventsRes.rows[0] || {};
    const rStats = revenueRes.rows[0] || {};
    const emStats = emailRes.rows[0] || {};

    const totalRev = parseFloat(rStats.total_rev || '0');
    const totalOrders = parseInt(rStats.order_count || '0', 10);
    const atcCount = parseInt(eStats.atcs || '0', 10);
    const purchaseCount = parseInt(eStats.purchases || '0', 10) || totalOrders;
    const cartToPurchaseRate = atcCount > 0 ? (purchaseCount / atcCount) * 100 : 0;
    const totalSpend = parseFloat(adSpendRes.rows[0]?.total_spend || '0');
    const roas = totalSpend > 0 ? totalRev / totalSpend : 0;

    const topProducts: CompactProductSummary[] = topProductsRes.rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      price: parseFloat(r.price || '0'),
      currency: r.currency || 'GBP',
      category: r.category || 'General',
      in_stock: Boolean(r.in_stock),
      handle: r.handle || '',
    }));

    const topAttributionSources = attributionRes.rows.map((r: any) => ({
      source: r.source,
      revenue: parseFloat(r.revenue || '0'),
      orders: parseInt(r.orders || '0', 10),
    }));

    // Build fingerprint for caching
    const rawFingerprint = `${storeId}:${pStats.total || 0}:${vStats.total_visitors || 0}:${purchaseCount}:${totalRev.toFixed(2)}:${totalSpend.toFixed(2)}`;
    const dataHash = crypto.createHash('md5').update(rawFingerprint).digest('hex');

    return {
      storeId,
      brandName: store.brand_name || 'Store',
      shopDomain: store.shop_domain || '',
      currency: topProducts[0]?.currency || 'GBP',
      policies: {
        delivery: policies.delivery_policy || 'Standard delivery in 2-4 business days.',
        returns: policies.returns_policy || '30-day return policy.',
        faq: policies.faq_content || '',
      },
      catalogue: {
        totalProducts: parseInt(pStats.total || '0', 10),
        inStockCount: parseInt(pStats.in_stock || '0', 10),
        outOfStockCount: parseInt(pStats.out_of_stock || '0', 10),
        categories: pStats.categories || [],
        topProducts,
      },
      leadsAndCustomers: {
        totalVisitors: parseInt(vStats.total_visitors || '0', 10),
        identifiedLeads: parseInt(vStats.identified_leads || '0', 10),
        marketingOptInCount: parseInt(consentsRes.rows[0]?.count || '0', 10),
        totalChatSessions: parseInt(chatRes.rows[0]?.count || '0', 10),
      },
      funnelAndSales: {
        pageViews: parseInt(eStats.pvs || '0', 10),
        addCartEvents: atcCount,
        purchaseEvents: purchaseCount,
        totalRevenue: totalRev,
        averageOrderValue: totalOrders > 0 ? totalRev / totalOrders : 0,
        cartToPurchaseRate: parseFloat(cartToPurchaseRate.toFixed(1)),
      },
      marketing: {
        recoveryJobsTotal: parseInt(emStats.total_jobs || '0', 10),
        recoveryJobsSent: parseInt(emStats.sent_jobs || '0', 10),
        replenishmentSchedulesActive: parseInt(replenishRes.rows[0]?.active_count || '0', 10),
        totalTouchpoints: parseInt(touchpointsRes.rows[0]?.count || '0', 10),
        topAttributionSources,
        totalAdSpend: totalSpend,
        blendedRoas: parseFloat(roas.toFixed(2)),
      },
      dataHash,
    };
  }
}
