/**
 * Shopify webhooks: registration (idempotent, with a visible result) and signature checks.
 *
 * Each merchant connects their own custom app, and Shopify signs that app's webhooks with
 * the app's own "API secret key". So the signature is checked against the store's saved
 * secret first, then the platform-wide SHOPIFY_CLIENT_SECRET (older installs).
 */
import crypto from 'crypto';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { getEnvConfig } from '../../config/env';
import { decryptString } from '../../utils/crypto';
import { timingSafeEqualStr } from '../../utils/webhook-signature';
import { AdminCredentials, adminGet, adminPost, getAdminCredentials } from '../../providers/shopify/admin-client';
import { SyncStateRepository } from './sync-state.repository';

export const WEBHOOK_TOPICS: Array<{ topic: string; path: string }> = [
  { topic: 'orders/create', path: '/api/v1/shopify/webhooks/orders' },
  { topic: 'orders/updated', path: '/api/v1/shopify/webhooks/orders-updated' },
  { topic: 'products/update', path: '/api/v1/shopify/webhooks/products' },
];

/** Where Shopify should send webhooks: BASE_URL / APP_URL, else the host the merchant is using. */
export function resolveWebhookBaseUrl(requestBaseUrl?: string | null): string | null {
  const configured = (process.env.BASE_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured && !/example\.com/.test(configured)) return configured;
  const fromRequest = (requestBaseUrl || '').trim().replace(/\/+$/, '');
  if (/^https:\/\//.test(fromRequest)) return fromRequest;
  return null;
}

export interface WebhookRegistrationResult {
  status: 'ok' | 'blocked' | 'error' | 'not_connected';
  topics: Record<string, 'ok' | 'created' | string>;
  address_base: string | null;
  message?: string;
}

type Poster = typeof adminPost;
type Getter = typeof adminGet;

export async function ensureWebhooks(
  storeId: string,
  opts: { db?: IDatabaseClient; baseUrl?: string | null; get?: Getter; post?: Poster; creds?: AdminCredentials | null } = {}
): Promise<WebhookRegistrationResult> {
  const db = opts.db || getDatabaseClient();
  const get = opts.get || adminGet;
  const post = opts.post || adminPost;
  const state = new SyncStateRepository(db);
  const now = new Date().toISOString();
  const base = resolveWebhookBaseUrl(opts.baseUrl);

  const creds = opts.creds !== undefined ? opts.creds : await getAdminCredentials(storeId, db);
  if (!creds) {
    return { status: 'not_connected', topics: {}, address_base: base, message: 'Shopify is not connected.' };
  }
  if (!base) {
    const message = 'The platform address is unknown (BASE_URL is not set), so Shopify cannot be told where to send webhooks. Open Settings from the live dashboard and press "Register webhooks".';
    await state.save(storeId, 'webhooks', { status: 'error', last_error: message, last_run_at: now });
    return { status: 'error', topics: {}, address_base: null, message };
  }

  const existing = await get(creds, 'webhooks.json', { limit: '250' });
  if (existing.status === 401) {
    await state.save(storeId, 'webhooks', { status: 'error', last_error: 'Shopify rejected the access token.', last_run_at: now });
    return { status: 'error', topics: {}, address_base: base, message: 'Token rejected' };
  }
  const current: Array<{ topic?: string; address?: string }> = Array.isArray(existing.body?.webhooks) ? existing.body.webhooks : [];

  const topics: WebhookRegistrationResult['topics'] = {};
  let blockedScope: string | null = null;
  for (const hook of WEBHOOK_TOPICS) {
    const address = `${base}${hook.path}`;
    if (current.some((w) => w.topic === hook.topic && w.address === address)) {
      topics[hook.topic] = 'ok';
      continue;
    }
    const res = await post(creds, 'webhooks.json', { webhook: { topic: hook.topic, address, format: 'json' } });
    if (res.ok) {
      topics[hook.topic] = 'created';
    } else if (res.status === 422 && /already been taken/i.test(JSON.stringify(res.body || {}))) {
      topics[hook.topic] = 'ok';
    } else if (res.status === 403) {
      blockedScope = hook.topic.startsWith('orders') ? 'read_orders' : 'read_products';
      topics[hook.topic] = `blocked: needs ${blockedScope}`;
    } else {
      const detail = res.body?.errors ? JSON.stringify(res.body.errors).slice(0, 200) : `HTTP ${res.status ?? 'timeout'}`;
      topics[hook.topic] = `failed: ${detail}`;
    }
  }

  const failed = Object.values(topics).filter((v) => v !== 'ok' && v !== 'created');
  const status: WebhookRegistrationResult['status'] = blockedScope ? 'blocked' : failed.length ? 'error' : 'ok';
  await state.save(storeId, 'webhooks', {
    status,
    blocked_scope: blockedScope,
    last_error: failed.length ? failed.join('; ') : null,
    last_run_at: now,
    ...(status === 'ok' ? { last_success_at: now } : {}),
    details: { topics, address_base: base },
  });
  return { status, topics, address_base: base };
}

/** Secrets a webhook for this shop may be signed with (store's own secret first). */
async function candidateSecrets(db: IDatabaseClient, shopDomain: string): Promise<string[]> {
  const secrets: string[] = [];
  try {
    const res = await db.query(
      `SELECT c.encrypted_webhook_secret FROM store_credentials c JOIN stores s ON s.id = c.store_id
       WHERE LOWER(s.shop_domain) = LOWER($1)`,
      [shopDomain]
    );
    for (const row of res.rows) {
      if (!row.encrypted_webhook_secret) continue;
      try {
        const secret = decryptString(row.encrypted_webhook_secret);
        if (secret) secrets.push(secret);
      } catch {
        // unreadable secret: fall through to the platform secret
      }
    }
  } catch {
    // column missing before migration 040: platform secret only
  }
  const platform = getEnvConfig().SHOPIFY_CLIENT_SECRET;
  if (platform) secrets.push(platform);
  return secrets;
}

export async function verifyShopifySignature(
  rawBody: Buffer,
  hmacHeader: string,
  shopDomain: string,
  db: IDatabaseClient = getDatabaseClient()
): Promise<boolean> {
  for (const secret of await candidateSecrets(db, shopDomain)) {
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    if (timingSafeEqualStr(digest, String(hmacHeader))) return true;
  }
  return false;
}
