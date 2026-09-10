import { IShopifyCatalogAdapter, ProductSearchQuery, ShopifyProduct } from './shopify.adapter';
import { getDatabaseClient } from '../../database/client';
import { decryptString } from '../../utils/crypto';
import { TenantIsolationError } from '../../utils/errors';
import { logger } from '../../utils/logger';

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
      INSERT INTO admin_alerts (store_id, type, severity, message)
      VALUES ($1, 'shopify_auth_failed', 'high', 'Shopify credentials revoked or invalid. Agent automatically paused.')
    `, [storeId]);
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
      const appUrl = process.env.APP_URL || 'https://example.com';
      
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
      const { storefrontToken, shopDomain } = await this.getCredentials(storeId);
      
      // We will perform a basic Storefront API GraphQL query
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
                      availableForSale
                    }
                  }
                }
                images(first: 1) {
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
        await this.handleInvalidCredentials(storeId);
        throw new Error('Unauthorized storefront access.');
      }

      const data = (await response.json()) as any;
      if (!data.data?.products?.edges) {
        return [];
      }

      let products: ShopifyProduct[] = data.data.products.edges.map((edge: any) => {
        const node = edge.node;
        const variant = node.variants.edges[0]?.node;
        
        return {
          id: node.id,
          variant_id: variant?.id || '',
          title: node.title,
          price: parseFloat(variant?.price?.amount || '0'),
          currency: variant?.price?.currencyCode || 'GBP',
          in_stock: variant?.availableForSale || false,
          category: node.productType || '',
          image_url: node.images.edges[0]?.node?.url || '',
          product_url: node.onlineStoreUrl || `https://${shopDomain}/products/${node.id}`
        };
      });

      // Client-side budget filtering if needed
      if (query.budget_max) {
        products = products.filter(p => p.price <= query.budget_max!);
      }
      
      // Client-side category filtering if needed
      if (query.category) {
        products = products.filter(p => p.category.toLowerCase() === query.category!.toLowerCase());
      }

      return products;
    } catch (err) {
      logger.error(`Error searching Shopify products for ${storeId}:`, err);
      return [];
    }
  }

  async getProductDetails(storeId: string, productId: string): Promise<ShopifyProduct | null> {
    // For simplicity, just search for it and return first result
    const products = await this.searchProducts(storeId, {});
    return products.find(p => p.id === productId || p.id.includes(productId)) || null;
  }
}
