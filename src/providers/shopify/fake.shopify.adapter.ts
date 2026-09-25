import { IShopifyCatalogAdapter, ProductSearchQuery, ShopifyProduct } from './shopify.adapter';
import { TenantIsolationError } from '../../utils/errors';

export class FakeShopifyAdapter implements IShopifyCatalogAdapter {
  private readonly products: Record<string, ShopifyProduct[]> = {
    // Store A: Tech Gadgets
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': [
      {
        id: 'prod_a_1',
        variant_id: 'var_a_1',
        title: 'Wireless Earbuds',
        price: 49.99,
        compare_at_price: 69.99,
        currency: 'GBP',
        in_stock: true,
        category: 'audio',
        image_url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80',
        product_url: 'https://store-a.com/products/wireless-earbuds',
        // Demo variants so the in-chat variant picker has data in fake mode
        options: [{ name: 'Color', values: ['Black', 'White'] }],
        variants: [
          { id: 'var_a_1', title: 'Black', price: 49.99, compare_at_price: 69.99, available: true, options: { Color: 'Black' } },
          { id: 'var_a_1w', title: 'White', price: 54.99, compare_at_price: 69.99, available: false, options: { Color: 'White' } },
        ],
      },
      {
        id: 'prod_a_2',
        variant_id: 'var_a_2',
        title: 'Smart Watch',
        price: 129.99,
        compare_at_price: 159.99,
        currency: 'GBP',
        in_stock: true,
        category: 'wearable',
        image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
        product_url: 'https://store-a.com/products/smart-watch'
      },
      {
        id: 'prod_a_3',
        variant_id: 'var_a_3',
        title: 'Noise Cancelling Headphones',
        price: 199.99,
        compare_at_price: 249.99,
        currency: 'GBP',
        in_stock: false, // Out of stock to test filtering
        category: 'audio',
        image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&auto=format&fit=crop&q=80',
        product_url: 'https://store-a.com/products/headphones'
      }
    ],
    // Store B: Home Decor
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': [
      {
        id: 'prod_b_1',
        variant_id: 'var_b_1',
        title: 'Ceramic Vase',
        price: 24.99,
        compare_at_price: 34.99,
        currency: 'GBP',
        in_stock: true,
        category: 'decor',
        image_url: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&auto=format&fit=crop&q=80',
        product_url: 'https://store-b.com/products/ceramic-vase'
      },
      {
        id: 'prod_b_2',
        variant_id: 'var_b_2',
        title: 'Wool Blanket',
        price: 59.99,
        compare_at_price: 79.99,
        currency: 'GBP',
        in_stock: true,
        category: 'bedding',
        image_url: 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=600&auto=format&fit=crop&q=80',
        product_url: 'https://store-b.com/products/wool-blanket'
      }
    ]
  };

  async searchProducts(storeId: string, query: ProductSearchQuery): Promise<ShopifyProduct[]> {
    if (!this.products[storeId]) {
      throw new TenantIsolationError(`FakeShopifyAdapter: Store ${storeId} not found`);
    }

    let results = this.products[storeId].filter(p => p.in_stock && p.price > 0);

    if (query.min_price) {
      results = results.filter(p => p.price >= query.min_price!);
    }

    if (query.budget_max) {
      results = results.filter(p => p.price <= query.budget_max!);
    }

    if (query.category) {
      results = results.filter(p => p.category.toLowerCase() === query.category!.toLowerCase());
    }

    return results;
  }

  async listCatalog(storeId: string, limit = 500): Promise<ShopifyProduct[]> {
    if (!this.products[storeId]) {
      throw new TenantIsolationError(`FakeShopifyAdapter: Store ${storeId} not found`);
    }
    return this.products[storeId].filter(p => p.in_stock && p.price > 0 && p.is_active !== false).slice(0, limit);
  }

  async getProductDetails(storeId: string, productId: string): Promise<ShopifyProduct | null> {
    const storeProducts = this.products[storeId];
    if (!storeProducts) {
      throw new TenantIsolationError(`Store ${storeId} not found in adapter`);
    }

    const product = storeProducts.find(p => p.id === productId);
    return product || null;
  }

  async syncAllProducts(storeId: string): Promise<{ count: number; products: ShopifyProduct[] }> {
    const storeProducts = this.products[storeId] || [];
    return {
      count: storeProducts.length,
      products: [...storeProducts],
    };
  }

  async validateConnection(storeId: string): Promise<boolean> {
    if (storeId === 'invalid_store_id') return false;
    return true;
  }
}
