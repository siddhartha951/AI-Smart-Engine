export interface ShopifyProduct {
  id: string;
  variant_id: string;
  title: string;
  price: number;
  currency: string;
  in_stock: boolean;
  category: string;
  image_url: string;
  product_url: string;
}

export interface ProductSearchQuery {
  budget_max?: number;
  category?: string;
  keywords?: string[];
}

export interface IShopifyCatalogAdapter {
  searchProducts(storeId: string, query: ProductSearchQuery): Promise<ShopifyProduct[]>;
  getProductDetails(storeId: string, productId: string): Promise<ShopifyProduct | null>;
  syncAllProducts?(storeId: string): Promise<{ count: number; products: ShopifyProduct[] }>;
  validateConnection?(storeId: string): Promise<boolean>;
  registerWebhooks?(storeId: string): Promise<void>;
}
