import { ProductOption, ProductVariant } from './variants';

export interface ShopifyProduct {
  id: string;
  variant_id: string;
  title: string;
  handle?: string;
  description?: string;
  tags?: string[];
  is_bestseller?: boolean;
  sales_rank?: number;
  price: number;
  compare_at_price?: number;
  currency: string;
  in_stock: boolean;
  category: string;
  image_url: string;
  product_url: string;
  /** All purchasable variants (pack size / colour / size); empty for single-variant products */
  variants?: ProductVariant[];
  /** Option groups, e.g. [{ name: 'Size', values: ['S', 'M'] }] */
  options?: ProductOption[];
}

export interface ProductSearchQuery {
  budget_max?: number;
  min_price?: number;
  category?: string;
  keywords?: string[];
  bestseller_only?: boolean;
}

export interface IShopifyCatalogAdapter {
  searchProducts(storeId: string, query: ProductSearchQuery): Promise<ShopifyProduct[]>;
  getProductDetails(storeId: string, productId: string): Promise<ShopifyProduct | null>;
  syncAllProducts?(storeId: string): Promise<{ count: number; products: ShopifyProduct[] }>;
  validateConnection?(storeId: string): Promise<boolean>;
  registerWebhooks?(storeId: string): Promise<void>;
}
