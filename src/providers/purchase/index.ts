import { IPurchaseAdapter } from './purchase.adapter';
import { FakePurchaseAdapter } from './fake.purchase.adapter';
import { RealPurchaseAdapter } from './real.purchase.adapter';
import { getEnvConfig } from '../../config/env';

export * from './purchase.adapter';
export * from './fake.purchase.adapter';
export * from './real.purchase.adapter';

const fakePurchaseAdapter = new FakePurchaseAdapter();
let realPurchaseAdapter: RealPurchaseAdapter | null = null;
let purchaseAdapterOverride: IPurchaseAdapter | null = null;

export function setPurchaseAdapter(adapter: IPurchaseAdapter | null): void {
  purchaseAdapterOverride = adapter;
}

export function getPurchaseAdapter(): IPurchaseAdapter {
  if (purchaseAdapterOverride) {
    return purchaseAdapterOverride;
  }
  const env = getEnvConfig();
  if (env.SHOPIFY_ADAPTER_MODE === 'real') {
    if (!realPurchaseAdapter) {
      realPurchaseAdapter = new RealPurchaseAdapter();
    }
    return realPurchaseAdapter;
  }
  return fakePurchaseAdapter;
}

export function getTestPurchaseAdapter(): FakePurchaseAdapter {
  return fakePurchaseAdapter;
}
