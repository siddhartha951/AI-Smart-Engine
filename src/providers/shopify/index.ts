import { IShopifyCatalogAdapter } from './shopify.adapter';
import { FakeShopifyAdapter } from './fake.shopify.adapter';
import { LiveShopifyAdapter } from './live.shopify.adapter';
import { getEnvConfig } from '../../config/env';

export * from './shopify.adapter';
export * from './shopify.utils';

export function getShopifyAdapter(): IShopifyCatalogAdapter {
  const env = getEnvConfig();
  if (env.SHOPIFY_ADAPTER_MODE === 'real') {
    return new LiveShopifyAdapter();
  }
  return new FakeShopifyAdapter();
}
