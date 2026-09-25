/**
 * Webhook side of the orders mirror: an order arriving by webhook lands in shopify_orders
 * immediately (the worker sync is the safety net), and every delivery is noted so Settings
 * can show "last webhook received" or "signature rejected".
 */
import { IDatabaseClient } from '../../database/client';
import { mapShopifyOrder } from './order-mapper';
import { ShopifyOrdersRepository } from './orders.repository';
import { SyncStateRepository } from './sync-state.repository';

async function storeIdForShop(db: IDatabaseClient, shopDomain: string): Promise<string | null> {
  const res = await db.query('SELECT id FROM stores WHERE LOWER(shop_domain) = LOWER($1) LIMIT 1', [shopDomain]);
  return res.rows[0]?.id || null;
}

export async function mirrorOrderFromWebhook(db: IDatabaseClient, shopDomain: string, payload: unknown): Promise<boolean> {
  const storeId = await storeIdForShop(db, shopDomain);
  if (!storeId) return false;
  const row = mapShopifyOrder(payload);
  if (!row) return false;
  await new ShopifyOrdersRepository(db).upsert(storeId, row);
  return true;
}

export async function noteWebhookReceived(db: IDatabaseClient, shopDomain: string, topic: string, verified: boolean): Promise<void> {
  const storeId = await storeIdForShop(db, shopDomain);
  if (!storeId) return;
  const repo = new SyncStateRepository(db);
  const current = await repo.get(storeId, 'webhooks');
  const details = { ...(current?.details || {}) };
  const now = new Date().toISOString();
  if (verified) {
    details.last_received_at = now;
    details.last_topic = String(topic).slice(0, 60);
  } else {
    details.last_rejected_at = now;
  }
  const signatureError = /signature that did not match/.test(current?.last_error || '');
  await repo.save(storeId, 'webhooks', {
    details,
    ...(current ? {} : { status: verified ? 'ok' : 'error' }),
    // A correctly signed delivery proves the secret is right: clear the old signature warning
    ...(verified && signatureError ? { status: 'ok', last_error: null, last_success_at: now } : {}),
    ...(verified ? {} : {
      last_error: 'A Shopify webhook arrived with a signature that did not match. Save your custom app\'s API secret key in Settings → Shopify connection.',
    }),
  });
}
