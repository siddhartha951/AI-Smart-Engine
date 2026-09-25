/**
 * One picture of a store's Shopify data for Settings → Shopify connection:
 * every permission (granted / missing, required or not), which data each missing
 * permission blocks, and the live state of every feed (orders sync, webhooks, checkout
 * pixel, Meta spend). Nothing here contains a token or secret.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { decryptString } from '../../utils/crypto';
import { ShopifyHealthService } from '../shopify_health/shopify_health.service';
import { ShopifyHealthResult, ShopifyScopeCheck } from '../shopify_health/shopify_health.types';
import { ADMIN_SCOPES, DATA_FEEDS } from '../shopify_health/shopify-scopes';
import { ShopifyOrdersRepository } from './orders.repository';
import { SyncState, SyncStateRepository } from './sync-state.repository';

export type FeedStatus = 'working' | 'limited' | 'blocked' | 'unknown';

export interface FeedView {
  key: string;
  label: string;
  used_by: string;
  status: FeedStatus;
  missing_required: string[];
  missing_optional: string[];
  note: string | null;
}

export interface DataStatus {
  connection: {
    connected: boolean;
    shop_domain: string | null;
    shop_name: string | null;
    overall_status: ShopifyHealthResult['overall_status'] | 'unknown';
    reason: ShopifyHealthResult['reason'] | null;
    token_valid: boolean | null;
    checked_at: string | null;
    webhook_secret_saved: boolean;
    storefront_token_saved: boolean;
  };
  scopes: ShopifyScopeCheck[];
  feeds: FeedView[];
  syncs: Record<'orders' | 'webhooks' | 'meta_spend' | 'pixel', SyncState | null>;
  orders: { mirrored: number; latest_order_at: string | null; latest_order_name: string | null };
  fix_steps: string[];
}

/** Which data is stopped by which permission, given the granted scopes. */
export function buildFeedViews(scopes: ShopifyScopeCheck[], ordersSync: SyncState | null): FeedView[] {
  const checked = scopes.some((s) => s.status === 'ok' || s.status === 'missing');
  const granted = new Set(scopes.filter((s) => s.status === 'ok').map((s) => s.scope));
  // A scope the check could not see (legacy probe list) is not reported as missing
  const known = new Set(scopes.filter((s) => s.status === 'ok' || s.status === 'missing').map((s) => s.scope));
  const isMissing = (scope: string) => known.has(scope) && !granted.has(scope);

  return DATA_FEEDS.map((feed) => {
    const missingRequired = feed.needs.filter(isMissing);
    const missingOptional = feed.improves.filter(isMissing);
    let status: FeedStatus = !checked ? 'unknown' : missingRequired.length ? 'blocked' : missingOptional.length ? 'limited' : 'working';
    let note: string | null = null;
    if (missingRequired.length) note = `Stopped: Shopify has not given the ${missingRequired.join(', ')} permission.`;
    else if (missingOptional.length) note = `Works, but ${missingOptional.join(', ')} would make it more complete.`;

    if ((feed.key === 'orders' || feed.key === 'order_tracking') && ordersSync?.status === 'blocked') {
      status = 'blocked';
      const scope = ordersSync.blocked_scope || 'read_orders';
      if (!missingRequired.includes(scope)) missingRequired.push(scope);
      note = `Stopped: Shopify refused the orders request (${scope} missing on the token).`;
    }
    return { key: feed.key, label: feed.label, used_by: feed.used_by, status, missing_required: missingRequired, missing_optional: missingOptional, note };
  });
}

function fixSteps(scopesMissing: string[], webhookSecretSaved: boolean): string[] {
  const steps: string[] = [];
  if (scopesMissing.length) {
    steps.push(
      `In Shopify admin open Settings → Apps and sales channels → Develop apps → your app → Configuration → Admin API integration → Edit.`,
      `Tick: ${scopesMissing.join(', ')}. Click Save, then open API credentials and install/update the app.`,
      'If Shopify shows a new Admin API access token, paste it here with "Update access token". Then press "Re-check permissions".'
    );
  }
  if (!webhookSecretSaved) {
    steps.push('Copy the "API secret key" from the same API credentials page and save it below, so new orders arrive instantly by webhook.');
  }
  return steps;
}

function hasSecret(encrypted: unknown, legacyIv?: string): boolean {
  if (!encrypted) return false;
  try {
    return decryptString(String(encrypted), legacyIv).length > 0;
  } catch {
    return false;
  }
}

export async function getDataStatus(storeId: string, opts: { db?: IDatabaseClient; refresh?: boolean } = {}): Promise<DataStatus> {
  const db = opts.db || getDatabaseClient();
  const healthSvc = new ShopifyHealthService();
  const [storeRes, credRes, states, mirrored, latest] = await Promise.all([
    db.query('SELECT shop_domain FROM stores WHERE id = $1', [storeId]),
    db.query('SELECT encrypted_admin_token, encrypted_storefront_token, encrypted_webhook_secret, encryption_iv FROM store_credentials WHERE store_id = $1', [storeId]),
    new SyncStateRepository(db).list(storeId),
    new ShopifyOrdersRepository(db).count(storeId),
    new ShopifyOrdersRepository(db).latest(storeId),
  ]);
  const cred = credRes.rows[0] || {};
  const connected = Boolean(cred.encrypted_admin_token);

  let health: ShopifyHealthResult | null = null;
  if (connected) {
    health = await healthSvc.getLastHealth(storeId).catch(() => null);
    const stale = !health || Date.now() - new Date(health.checked_at).getTime() > 6 * 60 * 60 * 1000;
    if (opts.refresh || stale) health = await healthSvc.checkHealth(storeId).catch(() => health);
  }

  const scopes: ShopifyScopeCheck[] = health?.scopes?.length
    ? health.scopes
    : ADMIN_SCOPES.map((s) => ({ scope: s.scope, level: s.level, status: 'unchecked' as const, tested_endpoint: 'oauth/access_scopes.json', unlocks: s.unlocks }));
  const byResource = (r: string) => states.find((s) => s.resource === r) || null;
  const ordersSync = byResource('orders');
  let feeds = buildFeedViews(scopes, ordersSync);
  // A rejected token (or Shopify out of reach) stops everything: say that instead of "not checked"
  if (health && !health.token_valid && ['token_invalid', 'unreachable', 'not_connected'].includes(String(health.reason))) {
    const note = health.reason === 'unreachable'
      ? 'Stopped: Shopify could not be reached with this store domain and token. Press "Re-check permissions".'
      : health.reason === 'not_connected'
        ? 'Stopped: the saved access token cannot be read. Paste it again with "Update access token".'
        : 'Stopped: Shopify rejected the access token. Update it with "Update access token".';
    feeds = feeds.map((f) => ({ ...f, status: 'blocked' as const, note }));
  }
  const missingNeeded = [...new Set(feeds.flatMap((f) => [...f.missing_required, ...f.missing_optional]))];
  const webhookSecretSaved = Boolean(cred.encrypted_webhook_secret);

  return {
    connection: {
      connected,
      shop_domain: storeRes.rows[0]?.shop_domain || null,
      shop_name: health?.shop_name || null,
      overall_status: health?.overall_status || (connected ? 'unknown' : 'down'),
      reason: health?.reason || (connected ? null : 'not_connected'),
      token_valid: health ? health.token_valid : null,
      checked_at: health?.checked_at || null,
      webhook_secret_saved: webhookSecretSaved,
      storefront_token_saved: hasSecret(cred.encrypted_storefront_token, cred.encryption_iv),
    },
    scopes,
    feeds,
    syncs: {
      orders: ordersSync,
      webhooks: byResource('webhooks'),
      meta_spend: byResource('meta_spend'),
      pixel: byResource('pixel'),
    },
    orders: { mirrored, latest_order_at: latest?.created_at || null, latest_order_name: latest?.name || null },
    fix_steps: !connected
      ? ['Connect Shopify: paste your store\'s Admin API access token with "Update access token".']
      : health?.reason === 'token_invalid' || health?.reason === 'not_connected'
        ? ['Shopify rejected the saved access token. In Shopify admin open your custom app → API credentials, copy the Admin API access token and paste it with "Update access token".']
        : health?.reason === 'unreachable'
          ? ['Shopify could not be reached. Check the store domain, then press "Re-check permissions".']
          : fixSteps(missingNeeded, webhookSecretSaved),
  };
}
