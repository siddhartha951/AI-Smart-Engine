import { IShopifyCatalogAdapter, ProductSearchQuery, ShopifyProduct } from './shopify.adapter';
import { resolveProductImageUrl } from './shopify.utils';
import { getDatabaseClient } from '../../database/client';
import { decryptString } from '../../utils/crypto';
import { TenantIsolationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { defaultVariant, parseVariantColumns, variantsFromAdminGraphql, variantsFromAdminRest, variantsFromStorefront } from './variants';

export class LiveShopifyAdapter implements IShopifyCatalogAdapter {
  
  private async getCredentials(storeId: string) {
    const db = getDatabaseClient();
    const res = await db.query(
      `SELECT encrypted_admin_token, encrypted_storefront_token, encryption_iv, shop_domain 
       FROM store_credentials c
       JOIN stores s ON s.id = c.store_id
       WHERE c.store_id = $1`,
      [storeId]
    );

    if (res.rows.length === 0) {
      throw new TenantIsolationError(`Store credentials not found for ${storeId}`);
    }

    const { encrypted_admin_token, encrypted_storefront_token, encryption_iv, shop_domain } = res.rows[0];
    
    // Support legacy encryption format (which needed encryption_iv)
    const adminToken = decryptString(encrypted_admin_token, encryption_iv);
    const storefrontToken = decryptString(encrypted_storefront_token, encryption_iv);

    return { adminToken, storefrontToken, shopDomain: shop_domain };
  }

  private async handleInvalidCredentials(storeId: string) {
    const db = getDatabaseClient();
    logger.warn(`Invalid Shopify credentials detected for store ${storeId}. Pausing agent.`);
    
    // Update merchant status to connection_needs_attention
    await db.query(`
      UPDATE merchants 
      SET status = 'connection_needs_attention', updated_at = NOW() 
      WHERE id = (SELECT merchant_id FROM stores WHERE id = $1)
    `, [storeId]);

    // Pause agent
    await db.query(`
      UPDATE assistant_settings 
      SET is_active = false, updated_at = NOW() 
      WHERE store_id = $1
    `, [storeId]);

    // Create admin alert
    await db.query(`
      INSERT INTO admin_alerts (type, severity, message, metadata)
      VALUES ('shopify_auth_failed', 'high', 'Shopify credentials revoked or invalid. Agent automatically paused.', $1::jsonb)
    `, [JSON.stringify({ store_id: storeId })]);
  }

  async validateConnection(storeId: string): Promise<boolean> {
    try {
      const { adminToken, shopDomain } = await this.getCredentials(storeId);
      
      const response = await fetch(`https://${shopDomain}/admin/api/2024-01/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': adminToken,
          'Content-Type': 'application/json',
        }
      });

      if (response.status === 401 || response.status === 403) {
        await this.handleInvalidCredentials(storeId);
        return false;
      }

      return response.ok;
    } catch (err) {
      logger.error(`Error validating Shopify connection for ${storeId}:`, err);
      return false;
    }
  }

  async registerWebhooks(storeId: string): Promise<void> {
    try {
      const { adminToken, shopDomain } = await this.getCredentials(storeId);
      const appUrl = process.env.BASE_URL || process.env.APP_URL || 'https://example.com';
      
      const webhooks = [
        { topic: 'orders/create', address: `${appUrl}/api/v1/shopify/webhooks/orders` },
        { topic: 'products/update', address: `${appUrl}/api/v1/shopify/webhooks/products` }
      ];

      for (const hook of webhooks) {
        const response = await fetch(`https://${shopDomain}/admin/api/2024-01/webhooks.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': adminToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhook: {
              topic: hook.topic,
              address: hook.address,
              format: 'json'
            }
          })
        });

        if (response.status === 401 || response.status === 403) {
          await this.handleInvalidCredentials(storeId);
          throw new Error('Unauthorized to register webhooks. Check credentials.');
        }
      }
    } catch (err) {
      logger.error(`Error registering Shopify webhooks for ${storeId}:`, err);
      throw err;
    }
  }

  async searchProducts(storeId: string, query: ProductSearchQuery): Promise<ShopifyProduct[]> {
    try {
      const db = getDatabaseClient();

      // 1. Check local synced products catalog in DB first (fast & reliable)
      try {
        let sql = 'SELECT * FROM products WHERE store_id = $1 AND in_stock = true AND price > 0';
        const params: any[] = [storeId];

        if (query.bestseller_only) {
          sql += ' AND is_bestseller = true';
        }

        if (query.min_price) {
          params.push(query.min_price);
          sql += ` AND price >= $${params.length}`;
        }

        if (query.budget_max) {
          params.push(query.budget_max);
          sql += ` AND price <= $${params.length}`;
        }

        if (query.category) {
          params.push(query.category.toLowerCase());
          sql += ` AND LOWER(category) = $${params.length}`;
        }

        if (query.keywords && query.keywords.length > 0) {
          const kwClauses = query.keywords.map((kw) => {
            params.push(`%${kw.toLowerCase()}%`);
            const pIdx = params.length;
            return `(
              LOWER(title) LIKE $${pIdx} 
              OR LOWER(category) LIKE $${pIdx} 
              OR LOWER(COALESCE(description, '')) LIKE $${pIdx}
              OR array_to_string(tags, ' ') ILIKE $${pIdx}
            )`;
          });
          sql += ` AND (${kwClauses.join(' OR ')})`;
        }

        sql += ' ORDER BY is_bestseller DESC, (CASE WHEN sales_rank < 999 THEN sales_rank ELSE 9999 END) ASC, (CASE WHEN price >= 5 THEN 0 ELSE 1 END), price DESC LIMIT 20';
        const dbRes = await db.query(sql, params);
        if (dbRes.rows.length > 0) {
          return dbRes.rows.map((r: any) => ({
            id: r.shopify_id || r.id,
            variant_id: r.variant_id || '',
            title: r.title,
            handle: r.handle,
            description: r.description || '',
            tags: r.tags || [],
            is_bestseller: r.is_bestseller || false,
            sales_rank: r.sales_rank || 999,
            price: parseFloat(r.price || '0'),
            compare_at_price: parseFloat(r.compare_at_price || '0'),
            currency: r.currency || 'INR',
            in_stock: r.in_stock,
            category: r.category,
            image_url: r.image_url,
            product_url: r.product_url,
            ...variantFields(r),
          }));
        }

        // Fallback: If keyword search yielded 0 items, load store's bestsellers (strictly price > 0)
        if (query.keywords && query.keywords.length > 0) {
          const fallbackRes = await db.query(
            `SELECT * FROM products WHERE store_id = $1 AND in_stock = true AND price > 0 ORDER BY is_bestseller DESC, (CASE WHEN sales_rank < 999 THEN sales_rank ELSE 9999 END) ASC, (CASE WHEN price >= 5 THEN 0 ELSE 1 END), price DESC LIMIT 10`,
            [storeId]
          );
          if (fallbackRes.rows.length > 0) {
            return fallbackRes.rows.map((r: any) => ({
              id: r.shopify_id || r.id,
              variant_id: r.variant_id || '',
              title: r.title,
              handle: r.handle,
              description: r.description || '',
              tags: r.tags || [],
              is_bestseller: r.is_bestseller || false,
              sales_rank: r.sales_rank || 999,
              price: parseFloat(r.price || '0'),
              compare_at_price: parseFloat(r.compare_at_price || '0'),
              currency: r.currency || 'INR',
              in_stock: r.in_stock,
              category: r.category,
              image_url: r.image_url,
              product_url: r.product_url,
            }));
          }
        }
      } catch (dbErr) {
        // Table may not exist or missing columns in test mocks, continue to live API
      }

      // 2. Fallback to live Storefront API search
      const { storefrontToken, shopDomain } = await this.getCredentials(storeId);
      
      const graphqlQuery = `
        {
          products(first: 20, query: "${query.keywords?.join(' ') || ''}") {
            edges {
              node {
                id
                title
                productType
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price { amount currencyCode }
                      compareAtPrice { amount currencyCode }
                      availableForSale
                    }
                  }
                }
                featuredImage {
                  url
                }
                images(first: 5) {
                  edges {
                    node {
                      url
                    }
                  }
                }
                onlineStoreUrl
              }
            }
          }
        }
      `;

      const response = await fetch(`https://${shopDomain}/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Storefront-Access-Token': storefrontToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: graphqlQuery })
      });

      if (response.status === 401 || response.status === 403) {
        logger.warn(`Shopify storefront access unauthorized for store ${storeId} during product search`);
        return [];
      }

      const data = (await response.json()) as any;
      if (!data.data?.products?.edges) {
        return [];
      }

      let products: ShopifyProduct[] = data.data.products.edges.map((edge: any) => {
        const node = edge.node;
        const variant = node.variants.edges[0]?.node;
        const rawVarId = variant?.id || '';
        const numericVarId = rawVarId.split('/').pop() || rawVarId;
        
        return {
          id: node.id,
          variant_id: numericVarId,
          title: node.title,
          price: parseFloat(variant?.price?.amount || '0'),
          compare_at_price: parseFloat(variant?.compareAtPrice?.amount || '0'),
          currency: variant?.price?.currencyCode || 'INR',
          in_stock: variant?.availableForSale ?? true,
          category: node.productType || '',
          image_url: resolveProductImageUrl(node.featuredImage?.url || node.images?.edges[0]?.node?.url, node.productType, node.title),
          product_url: node.onlineStoreUrl || `https://${shopDomain}/products/${node.id.split('/').pop()}`
        };
      });

      // Strictly exclude $0 free samples / drafts from recommendations
      products = products.filter(p => p.price > 0);

      if (query.min_price) {
        products = products.filter(p => p.price >= query.min_price!);
      }

      if (query.budget_max) {
        products = products.filter(p => p.price <= query.budget_max!);
      }
      
      if (query.category) {
        products = products.filter(p => p.category.toLowerCase() === query.category!.toLowerCase());
      }

      // Prioritize flagship products over sample sachets/wipes
      products.sort((a, b) => {
        const aFlagship = a.price >= 5 ? 0 : 1;
        const bFlagship = b.price >= 5 ? 0 : 1;
        if (aFlagship !== bFlagship) return aFlagship - bFlagship;
        return b.price - a.price;
      });

      return products;
    } catch (err) {
      logger.error(`Error searching Shopify products for ${storeId}:`, err);
      return [];
    }
  }

  private async fetchBestsellerIds(shopDomain: string, adminToken: string): Promise<Map<string, number>> {
    const rankMap = new Map<string, number>();
    try {
      const graphqlQuery = `
        {
          products(first: 25, sortKey: BEST_SELLING) {
            edges {
              node {
                id
              }
            }
          }
        }
      `;
      const response = await fetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': adminToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: graphqlQuery }),
      });
      if (response.ok) {
        const data = (await response.json()) as any;
        const edges = data.data?.products?.edges || [];
        edges.forEach((edge: any, index: number) => {
          const rawId = edge.node?.id || '';
          const numericId = rawId.split('/').pop() || rawId;
          rankMap.set(rawId, index + 1);
          rankMap.set(numericId, index + 1);
        });
        logger.info(`Shopify identified ${edges.length} bestsellers for ${shopDomain}`);
      }
    } catch (err) {
      logger.warn(`Could not fetch bestsellers from Shopify for ${shopDomain}: ${err}`);
    }
    return rankMap;
  }

  async syncAllProducts(storeId: string): Promise<{ count: number; products: ShopifyProduct[] }> {
    try {
      const { adminToken, storefrontToken, shopDomain } = await this.getCredentials(storeId);
      let allProducts: ShopifyProduct[] = [];
      const bestsellerRankMap = adminToken ? await this.fetchBestsellerIds(shopDomain, adminToken) : new Map<string, number>();

      // 1. Primary: Shopify Admin GraphQL API (uses adminToken)
      if (adminToken) {
        try {
          allProducts = await this.syncViaAdminGraphQL(shopDomain, adminToken, bestsellerRankMap);
          logger.info(`Admin GraphQL synced ${allProducts.length} products for ${shopDomain}`);
        } catch (err) {
          logger.warn(`Admin GraphQL sync failed for ${shopDomain}, trying Admin REST: ${err}`);
        }

        // 2. Fallback: Shopify Admin REST API
        if (allProducts.length === 0) {
          try {
            allProducts = await this.syncViaAdminREST(shopDomain, adminToken, bestsellerRankMap);
            logger.info(`Admin REST synced ${allProducts.length} products for ${shopDomain}`);
          } catch (err) {
            logger.warn(`Admin REST sync failed for ${shopDomain}: ${err}`);
          }
        }
      }

      // 3. Fallback: Storefront GraphQL API
      if (allProducts.length === 0 && storefrontToken) {
        try {
          allProducts = await this.syncViaStorefrontGraphQL(shopDomain, storefrontToken);
          logger.info(`Storefront GraphQL synced ${allProducts.length} products for ${shopDomain}`);
        } catch (err) {
          logger.warn(`Storefront GraphQL sync failed for ${shopDomain}: ${err}`);
        }
      }

      // 4. Save/Upsert synced products to local products table
      if (allProducts.length > 0) {
        try {
          const db = getDatabaseClient();
          for (const p of allProducts) {
            const rawId = p.id.split('/').pop() || p.id;
            const compositeId = `${storeId}_${rawId}`;
            await db.query(`
              INSERT INTO products (
                id, store_id, shopify_id, variant_id, title, handle, description, tags, is_bestseller, sales_rank, price, compare_at_price, currency, in_stock, category, image_url, product_url, variants, variant_options, synced_at, updated_at
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, NOW(), NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                handle = EXCLUDED.handle,
                description = CASE WHEN EXCLUDED.description IS NOT NULL AND EXCLUDED.description != '' THEN EXCLUDED.description ELSE products.description END,
                tags = EXCLUDED.tags,
                is_bestseller = EXCLUDED.is_bestseller,
                sales_rank = EXCLUDED.sales_rank,
                price = EXCLUDED.price,
                compare_at_price = EXCLUDED.compare_at_price,
                currency = EXCLUDED.currency,
                in_stock = EXCLUDED.in_stock,
                category = EXCLUDED.category,
                image_url = CASE WHEN EXCLUDED.image_url IS NOT NULL AND EXCLUDED.image_url != '' THEN EXCLUDED.image_url ELSE products.image_url END,
                product_url = EXCLUDED.product_url,
                variants = EXCLUDED.variants,
                variant_options = EXCLUDED.variant_options,
                synced_at = NOW(),
                updated_at = NOW()
            `, [
              compositeId,
              storeId,
              p.id,
              p.variant_id || '',
              p.title,
              p.handle || (p.title ? p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : ''),
              p.description || '',
              p.tags || [],
              p.is_bestseller ?? false,
              p.sales_rank ?? 999,
              p.price || 0,
              p.compare_at_price || 0,
              p.currency || 'INR',
              p.in_stock ?? true,
              p.category || '',
              resolveProductImageUrl(p.image_url, p.category, p.title),
              p.product_url || '',
              JSON.stringify(p.variants || []),
              JSON.stringify(p.options || []),
            ]);
          }
        } catch (dbErr) {
          logger.warn(`Could not persist synced products to database: ${dbErr}`);
        }
      }

      return {
        count: allProducts.length,
        products: allProducts,
      };
    } catch (err) {
      logger.error(`Error syncing Shopify products for ${storeId}:`, err);
      return { count: 0, products: [] };
    }
  }

  private async syncViaAdminGraphQL(shopDomain: string, adminToken: string, bestsellerRankMap: Map<string, number> = new Map()): Promise<ShopifyProduct[]> {
    const products: ShopifyProduct[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let iterations = 0;
    const maxIterations = 50; // Up to 1,000 products (20 per page)
    let throttleRetries = 0;

    while (hasNextPage && iterations < maxIterations) {
      iterations++;
      const afterArg = cursor ? `, after: "${cursor}"` : '';
      const graphqlQuery = `
        {
          shop {
            currencyCode
          }
          products(first: 20${afterArg}) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                handle
                productType
                options { name values }
                description
                tags
                status
                featuredImage {
                  url
                }
                images(first: 1) {
                  edges {
                    node {
                      url
                    }
                  }
                }
                variants(first: 25) {
                  edges {
                    node {
                      id
                      title
                      price
                      compareAtPrice
                      availableForSale
                      selectedOptions { name value }
                      image { url }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response = await fetch(`https://${shopDomain}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': adminToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: graphqlQuery }),
      });

      if (!response.ok) {
        logger.warn(`Shopify Admin GraphQL returned status ${response.status}`);
        break;
      }

      const data = (await response.json()) as any;
      // Shopify rate-limits by query cost; wait for the bucket to refill and retry this page
      if (Array.isArray(data.errors) && data.errors.some((e: any) => e?.extensions?.code === 'THROTTLED')) {
        if (throttleRetries++ < 5) {
          iterations--;
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        logger.warn(`Shopify Admin GraphQL still throttled for ${shopDomain}; stopping sync at ${products.length} products`);
        break;
      }
      const shopCurrency = data.data?.shop?.currencyCode || 'INR';
      const productsData = data.data?.products;
      if (!productsData?.edges || productsData.edges.length === 0) {
        break;
      }

      for (const edge of productsData.edges) {
        const node = edge.node;
        const { variants, options } = variantsFromAdminGraphql(node);
        const buyable = defaultVariant(variants);
        // Price, stock and cart id come from the first variant that can actually be bought
        const variant = node.variants?.edges?.find((e: any) => String(e.node?.id || '').endsWith(`/${buyable?.id}`))?.node || node.variants?.edges[0]?.node;
        const imgUrl = node.featuredImage?.url || node.images?.edges[0]?.node?.url || '';
        const rawId = node.id || '';
        const numericId = rawId.split('/').pop() || rawId;
        const rawVarId = variant?.id || '';
        const numericVarId = rawVarId.split('/').pop() || rawVarId;
        const salesRank = bestsellerRankMap.get(rawId) || bestsellerRankMap.get(numericId) || 999;
        const isBestseller = bestsellerRankMap.has(rawId) || bestsellerRankMap.has(numericId);

        const cleanDesc = (node.description || '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        products.push({
          id: rawId,
          variant_id: numericVarId,
          title: node.title || '',
          handle: node.handle || '',
          description: cleanDesc,
          tags: Array.isArray(node.tags) ? node.tags : (typeof node.tags === 'string' ? node.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []),
          is_bestseller: isBestseller,
          sales_rank: salesRank,
          price: parseFloat(variant?.price || '0'),
          compare_at_price: parseFloat(variant?.compareAtPrice || '0'),
          currency: shopCurrency,
          in_stock: variants.length > 0 ? variants.some(v => v.available) : (variant?.availableForSale ?? (node.status === 'ACTIVE')),
          category: node.productType || '',
          image_url: resolveProductImageUrl(imgUrl, node.productType, node.title),
          product_url: `https://${shopDomain}/products/${node.handle || numericId}`,
          variants,
          options,
        });
      }

      hasNextPage = productsData.pageInfo?.hasNextPage || false;
      cursor = productsData.pageInfo?.endCursor || null;
    }

    return products;
  }

  private async syncViaAdminREST(shopDomain: string, adminToken: string, bestsellerRankMap: Map<string, number> = new Map()): Promise<ShopifyProduct[]> {
    const products: ShopifyProduct[] = [];
    let shopCurrency = 'INR';

    try {
      const shopRes = await fetch(`https://${shopDomain}/admin/api/2024-01/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': adminToken,
          'Content-Type': 'application/json',
        },
      });
      if (shopRes.ok) {
        const shopJson = (await shopRes.json()) as any;
        if (shopJson.shop?.currency) shopCurrency = shopJson.shop.currency;
      }
    } catch (_) {}

    const response = await fetch(`https://${shopDomain}/admin/api/2024-01/products.json?limit=250`, {
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn(`Shopify Admin REST returned status ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const rawProducts = data.products || [];

    for (const p of rawProducts) {
      const { variants, options } = variantsFromAdminRest(p);
      const buyable = defaultVariant(variants);
      const variant = p.variants?.find((v: any) => String(v.id) === buyable?.id) || p.variants?.[0];
      const imgUrl = p.image?.src || p.image?.url || p.images?.[0]?.src || p.images?.[0]?.url || (typeof p.featured_image === 'string' ? p.featured_image : p.featured_image?.src) || '';
      const rawVarId = variant ? String(variant.id) : '';
      const numericVarId = rawVarId.split('/').pop() || rawVarId;
      const salesRank = bestsellerRankMap.get(String(p.id)) || 999;
      const isBestseller = bestsellerRankMap.has(String(p.id));

      const cleanDesc = (p.body_html || p.description || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const tags = typeof p.tags === 'string' 
        ? p.tags.split(',').map((t: string) => t.trim()).filter(Boolean) 
        : (Array.isArray(p.tags) ? p.tags : []);

      products.push({
        id: String(p.id),
        variant_id: numericVarId,
        title: p.title || '',
        handle: p.handle || '',
        description: cleanDesc,
        tags,
        is_bestseller: isBestseller,
        sales_rank: salesRank,
        price: parseFloat(variant?.price || '0'),
        compare_at_price: parseFloat(variant?.compareAtPrice || '0'),
        currency: shopCurrency,
        in_stock: variants.length > 0 ? variants.some(v => v.available) : (variant?.available ?? (p.status === 'active')),
        category: p.product_type || '',
        image_url: resolveProductImageUrl(imgUrl, p.product_type, p.title),
        product_url: `https://${shopDomain}/products/${p.handle || p.id}`,
        variants,
        options,
      });
    }

    return products;
  }

  private async syncViaStorefrontGraphQL(shopDomain: string, storefrontToken: string): Promise<ShopifyProduct[]> {
    const products: ShopifyProduct[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;
    let iterations = 0;
    const maxIterations = 20;

    while (hasNextPage && iterations < maxIterations) {
      iterations++;
      const afterArg = cursor ? `, after: "${cursor}"` : '';
      const graphqlQuery = `
        {
          products(first: 50${afterArg}) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                productType
                description
                tags
                options { name values }
                variants(first: 25) {
                  edges {
                    node {
                      id
                      title
                      price { amount currencyCode }
                      compareAtPrice { amount currencyCode }
                      availableForSale
                      selectedOptions { name value }
                      image { url }
                    }
                  }
                }
                featuredImage {
                  url
                }
                images(first: 5) {
                  edges {
                    node {
                      url
                    }
                  }
                }
                onlineStoreUrl
              }
            }
          }
        }
      `;

      const response = await fetch(`https://${shopDomain}/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Storefront-Access-Token': storefrontToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: graphqlQuery }),
      });

      if (!response.ok) {
        break;
      }

      const data = (await response.json()) as any;
      const productsData = data.data?.products;
      if (!productsData?.edges || productsData.edges.length === 0) {
        break;
      }

      for (const edge of productsData.edges) {
        const node = edge.node;
        const { variants, options } = variantsFromStorefront(node);
        const buyable = defaultVariant(variants);
        const variant = node.variants?.edges?.find((e: any) => String(e.node?.id || '').endsWith(`/${buyable?.id}`))?.node || node.variants?.edges[0]?.node;
        const rawVarId = variant?.id || '';
        const numericVarId = rawVarId.split('/').pop() || rawVarId;
        const cleanDesc = (node.description || '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        products.push({
          id: node.id,
          variant_id: numericVarId,
          title: node.title,
          description: cleanDesc,
          tags: Array.isArray(node.tags) ? node.tags : [],
          price: parseFloat(variant?.price?.amount || '0'),
          compare_at_price: parseFloat(variant?.compareAtPrice?.amount || '0'),
          currency: variant?.price?.currencyCode || 'INR',
          in_stock: variants.length > 0 ? variants.some(v => v.available) : (variant?.availableForSale ?? true),
          category: node.productType || '',
          image_url: resolveProductImageUrl(node.featuredImage?.url || node.images?.edges[0]?.node?.url, node.productType, node.title),
          product_url: node.onlineStoreUrl || `https://${shopDomain}/products/${node.id.split('/').pop()}`,
          variants,
          options,
        });
      }

      hasNextPage = productsData.pageInfo?.hasNextPage || false;
      cursor = productsData.pageInfo?.endCursor || null;
    }

    return products;
  }

  async getProductDetails(storeId: string, productId: string): Promise<ShopifyProduct | null> {
    const products = await this.searchProducts(storeId, {});
    return products.find(p => p.id === productId || p.id.includes(productId)) || null;
  }
}

/** variants/options columns of a products row, only when the product really has several variants */
function variantFields(row: any): Pick<ShopifyProduct, 'variants' | 'options'> {
  const { variants, options } = parseVariantColumns(row);
  return variants.length > 1 ? { variants, options } : {};
}
