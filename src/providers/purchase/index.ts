import { IPurchaseAdapter } from './purchase.adapter';
import { FakePurchaseAdapter } from './fake.purchase.adapter';
import { getEnvConfig } from '../../config/env';

export * from './purchase.adapter';

const fakePurchaseAdapter = new FakePurchaseAdapter();

export function getPurchaseAdapter(): IPurchaseAdapter {
  const env = getEnvConfig();
  if (env.SHOPIFY_ADAPTER_MODE === 'real') {
    throw new Error('Real Purchase Adapter not yet implemented in Phase 5 MVP');
  }
  return fakePurchaseAdapter;
}

export function getTestPurchaseAdapter(): FakePurchaseAdapter {
  return fakePurchaseAdapter;
}
