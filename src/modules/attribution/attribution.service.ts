import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { AttributionRepository } from './attribution.repository';
import {
  MarketingTouchpoint,
  AdSpend,
  OrderAttribution,
  AttributionModel,
  AttributionOverview,
  ChannelPerformance,
  CampaignPerformance,
  CustomerJourneyTimeline,
} from '../../database/types';
import { ValidationError, TenantIsolationError } from '../../utils/errors';
import { logger } from '../../utils/logger';

export class AttributionService {
  private db: IDatabaseClient;
  private repo: AttributionRepository;

  constructor(opts?: { db?: IDatabaseClient; repo?: AttributionRepository }) {
    this.db = opts?.db || getDatabaseClient();
    this.repo = opts?.repo || new AttributionRepository(this.db);
  }

  // ==========================================
  // 1. Touchpoint Capture & Normalization
  // ==========================================

  async recordTouchpoint(
    storeId: string,
    params: {
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
    if (!params.visitorId) throw new ValidationError('visitor_id is required');

    let source = (params.source || '').trim().toLowerCase();
    let medium = (params.medium || '').trim().toLowerCase();
    const campaign = (params.campaign || 'none').trim();
    const fbclid = (params.fbclid || '').trim();
    const gclid = (params.gclid || '').trim();
    const ttclid = (params.ttclid || '').trim();

    // Auto-resolve source/medium from Click IDs if not specified or direct
    if (!source || source === 'direct') {
      if (fbclid) {
        source = 'facebook';
        medium = medium && medium !== 'none' ? medium : 'paid_social';
      } else if (gclid) {
        source = 'google';
        medium = medium && medium !== 'none' ? medium : 'cpc';
      } else if (ttclid) {
        source = 'tiktok';
        medium = medium && medium !== 'none' ? medium : 'paid_social';
      } else {
        source = 'direct';
        medium = medium || 'none';
      }
    }

    return this.repo.recordTouchpoint(storeId, {
      ...params,
      source,
      medium,
      campaign,
      fbclid,
      gclid,
      ttclid,
    });
  }

  // ==========================================
  // 2. Order Attribution Calculation (Deterministic)
  // ==========================================

  async processOrderAttribution(
    storeId: string,
    orderData: any,
    visitorId?: string | null,
    sessionId?: string | null
  ): Promise<OrderAttribution> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    if (!orderData || !orderData.id) {
      throw new ValidationError('Valid order data with id is required');
    }

    const orderId = String(orderData.id);
    const orderNumber = String(orderData.order_number || orderData.name || orderData.id);
    const orderRevenue = parseFloat(orderData.total_price || '0');
    const currency = (orderData.currency || 'GBP').toUpperCase();
    const orderCreatedAt = orderData.created_at ? new Date(orderData.created_at) : new Date();
    const customerEmail = (orderData.email || orderData.contact_email || orderData.customer?.email || '').trim().toLowerCase() || null;

    // Idempotency: Return existing if already attributed
    const existing = await this.repo.getOrderAttribution(storeId, orderId);
    if (existing) {
      return existing;
    }

    // Check for inline UTMs or Click IDs in order data (note_attributes / landing_site)
    let inlineUtmSource = '';
    let inlineUtmMedium = '';
    let inlineUtmCampaign = '';
    let inlineUtmContent = '';
    let inlineUtmTerm = '';
    let inlineFbclid = '';
    let inlineGclid = '';
    let inlineTtclid = '';
    let landingUrl = '';
    let referrerUrl = '';

    if (Array.isArray(orderData.note_attributes)) {
      for (const attr of orderData.note_attributes) {
        const name = (attr.name || '').toLowerCase();
        const val = String(attr.value || '').trim();
        if (name === 'utm_source') inlineUtmSource = val;
        if (name === 'utm_medium') inlineUtmMedium = val;
        if (name === 'utm_campaign') inlineUtmCampaign = val;
        if (name === 'utm_content') inlineUtmContent = val;
        if (name === 'utm_term') inlineUtmTerm = val;
        if (name === 'fbclid') inlineFbclid = val;
        if (name === 'gclid') inlineGclid = val;
        if (name === 'ttclid') inlineTtclid = val;
      }
    }

    if (orderData.landing_site && typeof orderData.landing_site === 'string') {
      try {
        const u = new URL(orderData.landing_site, 'https://example.com');
        landingUrl = orderData.landing_site;
        if (u.searchParams.get('utm_source')) inlineUtmSource = u.searchParams.get('utm_source')!;
        if (u.searchParams.get('utm_medium')) inlineUtmMedium = u.searchParams.get('utm_medium')!;
        if (u.searchParams.get('utm_campaign')) inlineUtmCampaign = u.searchParams.get('utm_campaign')!;
        if (u.searchParams.get('utm_content')) inlineUtmContent = u.searchParams.get('utm_content')!;
        if (u.searchParams.get('utm_term')) inlineUtmTerm = u.searchParams.get('utm_term')!;
        if (u.searchParams.get('fbclid')) inlineFbclid = u.searchParams.get('fbclid')!;
        if (u.searchParams.get('gclid')) inlineGclid = u.searchParams.get('gclid')!;
        if (u.searchParams.get('ttclid')) inlineTtclid = u.searchParams.get('ttclid')!;
      } catch (_) {}
    }

    if (orderData.referring_site && typeof orderData.referring_site === 'string') {
      referrerUrl = orderData.referring_site;
    }

    // If inline marketing parameters exist and visitorId is provided, persist touchpoint
    if (visitorId && (inlineUtmSource || inlineFbclid || inlineGclid || inlineTtclid || inlineUtmCampaign)) {
      try {
        await this.recordTouchpoint(storeId, {
          visitorId,
          sessionId: sessionId || null,
          touchpointType: 'landing',
          source: inlineUtmSource,
          medium: inlineUtmMedium,
          campaign: inlineUtmCampaign,
          content: inlineUtmContent,
          term: inlineUtmTerm,
          fbclid: inlineFbclid,
          gclid: inlineGclid,
          ttclid: inlineTtclid,
          landingPageUrl: landingUrl,
          referrerUrl,
          createdAt: orderCreatedAt,
        });
      } catch (err) {
        logger.warn(`Failed to record inline touchpoint for order ${orderId}: ${err}`);
      }
    }

    // Retrieve all touchpoints for this visitor before or at order time
    let touchpoints: MarketingTouchpoint[] = [];
    if (visitorId) {
      touchpoints = await this.repo.getVisitorTouchpoints(storeId, visitorId, orderCreatedAt);
    }

    const touchpointCount = touchpoints.length;

    // 1. Determine First-Touch Attribution
    let firstTouchId: string | null = null;
    let firstTouchSource = 'direct';
    let firstTouchCampaign = 'none';

    if (touchpointCount > 0) {
      const first = touchpoints[0];
      firstTouchId = first.id;
      firstTouchSource = first.source || 'direct';
      firstTouchCampaign = first.campaign || 'none';
    }

    // 2. Determine Last-Touch Attribution
    let lastTouchId: string | null = null;
    let lastTouchSource = 'direct';
    let lastTouchCampaign = 'none';

    if (touchpointCount > 0) {
      const last = touchpoints[touchpointCount - 1];
      lastTouchId = last.id;
      lastTouchSource = last.source || 'direct';
      lastTouchCampaign = last.campaign || 'none';
    }

    // 3. Determine Linear Multi-Touch Attribution Splits
    const linearSplits: Array<{
      touchpointId: string;
      weight: number;
      attributedRevenue: number;
      source: string;
      campaign: string;
    }> = [];

    if (touchpointCount > 0) {
      const weight = Number((1 / touchpointCount).toFixed(4));
      const perTouchRevenue = Number((orderRevenue / touchpointCount).toFixed(2));

      for (const tp of touchpoints) {
        linearSplits.push({
          touchpointId: tp.id,
          weight,
          attributedRevenue: perTouchRevenue,
          source: tp.source || 'direct',
          campaign: tp.campaign || 'none',
        });
      }
    }

    // 4. Deterministic AI-Assisted Revenue Detection
    let isAiAssisted = false;
    let aiAssistedRevenue = 0;
    let aiSessionId: string | null = null;
    const matchedRecommendationIds: string[] = [];

    if (visitorId) {
      // Look back up to 30 days prior to order
      const cutoff = new Date(orderCreatedAt.getTime() - 30 * 86400000);

      // Check if visitor had an active chat session before purchase
      const sessionRes = await this.db.query(
        `SELECT id FROM chat_sessions 
         WHERE store_id = $1 AND visitor_id = $2 AND started_at >= $3 AND started_at <= $4 
         ORDER BY started_at DESC LIMIT 1`,
        [storeId, visitorId, cutoff, orderCreatedAt]
      );

      if (sessionRes.rows.length > 0) {
        aiSessionId = sessionRes.rows[0].id;
        isAiAssisted = true;
      }

      // Check recommendations table for this visitor's sessions
      const recRes = await this.db.query<{
        id: string;
        product_id: string;
        variant_id: string;
        price: string;
      }>(
        `SELECT r.id, r.product_id, r.variant_id, r.price 
         FROM recommendations r
         JOIN chat_sessions cs ON r.session_id = cs.id
         WHERE r.store_id = $1 AND cs.visitor_id = $2 AND r.created_at >= $3 AND r.created_at <= $4`,
        [storeId, visitorId, cutoff, orderCreatedAt]
      );

      if (recRes.rows.length > 0) {
        const lineItems = Array.isArray(orderData.line_items) ? orderData.line_items : [];
        let matchedItemsRevenue = 0;

        for (const item of lineItems) {
          const pId = String(item.product_id || '');
          const vId = String(item.variant_id || '');
          const itemPrice = parseFloat(item.price || '0');
          const itemQty = parseInt(item.quantity || '1', 10);

          const matchingRec = recRes.rows.find(
            (r) => r.product_id === pId || (vId && r.variant_id === vId)
          );

          if (matchingRec) {
            matchedRecommendationIds.push(matchingRec.id);
            matchedItemsRevenue += itemPrice * itemQty;
            isAiAssisted = true;
          }
        }

        if (matchedItemsRevenue > 0) {
          aiAssistedRevenue = Math.min(matchedItemsRevenue, orderRevenue);
        } else if (isAiAssisted) {
          // If customer chatted with assistant prior to purchase, attribute order value
          aiAssistedRevenue = orderRevenue;
        }
      } else if (isAiAssisted) {
        aiAssistedRevenue = orderRevenue;
      }
    }

    // Persist order attribution
    return this.repo.recordOrderAttribution(
      storeId,
      {
        orderId,
        orderNumber,
        visitorId: visitorId || null,
        customerEmail,
        orderRevenue,
        currency,
        orderCreatedAt,
        firstTouchpointId: firstTouchId,
        firstTouchSource,
        firstTouchCampaign,
        lastTouchpointId: lastTouchId,
        lastTouchSource,
        lastTouchCampaign,
        touchpointCount,
        isAiAssisted,
        aiAssistedRevenue: Number(aiAssistedRevenue.toFixed(2)),
        aiSessionId,
        matchedRecommendationIds,
      },
      linearSplits
    );
  }

  // ==========================================
  // 3. Ad Spend Management Layer
  // ==========================================

  async createAdSpend(
    storeId: string,
    data: {
      spendDate: string;
      platform: string;
      campaign: string;
      spendAmount: number;
      currency?: string;
      notes?: string;
    }
  ): Promise<AdSpend> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    if (!data.spendDate) throw new ValidationError('spend_date is required (YYYY-MM-DD)');
    if (!data.platform) throw new ValidationError('platform is required (e.g. facebook, google, tiktok)');
    if (data.spendAmount === undefined || data.spendAmount < 0 || isNaN(data.spendAmount)) {
      throw new ValidationError('spend_amount must be a non-negative number');
    }

    return this.repo.upsertAdSpend(storeId, data);
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
    return this.repo.listAdSpend(storeId, filters);
  }

  async deleteAdSpend(storeId: string, id: string): Promise<boolean> {
    return this.repo.deleteAdSpend(storeId, id);
  }

  // ==========================================
  // 4. Reporting, ROAS & Performance
  // ==========================================

  async getOverview(
    storeId: string,
    model: AttributionModel = 'last_touch',
    dateRange?: { fromDate?: string; toDate?: string }
  ): Promise<AttributionOverview> {
    return this.repo.getAttributionOverview(storeId, model, dateRange);
  }

  async getChannelPerformance(
    storeId: string,
    model: AttributionModel = 'last_touch',
    dateRange?: { fromDate?: string; toDate?: string }
  ): Promise<ChannelPerformance[]> {
    return this.repo.getChannelPerformance(storeId, model, dateRange);
  }

  async getCampaignPerformance(
    storeId: string,
    model: AttributionModel = 'last_touch',
    dateRange?: { fromDate?: string; toDate?: string }
  ): Promise<CampaignPerformance[]> {
    return this.repo.getCampaignPerformance(storeId, model, dateRange);
  }

  async getCustomerJourney(storeId: string, orderId: string): Promise<CustomerJourneyTimeline | null> {
    return this.repo.getCustomerJourney(storeId, orderId);
  }

  calculateRoas(attributedRevenue: number, spend: number): number {
    if (!spend || spend <= 0) return 0.0;
    return Number((attributedRevenue / spend).toFixed(2));
  }
}
