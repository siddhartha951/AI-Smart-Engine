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
        currency: 'GBP',
        in_stock: true,
        category: 'audio',
        image_url: 'https://example.com/earbuds.jpg',
        product_url: 'https://store-a.com/products/wireless-earbuds'
      },
      {
        id: 'prod_a_2',
        variant_id: 'var_a_2',
        title: 'Smart Watch',
        price: 129.99,
        currency: 'GBP',
        in_stock: true,
        category: 'wearable',
        image_url: 'https://example.com/watch.jpg',
        product_url: 'https://store-a.com/products/smart-watch'
      },
      {
        id: 'prod_a_3',
        variant_id: 'var_a_3',
        title: 'Noise Cancelling Headphones',
        price: 199.99,
        currency: 'GBP',
        in_stock: false, // Out of stock to test filtering
        category: 'audio',
        image_url: 'https://example.com/headphones.jpg',
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
        currency: 'GBP',
        in_stock: true,
        category: 'decor',
        image_url: 'https://example.com/vase.jpg',
        product_url: 'https://store-b.com/products/ceramic-vase'
      },
      {
        id: 'prod_b_2',
        variant_id: 'var_b_2',
        title: 'Wool Blanket',
        price: 59.99,
        currency: 'GBP',
        in_stock: true,
        category: 'bedding',
        image_url: 'https://example.com/blanket.jpg',
        product_url: 'https://store-b.com/products/wool-blanket'
      }
    ]
  };

  async searchProducts(storeId: string, query: ProductSearchQuery): Promise<ShopifyProduct[]> {
    if (!this.products[storeId]) {
      throw new TenantIsolationError(`FakeShopifyAdapter: Store ${storeId} not found`);
    }

    let results = this.products[storeId].filter(p => p.in_stock);

    if (query.budget_max) {
      results = results.filter(p => p.price <= query.budget_max!);
    }

    if (query.category) {
      results = results.filter(p => p.category.toLowerCase() === query.category!.toLowerCase());
    }

    return results;
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
