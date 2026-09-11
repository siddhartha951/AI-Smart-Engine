import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { AdCreative, AdObjective, AdPlatform } from '../../database/types';
import { getAiProvider, BudgetGuard, IAiProvider, AdCreativeVariation, AdImageContext, AdImageGenerationResult } from '../../providers/ai';
import { getShopifyAdapter, IShopifyCatalogAdapter, ShopifyProduct, resolveProductImageUrl } from '../../providers/shopify';
import { AdCreativeRepository, CreateAdCreativeInput } from './ad_creative.repository';

export class BudgetExceededError extends Error {
  statusCode = 403;
  constructor(message = 'Monthly AI budget limit has been reached for this store.') {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class ProductNotFoundError extends Error {
  statusCode = 404;
  constructor(message = 'Product not found in store catalogue.') {
    super(message);
    this.name = 'ProductNotFoundError';
  }
}

export interface GenerateAdCreativeParams {
  productId: string;
  platform: AdPlatform;
  objective: AdObjective;
}

export interface GenerateAdImageParams {
  productId: string;
  prompt?: string;
  hook?: string;
  headline?: string;
  platform?: 'facebook' | 'instagram';
  style?: 'commercial_studio' | 'lifestyle' | 'vibrant_gradient' | 'minimalist_luxury';
}

export class AdCreativeService {
  private repo: AdCreativeRepository;
  private db: IDatabaseClient;
  private aiProvider: IAiProvider;
  private shopifyAdapter: IShopifyCatalogAdapter;
  private budgetGuard: BudgetGuard;

  constructor(opts?: {
    db?: IDatabaseClient;
    repo?: AdCreativeRepository;
    aiProvider?: IAiProvider;
    shopifyAdapter?: IShopifyCatalogAdapter;
    budgetGuard?: BudgetGuard;
  }) {
    this.db = opts?.db || getDatabaseClient();
    this.repo = opts?.repo || new AdCreativeRepository(this.db);
    this.aiProvider = opts?.aiProvider || getAiProvider();
    this.shopifyAdapter = opts?.shopifyAdapter || getShopifyAdapter();
    this.budgetGuard = opts?.budgetGuard || new BudgetGuard(this.db);
  }

  /**
   * Retrieves products available in the authenticated store's catalogue.
   * Scoped strictly by storeId.
   */
  async getCatalogueProducts(storeId: string): Promise<ShopifyProduct[]> {
    // 1. Check synced products table in DB
    const res = await this.db.query<any>(
      `SELECT id, shopify_id, variant_id, title, handle, price, currency, in_stock, category, image_url, product_url 
       FROM products 
       WHERE store_id = $1 
       ORDER BY in_stock DESC, title ASC 
       LIMIT 250`,
      [storeId]
    );

    if (res.rows.length > 0) {
      return res.rows.map(r => ({
        id: r.shopify_id || r.id,
        variant_id: r.variant_id || '',
        title: r.title,
        handle: r.handle || '',
        price: parseFloat(r.price || '0'),
        currency: r.currency || 'GBP',
        in_stock: Boolean(r.in_stock),
        category: r.category || 'General',
        image_url: resolveProductImageUrl(r.image_url, r.category, r.title),
        product_url: r.product_url || '',
      }));
    }

    // 2. Fallback to Shopify adapter for storeId
    try {
      if (this.shopifyAdapter.syncAllProducts) {
        const syncResult = await this.shopifyAdapter.syncAllProducts(storeId);
        return syncResult.products || [];
      }
      return await this.shopifyAdapter.searchProducts(storeId, {});
    } catch {
      return [];
    }
  }

  /**
   * Resolves a single product within the store's catalogue.
   * If product belongs to a different store or does not exist, returns null.
   */
  async getProductForStore(storeId: string, productId: string): Promise<ShopifyProduct | null> {
    // 1. Check local products table
    const res = await this.db.query<any>(
      `SELECT id, shopify_id, variant_id, title, handle, price, currency, in_stock, category, image_url, product_url 
       FROM products 
       WHERE store_id = $1 AND (id = $2 OR shopify_id = $2)`,
      [storeId, productId]
    );

    if (res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id: r.shopify_id || r.id,
        variant_id: r.variant_id || '',
        title: r.title,
        handle: r.handle || '',
        price: parseFloat(r.price || '0'),
        currency: r.currency || 'GBP',
        in_stock: Boolean(r.in_stock),
        category: r.category || 'General',
        image_url: resolveProductImageUrl(r.image_url, r.category, r.title),
        product_url: r.product_url || '',
      };
    }

    // 2. Fallback to Shopify adapter
    try {
      const p = await this.shopifyAdapter.getProductDetails(storeId, productId);
      return p || null;
    } catch {
      return null;
    }
  }

  /**
   * Generates ad creative variations using AI provider, respecting BudgetGuard
   * and tracking token usage in ai_usage_ledger.
   */
  async generateCreatives(
    storeId: string,
    params: GenerateAdCreativeParams
  ): Promise<{
    variations: AdCreativeVariation[];
    product: ShopifyProduct;
    model: string;
    estimated_cost_usd: number;
  }> {
    // 1. Enforce BudgetGuard
    const isExceeded = await this.budgetGuard.isBudgetExceeded(storeId);
    if (isExceeded) {
      throw new BudgetExceededError();
    }

    // 2. Find product in store catalogue (prevents cross-tenant product access)
    const product = await this.getProductForStore(storeId, params.productId);
    if (!product) {
      throw new ProductNotFoundError(`Product '${params.productId}' not found in store catalogue.`);
    }

    // 3. Get store brand details for grounded context
    const storeRes = await this.db.query<{ brand_name: string; currency?: string }>(
      `SELECT brand_name, currency FROM stores WHERE id = $1`,
      [storeId]
    );
    const storeName = storeRes.rows[0]?.brand_name || 'Our Store';

    // 4. Generate creatives via IAiProvider
    const genResult = await this.aiProvider.generateAdCreatives({
      storeId,
      platform: params.platform,
      objective: params.objective,
      product: {
        id: product.id,
        title: product.title,
        price: product.price,
        currency: product.currency || storeRes.rows[0]?.currency || 'GBP',
        category: product.category,
        handle: product.handle,
        product_url: product.product_url,
        image_url: product.image_url,
      },
      storeName,
    });

    // 5. Record usage in ai_usage_ledger
    await this.budgetGuard.recordUsage(
      storeId,
      null,
      genResult.model,
      genResult.input_tokens,
      genResult.output_tokens,
      genResult.estimated_cost_usd
    );

    return {
      variations: genResult.variations,
      product,
      model: genResult.model,
      estimated_cost_usd: genResult.estimated_cost_usd,
    };
  }

  /**
   * Generates a high-converting AI commercial ad visual using OpenAI DALL-E 3
   * respecting store scoping and BudgetGuard.
   */
  async generateAdImage(
    storeId: string,
    params: GenerateAdImageParams
  ): Promise<{
    image_url: string;
    revised_prompt?: string;
    model: string;
    estimated_cost_usd: number;
    product: ShopifyProduct;
  }> {
    // 1. Enforce BudgetGuard
    const isExceeded = await this.budgetGuard.isBudgetExceeded(storeId);
    if (isExceeded) {
      throw new BudgetExceededError();
    }

    // 2. Resolve product within store catalogue (prevents cross-tenant product access)
    const product = await this.getProductForStore(storeId, params.productId);
    if (!product) {
      throw new ProductNotFoundError(`Product '${params.productId}' not found in store catalogue.`);
    }

    // 3. Generate image via IAiProvider
    const genResult = await this.aiProvider.generateAdImage({
      storeId,
      product: {
        id: product.id,
        title: product.title,
        price: product.price,
        currency: product.currency,
        category: product.category,
        handle: product.handle,
      },
      prompt: params.prompt,
      hook: params.hook,
      headline: params.headline,
      platform: params.platform,
      style: params.style,
    });

    // 4. Record usage in ai_usage_ledger
    await this.budgetGuard.recordUsage(
      storeId,
      null,
      genResult.model,
      0,
      0,
      genResult.estimated_cost_usd
    );

    return {
      image_url: genResult.image_url,
      revised_prompt: genResult.revised_prompt,
      model: genResult.model,
      estimated_cost_usd: genResult.estimated_cost_usd,
      product,
    };
  }

  /**
   * Save a selected creative variation.
   */
  async saveCreative(storeId: string, input: CreateAdCreativeInput): Promise<AdCreative> {
    return this.repo.saveCreative(storeId, input);
  }

  /**
   * Retrieve saved creatives for a store.
   */
  async getSavedCreatives(storeId: string, limit = 50, offset = 0) {
    return this.repo.getSavedCreatives(storeId, limit, offset);
  }

  /**
   * Retrieve a single saved creative by ID.
   */
  async getSavedCreativeById(storeId: string, id: string): Promise<AdCreative | null> {
    return this.repo.getSavedCreativeById(storeId, id);
  }

  /**
   * Delete a saved creative by ID.
   */
  async deleteSavedCreative(storeId: string, id: string): Promise<boolean> {
    return this.repo.deleteSavedCreative(storeId, id);
  }
}
