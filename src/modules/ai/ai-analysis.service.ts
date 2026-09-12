import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { AiCacheService } from './ai-cache.service';
import { AiContextService, StoreIntelligenceContext } from './ai-context.service';
import { AiOrchestratorService } from './ai-orchestrator.service';
import {
  AdAnalysisResult,
  AdAnalysisSchema,
  AdAskResult,
  AdAskSchema,
  CatalogueAnalysisResult,
  CatalogueAnalysisSchema,
  CopilotAskResult,
  CopilotAskSchema,
  EmailGenerationRequest,
  EmailGenerationResult,
  EmailGenerationResultSchema,
  FunnelAnalysisResult,
  FunnelAnalysisSchema,
  FunnelAskResult,
  FunnelAskSchema,
  OverviewInsightsResult,
  OverviewInsightsSchema,
  ProductSuggestions,
  ProductSuggestionsSchema,
  ReorderRecommendation,
  ReorderRecommendationsListSchema,
  StoreAnalysisResult,
  StoreAnalysisSchema,
} from './ai-types';

export class AiAnalysisService {
  private db: IDatabaseClient;
  private cache: AiCacheService;
  private contextService: AiContextService;
  private orchestrator: AiOrchestratorService;

  constructor(deps?: {
    db?: IDatabaseClient;
    cache?: AiCacheService;
    contextService?: AiContextService;
    orchestrator?: AiOrchestratorService;
  }) {
    this.db = deps?.db || getDatabaseClient();
    this.cache = deps?.cache || new AiCacheService(this.db);
    this.contextService = deps?.contextService || new AiContextService(this.db);
    this.orchestrator = deps?.orchestrator || new AiOrchestratorService({ db: this.db });
  }

  // =========================================================================
  // 1. STORE DEEP AUDIT (PHASE D)
  // =========================================================================

  async analyzeStore(storeId: string, forceRefresh: boolean = false): Promise<StoreAnalysisResult> {
    const context = await this.contextService.getStoreContext(storeId);
    const cacheKey = 'store_analysis';

    if (!forceRefresh) {
      const cached = await this.cache.get<StoreAnalysisResult>(storeId, cacheKey, context.dataHash);
      if (cached) return cached;
    }

    const prompt = `
Task: store_analysis
Perform a comprehensive store intelligence audit for merchant store "${context.brandName}" (${context.shopDomain}).
Ground every finding strictly in the real store data provided below:

Store Metrics Summary:
- Currency: ${context.currency}
- Total Catalog Products: ${context.catalogue.totalProducts} (${context.catalogue.inStockCount} in stock, ${context.catalogue.outOfStockCount} out of stock)
- Categories: ${context.catalogue.categories.join(', ') || 'General'}
- Total Visitors (30d): ${context.leadsAndCustomers.totalVisitors}
- Captured Leads: ${context.leadsAndCustomers.identifiedLeads}
- Marketing Consent Opt-Ins: ${context.leadsAndCustomers.marketingOptInCount}
- Chat Sessions: ${context.leadsAndCustomers.totalChatSessions}
- Funnel Events: ${context.funnelAndSales.pageViews} views, ${context.funnelAndSales.addCartEvents} adds-to-cart, ${context.funnelAndSales.purchaseEvents} purchases
- Total Attributed Revenue: ${context.currency} ${context.funnelAndSales.totalRevenue.toFixed(2)}
- Average Order Value: ${context.currency} ${context.funnelAndSales.averageOrderValue.toFixed(2)}
- Cart-to-Purchase Conversion: ${context.funnelAndSales.cartToPurchaseRate}%
- Abandoned Cart Recovery: ${context.marketing.recoveryJobsTotal} scheduled, ${context.marketing.recoveryJobsSent} sent
- Active Replenishment Schedules: ${context.marketing.replenishmentSchedulesActive}
- Total Ad Spend Tracked: ${context.currency} ${context.marketing.totalAdSpend.toFixed(2)}
- Blended Ad ROAS: ${context.marketing.blendedRoas}x

STRICT CONSTRAINT:
Calculate a realistic health score (0-100). If traffic or order data is sparse, state "Insufficient data to determine this" where appropriate and do NOT fabricate imaginary metrics.
`;

    const result = await this.orchestrator.generateStructuredJson<StoreAnalysisResult>(
      storeId,
      prompt,
      StoreAnalysisSchema,
      { modelTier: 'analysis' }
    );

    await this.cache.set(storeId, cacheKey, context.dataHash, result, 7200);
    return result;
  }

  // =========================================================================
  // 2. OVERVIEW INSIGHTS (PHASE E)
  // =========================================================================

  async getOverviewInsights(storeId: string, forceRefresh: boolean = false): Promise<OverviewInsightsResult> {
    const context = await this.contextService.getStoreContext(storeId);
    const cacheKey = 'overview_insights';

    if (!forceRefresh) {
      const cached = await this.cache.get<OverviewInsightsResult>(storeId, cacheKey, context.dataHash);
      if (cached) return cached;
    }

    const prompt = `
Task: overview_insights
Provide executive-level store intelligence insights for "${context.brandName}".
Focus on:
1. What is happening right now in the store?
2. Why is it happening?
3. What specific action should the merchant take next?
4. The biggest immediate opportunity and biggest immediate problem with realistic target tabs.

Store Telemetry:
- Total Products: ${context.catalogue.totalProducts}
- 30-Day Orders: ${context.funnelAndSales.purchaseEvents} | Total Revenue: ${context.currency} ${context.funnelAndSales.totalRevenue.toFixed(2)}
- Funnel: ${context.funnelAndSales.pageViews} views -> ${context.funnelAndSales.addCartEvents} carts -> ${context.funnelAndSales.purchaseEvents} orders
- Cart Conversion Rate: ${context.funnelAndSales.cartToPurchaseRate}%
- Active Reorders: ${context.marketing.replenishmentSchedulesActive}
- Recovery Queue: ${context.marketing.recoveryJobsTotal} jobs
- Blended Ad ROAS: ${context.marketing.blendedRoas}x (${context.currency} ${context.marketing.totalAdSpend} spend)
`;

    const result = await this.orchestrator.generateStructuredJson<OverviewInsightsResult>(
      storeId,
      prompt,
      OverviewInsightsSchema,
      { modelTier: 'analysis' }
    );

    await this.cache.set(storeId, cacheKey, context.dataHash, result, 3600);
    return result;
  }

  // =========================================================================
  // 3. CATALOGUE ANALYSIS & IMPROVEMENT (PHASE F)
  // =========================================================================

  async analyzeCatalogue(
    storeId: string,
    productId?: string,
    forceRefresh: boolean = false
  ): Promise<CatalogueAnalysisResult> {
    let sql = `
      SELECT id, title, price, currency, category, in_stock, handle, product_url
      FROM products 
      WHERE store_id = $1
    `;
    const params: any[] = [storeId];

    if (productId) {
      params.push(productId);
      sql += ` AND id = $${params.length}`;
    } else {
      sql += ` ORDER BY updated_at DESC LIMIT 8`;
    }

    const res = await this.db.query(sql, params);
    const products = res.rows;

    if (products.length === 0) {
      return {
        overview_summary: 'No synced products found in catalog. Run a product sync to evaluate listings.',
        average_listing_score: 0,
        products: [],
      };
    }

    const cacheKey = productId ? `catalogue_analysis_${productId}` : 'catalogue_analysis_all';
    const rawFingerprint = `${storeId}:${products.map((p: any) => `${p.id}:${p.title}:${p.price}`).join('|')}`;
    const hash = Buffer.from(rawFingerprint).toString('base64').slice(0, 32);

    if (!forceRefresh) {
      const cached = await this.cache.get<CatalogueAnalysisResult>(storeId, cacheKey, hash);
      if (cached) return cached;
    }

    const prompt = `
Task: catalogue_analysis
Analyze listing quality, discoverability, and selling propositions for the following Shopify products:
${JSON.stringify(products, null, 2)}

For each product:
- Evaluate title clarity, description quality, and benefit communication.
- Give a listing_quality_score (0-100).
- Identify specific problems.
- Suggest an improved title, structured description, 3 selling points, 2 FAQs, and recommendation tags.
- NEVER automatically apply changes to Shopify; these are merchant review suggestions only.
`;

    const result = await this.orchestrator.generateStructuredJson<CatalogueAnalysisResult>(
      storeId,
      prompt,
      CatalogueAnalysisSchema,
      { modelTier: 'analysis' }
    );

    await this.cache.set(storeId, cacheKey, hash, result, 7200);
    return result;
  }

  async generateProductImprovements(
    storeId: string,
    productId: string
  ): Promise<ProductSuggestions> {
    const res = await this.db.query(
      'SELECT id, title, price, currency, category, handle FROM products WHERE store_id = $1 AND id = $2',
      [storeId, productId]
    );

    if (res.rows.length === 0) {
      throw new Error('Product not found in catalog');
    }

    const product = res.rows[0];
    const prompt = `
Task: product_improvements
Generate high-converting, grounded listing improvements for product:
Title: ${product.title}
Price: ${product.currency} ${product.price}
Category: ${product.category || 'General'}

Provide:
- An improved, compelling product title.
- A benefit-driven, structured product description.
- 3 clear, authentic selling points.
- 2 helpful customer FAQs with answers.
- 4 recommendation tags for assistant search.
`;

    return await this.orchestrator.generateStructuredJson<ProductSuggestions>(
      storeId,
      prompt,
      ProductSuggestionsSchema,
      { modelTier: 'analysis' }
    );
  }

  // =========================================================================
  // 4. LIVE PULSE & FUNNEL AI (PHASE H)
  // =========================================================================

  async analyzeFunnel(storeId: string, forceRefresh: boolean = false): Promise<FunnelAnalysisResult> {
    const context = await this.contextService.getStoreContext(storeId);
    const cacheKey = 'funnel_analysis';

    if (!forceRefresh) {
      const cached = await this.cache.get<FunnelAnalysisResult>(storeId, cacheKey, context.dataHash);
      if (cached) return cached;
    }

    const prompt = `
Task: funnel_analysis
Analyze the storefront conversion funnel for "${context.brandName}".
Funnel Stages:
- Storefront Page Views: ${context.funnelAndSales.pageViews}
- Add-to-Cart Events: ${context.funnelAndSales.addCartEvents}
- Completed Purchases: ${context.funnelAndSales.purchaseEvents}
- Cart-to-Purchase Conversion: ${context.funnelAndSales.cartToPurchaseRate}%
- Total Attributed Revenue: ${context.currency} ${context.funnelAndSales.totalRevenue}

Identify:
- The single biggest drop-off point.
- The likely reason based on e-commerce patterns (use wording like "Possible reason" or "Likely pattern").
- Suggested actionable improvements.
`;

    const result = await this.orchestrator.generateStructuredJson<FunnelAnalysisResult>(
      storeId,
      prompt,
      FunnelAnalysisSchema,
      { modelTier: 'analysis' }
    );

    await this.cache.set(storeId, cacheKey, context.dataHash, result, 3600);
    return result;
  }

  async askFunnelQuestion(storeId: string, question: string): Promise<FunnelAskResult> {
    const context = await this.contextService.getStoreContext(storeId);

    const prompt = `
Task: funnel_ask
Merchant asked this question about their funnel:
"${question}"

Available Store Funnel Context:
- Page Views: ${context.funnelAndSales.pageViews}
- Add to Cart: ${context.funnelAndSales.addCartEvents}
- Purchases: ${context.funnelAndSales.purchaseEvents}
- Cart-to-Purchase Rate: ${context.funnelAndSales.cartToPurchaseRate}%
- Abandoned Recovery Jobs: ${context.marketing.recoveryJobsTotal}

Provide:
1. Clear, grounded answer citing supporting metrics.
2. An object of verified supporting metrics.
3. 2-3 specific actions the merchant can take.
Never claim causation unless data supports it.
`;

    return await this.orchestrator.generateStructuredJson<FunnelAskResult>(
      storeId,
      prompt,
      FunnelAskSchema,
      { modelTier: 'analysis' }
    );
  }

  // =========================================================================
  // 5. EMAIL AUTOMATION AI (PHASE I)
  // =========================================================================

  async generateEmail(storeId: string, req: EmailGenerationRequest): Promise<EmailGenerationResult> {
    const context = await this.contextService.getStoreContext(storeId);

    let productDetails = '';
    if (req.product_id) {
      const pRes = await this.db.query(
        'SELECT title, price, currency, category FROM products WHERE store_id = $1 AND id = $2',
        [storeId, req.product_id]
      );
      if (pRes.rows.length > 0) {
        const p = pRes.rows[0];
        productDetails = `Featured Product: ${p.title} (${p.currency} ${p.price})`;
      }
    }

    const prompt = `
Task: email_generation
Generate a high-converting e-commerce marketing email for "${context.brandName}".
- Email Type: ${req.email_type}
- Goal: ${req.goal}
- Tone: ${req.tone}
- Length: ${req.length}
${productDetails ? `- ${productDetails}` : ''}
${req.custom_instruction ? `- Merchant Special Instruction: ${req.custom_instruction}` : ''}
- Delivery Policy: ${context.policies.delivery}
- Returns Policy: ${context.policies.returns}

Generate:
- High-converting subject line
- Compelling preview text (preheader)
- Natural email body text with brand warmth (DO NOT include unsubscribe or legal footers; platform handles those)
- Single clear Call-To-Action (CTA button text)
- 3 alternative subject lines for A/B testing
`;

    return await this.orchestrator.generateStructuredJson<EmailGenerationResult>(
      storeId,
      prompt,
      EmailGenerationResultSchema,
      { modelTier: 'fast' }
    );
  }

  // =========================================================================
  // 6. SMART REORDER AI RECOMMENDATIONS (PHASE J)
  // =========================================================================

  async getReorderRecommendations(storeId: string): Promise<ReorderRecommendation[]> {
    const res = await this.db.query(
      `SELECT p.id, p.title, p.category, p.price, p.currency, r.replenishable, r.cycle_days
       FROM products p
       LEFT JOIN replenishment_product_settings r ON r.store_id = p.store_id AND r.product_id = p.id
       WHERE p.store_id = $1
       ORDER BY p.in_stock DESC, p.updated_at DESC
       LIMIT 20`,
      [storeId]
    );

    const products = res.rows;
    if (products.length === 0) return [];

    const prompt = `
Task: reorder_recommendations
Inspect the following store catalog products and identify items that are naturally consumable or replenishable (e.g. skincare, beauty, coffee, tea, food, vitamins, supplements, cleaning supplies, candles, filters, hygiene):
${JSON.stringify(products, null, 2)}

For each consumable item:
- Identify recommended replenishment cycle in days (e.g. 14, 28, 30, 45, 60, 90).
- State the rationale.
- Estimate repeat rate increase.
`;

    try {
      const result = await this.orchestrator.generateStructuredJson<{ recommendations: ReorderRecommendation[] }>(
        storeId,
        prompt,
        ReorderRecommendationsListSchema,
        { modelTier: 'analysis' }
      );
      return result.recommendations || [];
    } catch {
      return [];
    }
  }

  // =========================================================================
  // 7. AD INTELLIGENCE AI (PHASE K)
  // =========================================================================

  async analyzeAds(storeId: string, forceRefresh: boolean = false): Promise<AdAnalysisResult> {
    const context = await this.contextService.getStoreContext(storeId);
    const cacheKey = 'ad_analysis';

    if (!forceRefresh) {
      const cached = await this.cache.get<AdAnalysisResult>(storeId, cacheKey, context.dataHash);
      if (cached) return cached;
    }

    if (context.marketing.totalAdSpend <= 0 && context.marketing.totalTouchpoints === 0) {
      return {
        has_ad_data: false,
        overview_summary: 'Connect ad platform or record marketing UTM touchpoints to unlock live ad intelligence and ROAS analysis.',
        what_is_working: [],
        what_is_not: [],
        why_it_happens: [],
        what_to_test_next: ['Add UTM tracking parameters to your ad campaigns (?utm_source=meta&utm_medium=cpc)'],
        recommendations: [],
      };
    }

    const prompt = `
Task: ad_analysis
Analyze marketing attribution and ad intelligence performance for "${context.brandName}":
- Total Ad Spend: ${context.currency} ${context.marketing.totalAdSpend.toFixed(2)}
- Total Attributed Revenue: ${context.currency} ${context.funnelAndSales.totalRevenue.toFixed(2)}
- Blended ROAS: ${context.marketing.blendedRoas}x
- Marketing Touchpoints Recorded: ${context.marketing.totalTouchpoints}
- Top Attribution Sources: ${JSON.stringify(context.marketing.topAttributionSources, null, 2)}

Identify:
- What is working well
- What is underperforming
- Why it may be happening
- 2 specific tests to run next
- Specific recommendations for scaling or reducing channels.
DO NOT fabricate ad clicks or impressions if not provided.
`;

    const result = await this.orchestrator.generateStructuredJson<AdAnalysisResult>(
      storeId,
      prompt,
      AdAnalysisSchema,
      { modelTier: 'analysis' }
    );

    await this.cache.set(storeId, cacheKey, context.dataHash, result, 3600);
    return result;
  }

  async askAdQuestion(storeId: string, question: string): Promise<AdAskResult> {
    const context = await this.contextService.getStoreContext(storeId);

    const prompt = `
Task: ad_ask
Merchant asked this question about their ad campaigns & attribution:
"${question}"

Available Marketing Data:
- Total Ad Spend: ${context.currency} ${context.marketing.totalAdSpend}
- Blended ROAS: ${context.marketing.blendedRoas}x
- Total Touchpoints: ${context.marketing.totalTouchpoints}
- Top Channels: ${JSON.stringify(context.marketing.topAttributionSources)}

Provide:
1. Grounded answer strictly based on recorded touchpoints and spend.
2. Verified supporting metrics object.
3. 2 actionable next steps.
`;

    return await this.orchestrator.generateStructuredJson<AdAskResult>(
      storeId,
      prompt,
      AdAskSchema,
      { modelTier: 'analysis' }
    );
  }

  // =========================================================================
  // 8. GROWTH COPILOT Q&A (PHASE G)
  // =========================================================================

  async askGrowthCopilot(storeId: string, question: string): Promise<CopilotAskResult> {
    const context = await this.contextService.getStoreContext(storeId);

    const prompt = `
Task: copilot_ask
You are the AI Merchant Growth Copilot for "${context.brandName}".
Merchant Question: "${question}"

Real Store Context:
- Revenue: ${context.currency} ${context.funnelAndSales.totalRevenue} across ${context.funnelAndSales.purchaseEvents} orders (AOV: ${context.currency} ${context.funnelAndSales.averageOrderValue.toFixed(2)})
- Conversion: ${context.funnelAndSales.cartToPurchaseRate}% cart-to-purchase
- Visitors: ${context.leadsAndCustomers.totalVisitors} (${context.leadsAndCustomers.identifiedLeads} leads)
- Recovery: ${context.marketing.recoveryJobsTotal} abandoned cart jobs
- Replenishment: ${context.marketing.replenishmentSchedulesActive} active auto-reorders
- Ad ROAS: ${context.marketing.blendedRoas}x on ${context.currency} ${context.marketing.totalAdSpend} spend

Provide:
1. Direct, concise answer explaining what the data indicates.
2. Verified supporting metrics.
3. 2 prioritized action recommendations with target_module (e.g. 'whatsapp', 'email', 'catalogue', 'reorder', 'ad_intelligence', 'widget').
`;

    return await this.orchestrator.generateStructuredJson<CopilotAskResult>(
      storeId,
      prompt,
      CopilotAskSchema,
      { modelTier: 'smart' }
    );
  }
}
