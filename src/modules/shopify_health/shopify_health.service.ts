/**
 * Shopify Connection Health Check service.
 *
 * Probes the Shopify Admin REST API with lightweight (limit=1) calls using the
 * store's saved encrypted credentials and classifies the outcome per scope:
 *
 *   - shop.json 401/403        -> token invalid or expired (down)
 *   - shop.json network timeout -> Shopify unreachable (down)
 *   - sub-endpoint 403 while shop.json succeeds -> that scope is missing (degraded)
 *   - myshopify_domain mismatch -> wrong store connected (degraded, flagged)
 *
 * Security: the access token is sent only in the X-Shopify-Access-Token header
 * and is NEVER logged, persisted, or included in any returned payload.
 * Everything is tenant-scoped by storeId.
 */
import { getDatabaseClient } from '../../database/client';
import { decryptString } from '../../utils/crypto';
import { TenantIsolationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import {
  HealthOverallStatus,
  HealthReason,
  ShopifyHealthResult,
  ShopifyScopeCheck,
  ShopifyScopeStatus,
} from './shopify_health.types';

const SHOPIFY_API_VERSION = '2024-01';
const REQUEST_TIMEOUT_MS = 10000;

interface ScopeProbe {
  scope: string;
  /** Path + query appended after /admin/api/<version>/ */
  path: string;
  unlocks: string;
}

const SCOPE_PROBES: ScopeProbe[] = [
  {
    scope: 'read_orders',
    path: 'orders.json?limit=1&status=any',
    unlocks: 'Revenue timeline, orders dashboard, and AI Agent sales Q&A ("aaj kitni sale hui?")',
  },
  {
    scope: 'read_products',
    path: 'products.json?limit=1',
    unlocks: 'Top products, product catalog sync, and AI product context',
  },
  {
    scope: 'read_customers',
    path: 'customers.json?limit=1',
    unlocks: 'Customer insights and repeat-buyer analysis',
  },
];

const FIX_STEPS_SCOPE_MISSING = [
  'Open your Shopify admin → Apps → App and sales channel settings.',
  'Open your custom app → API credentials → Admin API access scopes.',
  'Tick the missing scopes listed above (at minimum read_orders) and click Save.',
  'Regenerate the Admin API access token (tokens cannot gain new scopes retroactively).',
  'Paste the new token back here under Connections → Shopify and reconnect.',
];

const FIX_STEPS_TOKEN_INVALID = [
  'Your Shopify access token is invalid or has expired.',
  'Open your Shopify admin → Apps → App and sales channel settings → your custom app → API credentials.',
  'Regenerate the Admin API access token.',
  'Paste the new token back here under Connections → Shopify and reconnect.',
];

const FIX_STEPS_NOT_CONNECTED = [
  'Shopify is not connected for this store yet.',
  'Complete the Shopify step in onboarding, or reconnect under Connections → Shopify with your store domain and Admin API access token.',
];

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

interface ProbeOutcome {
  status: number | null; // null = network/timeout
  rateLimit: string | null;
  body: any;
}

/** Lightweight GET against the Admin REST API. Never throws for HTTP errors. */
async function probeShopify(
  shopDomain: string,
  adminToken: string,
  path: string
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Token travels in the header only — never in the URL, never logged.
    const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/${path}`, {
      headers: {
        'X-Shopify-Access-Token': adminToken,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return {
      status: res.status,
      rateLimit: res.headers.get('X-Shopify-Shop-Api-Call-Limit'),
      body,
    };
  } catch {
    logger.warn('Shopify health probe failed', { path: path.split('?')[0] });
    return { status: null, rateLimit: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

async function getAdminCredentials(
  storeId: string
): Promise<{ adminToken: string; shopDomain: string } | null> {
  if (!storeId) {
    throw new TenantIsolationError('store_id is required');
  }
  const db = getDatabaseClient();
  const res = await db.query(
    `SELECT c.encrypted_admin_token, c.encryption_iv, s.shop_domain
     FROM store_credentials c
     JOIN stores s ON s.id = c.store_id
     WHERE c.store_id = $1`,
    [storeId]
  );
  if (res.rows.length === 0) {
    return null;
  }
  const { encrypted_admin_token, encryption_iv, shop_domain } = res.rows[0];
  if (!encrypted_admin_token) {
    return null;
  }
  try {
    return {
      adminToken: decryptString(encrypted_admin_token, encryption_iv),
      shopDomain: shop_domain,
    };
  } catch {
    // Corrupt/legacy-encrypted row: treat as unusable credentials rather than
    // crashing the health check — the merchant guidance is to reconnect.
    logger.warn('Shopify credentials could not be decrypted for health check', { storeId });
    return null;
  }
}

function classifyScopeProbe(outcome: ProbeOutcome): { status: ShopifyScopeStatus; detail?: string } {
  if (outcome.status === null) {
    return { status: 'error', detail: 'Request timed out or Shopify was unreachable' };
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    return { status: 'ok' };
  }
  if (outcome.status === 403) {
    return { status: 'missing', detail: 'HTTP 403 — this scope is not granted on the token' };
  }
  if (outcome.status === 401) {
    return { status: 'error', detail: 'HTTP 401 — token rejected on this endpoint' };
  }
  return { status: 'error', detail: `HTTP ${outcome.status}` };
}

export class ShopifyHealthService {
  /**
   * Runs a live health check against Shopify and persists the result.
   * Makes 4 lightweight calls max (shop.json + 3 scope probes).
   */
  async checkHealth(storeId: string): Promise<ShopifyHealthResult> {
    if (!storeId) {
      throw new TenantIsolationError('store_id is required');
    }
    const creds = await getAdminCredentials(storeId);
    const checkedAt = new Date().toISOString();

    if (!creds) {
      const result: ShopifyHealthResult = {
        overall_status: 'down',
        reason: 'not_connected',
        token_valid: false,
        store_match: null,
        shop_name: null,
        scopes: SCOPE_PROBES.map((p) => ({
          scope: p.scope,
          status: 'unchecked',
          tested_endpoint: p.path.split('?')[0],
          unlocks: p.unlocks,
        })),
        rate_limit: null,
        fix_steps: FIX_STEPS_NOT_CONNECTED,
        checked_at: checkedAt,
      };
      await this.persist(storeId, result);
      return result;
    }

    // 1. Token validity + store identity
    const shopProbe = await probeShopify(creds.shopDomain, creds.adminToken, 'shop.json');

    if (shopProbe.status === null) {
      const result: ShopifyHealthResult = {
        overall_status: 'down',
        reason: 'unreachable',
        token_valid: false,
        store_match: null,
        shop_name: null,
        scopes: SCOPE_PROBES.map((p) => ({
          scope: p.scope,
          status: 'unchecked',
          tested_endpoint: p.path.split('?')[0],
          unlocks: p.unlocks,
        })),
        rate_limit: null,
        fix_steps: [
          'Could not reach your Shopify store (network timeout).',
          'Check that the store domain is correct and Shopify is online, then press Re-check.',
        ],
        checked_at: checkedAt,
      };
      await this.persist(storeId, result);
      return result;
    }

    if (shopProbe.status === 401 || shopProbe.status === 403) {
      const result: ShopifyHealthResult = {
        overall_status: 'down',
        reason: 'token_invalid',
        token_valid: false,
        store_match: null,
        shop_name: null,
        scopes: SCOPE_PROBES.map((p) => ({
          scope: p.scope,
          status: 'unchecked',
          tested_endpoint: p.path.split('?')[0],
          unlocks: p.unlocks,
        })),
        rate_limit: shopProbe.rateLimit,
        fix_steps: FIX_STEPS_TOKEN_INVALID,
        checked_at: checkedAt,
      };
      await this.persist(storeId, result);
      return result;
    }

    const shop = (shopProbe.body && shopProbe.body.shop) || {};
    const liveDomain = typeof shop.myshopify_domain === 'string' ? shop.myshopify_domain : '';
    const storeMatch = liveDomain
      ? normalizeDomain(liveDomain) === normalizeDomain(creds.shopDomain)
      : null;
    const shopName = typeof shop.name === 'string' ? shop.name : null;

    // 2. Per-scope probes (only meaningful now that the token is valid)
    const scopes: ShopifyScopeCheck[] = [];
    for (const probe of SCOPE_PROBES) {
      const outcome = await probeShopify(creds.shopDomain, creds.adminToken, probe.path);
      const { status, detail } = classifyScopeProbe(outcome);
      scopes.push({
        scope: probe.scope,
        status,
        tested_endpoint: probe.path.split('?')[0],
        unlocks: probe.unlocks,
        ...(detail ? { detail } : {}),
      });
    }

    const missing = scopes.filter((s) => s.status === 'missing');
    const errored = scopes.filter((s) => s.status === 'error');

    let overall: HealthOverallStatus = 'healthy';
    let reason: HealthReason = 'ok';
    let fixSteps: string[] = [];

    if (storeMatch === false) {
      overall = 'degraded';
      reason = 'wrong_store';
      fixSteps = [
        `This token belongs to "${liveDomain || 'another store'}", but the store is registered as "${creds.shopDomain}".`,
        'Reconnect Shopify with the Admin API token from the correct store’s custom app.',
      ];
    } else if (missing.length > 0) {
      overall = 'degraded';
      reason = 'scopes_missing';
      fixSteps = [
        `Missing scope${missing.length > 1 ? 's' : ''}: ${missing.map((s) => s.scope).join(', ')}.`,
        ...FIX_STEPS_SCOPE_MISSING,
      ];
    } else if (errored.length > 0) {
      overall = 'degraded';
      reason = 'scopes_missing';
      fixSteps = [
        `Could not verify scope${errored.length > 1 ? 's' : ''}: ${errored.map((s) => s.scope).join(', ')} (${errored.map((s) => s.detail || 'request failed').join('; ')}).`,
        'Press Re-check. If it persists, regenerate the token with the required scopes.',
      ];
    }

    const result: ShopifyHealthResult = {
      overall_status: overall,
      reason,
      token_valid: true,
      store_match: storeMatch,
      shop_name: shopName,
      scopes,
      rate_limit: shopProbe.rateLimit,
      fix_steps: fixSteps,
      checked_at: checkedAt,
    };
    await this.persist(storeId, result);
    return result;
  }

  /** Returns the last stored check (no live Shopify calls). */
  async getLastHealth(storeId: string): Promise<ShopifyHealthResult | null> {
    if (!storeId) {
      throw new TenantIsolationError('store_id is required');
    }
    const db = getDatabaseClient();
    let res;
    try {
      res = await db.query(
        `SELECT overall_status, reason, token_valid, store_match, shop_name, scopes, rate_limit, checked_at
         FROM shopify_health_checks WHERE store_id = $1`,
        [storeId]
      );
    } catch {
      // Table may not exist on a database that hasn't run migration 029 yet.
      return null;
    }
    if (res.rows.length === 0) {
      return null;
    }
    const row = res.rows[0];
    return {
      overall_status: row.overall_status,
      reason: row.reason,
      token_valid: Boolean(row.token_valid),
      store_match: row.store_match === null ? null : Boolean(row.store_match),
      shop_name: row.shop_name,
      scopes: Array.isArray(row.scopes) ? row.scopes : [],
      rate_limit: row.rate_limit,
      fix_steps: [], // fix steps are rebuilt live when needed; the row keeps status only
      checked_at:
        row.checked_at instanceof Date ? row.checked_at.toISOString() : String(row.checked_at),
    };
  }

  /**
   * Short merchant-facing summary for the Merchant AI Agent to append to its
   * honest "data not available" notes. Returns null when there is nothing to
   * flag (healthy, or no check has run yet — the agent must not live-probe).
   */
  async getShopifyHealthSummary(storeId: string): Promise<string | null> {
    const creds = await getAdminCredentials(storeId).catch(() => null);
    if (!creds) {
      return 'Shopify is not connected for this store yet. Connect it under Connections → Shopify (store domain + Admin API access token) to unlock sales Q&A.';
    }
    const health = await this.getLastHealth(storeId).catch(() => null);
    if (!health || health.overall_status === 'healthy') {
      return null;
    }
    if (health.reason === 'token_invalid') {
      return 'The Shopify access token looks invalid or expired. Fix: Connections → Shopify → reconnect with a fresh Admin API access token (regenerate it in Shopify admin → Apps → your custom app → API credentials).';
    }
    if (health.reason === 'unreachable') {
      return 'Shopify could not be reached the last time the connection was checked. Verify the store domain, then press Re-check under Connections → Shopify.';
    }
    if (health.reason === 'wrong_store') {
      return 'The saved Shopify token belongs to a different store than the one registered here. Fix: Connections → Shopify → reconnect with the token from the correct store’s custom app.';
    }
    const missing = (health.scopes || [])
      .filter((s) => s.status === 'missing')
      .map((s) => s.scope);
    if (missing.length > 0) {
      return (
        `Shopify API scope${missing.length > 1 ? 's' : ''} missing on the saved token: ${missing.join(', ')}. ` +
        'Fix: Shopify admin → Apps → your custom app → API credentials → tick the missing scopes → Save → regenerate the Admin API access token (scopes cannot be added to an old token) → paste the new token under Connections → Shopify.'
      );
    }
    return 'The Shopify connection needs attention. Open Connections → Shopify and press Re-check for exact steps.';
  }

  private async persist(storeId: string, result: ShopifyHealthResult): Promise<void> {
    const db = getDatabaseClient();
    try {
      await db.query(
        `INSERT INTO shopify_health_checks
           (store_id, overall_status, reason, token_valid, store_match, shop_name, scopes, rate_limit, checked_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz, NOW())
         ON CONFLICT (store_id) DO UPDATE SET
           overall_status = EXCLUDED.overall_status,
           reason = EXCLUDED.reason,
           token_valid = EXCLUDED.token_valid,
           store_match = EXCLUDED.store_match,
           shop_name = EXCLUDED.shop_name,
           scopes = EXCLUDED.scopes,
           rate_limit = EXCLUDED.rate_limit,
           checked_at = EXCLUDED.checked_at`,
        [
          storeId,
          result.overall_status,
          result.reason,
          result.token_valid,
          result.store_match,
          result.shop_name,
          JSON.stringify(result.scopes),
          result.rate_limit,
          result.checked_at,
        ]
      );
    } catch {
      // Never fail the caller's flow because the health row couldn't persist.
      logger.warn('Could not persist Shopify health check', { storeId });
    }
  }

  /**
   * Validates a CANDIDATE Admin API token with a single lightweight shop.json
   * call — before it is ever saved. The token is passed in, never read from
   * storage, never logged, never persisted, and never included in the result.
   */
  async probeTokenValidity(
    shopDomain: string,
    adminToken: string
  ): Promise<{ valid: boolean; reason: 'ok' | 'invalid' | 'unreachable'; shopName: string | null }> {
    if (!shopDomain || !adminToken) {
      throw new TenantIsolationError('shop_domain and admin_token are required');
    }
    const outcome = await probeShopify(normalizeDomain(shopDomain), adminToken, 'shop.json');
    if (outcome.status === null) {
      return { valid: false, reason: 'unreachable', shopName: null };
    }
    if (outcome.status === 401 || outcome.status === 403) {
      return { valid: false, reason: 'invalid', shopName: null };
    }
    if (outcome.status >= 200 && outcome.status < 300) {
      const shop = (outcome.body && outcome.body.shop) || {};
      return {
        valid: true,
        reason: 'ok',
        shopName: typeof shop.name === 'string' ? shop.name : null,
      };
    }
    return { valid: false, reason: 'invalid', shopName: null };
  }

  /**
   * Removes the cached health check for a store (used on disconnect).
   * Never throws — a missing table must not break the disconnect flow.
   */
  async clearHealth(storeId: string): Promise<void> {
    if (!storeId) {
      throw new TenantIsolationError('store_id is required');
    }
    try {
      const db = getDatabaseClient();
      await db.query('DELETE FROM shopify_health_checks WHERE store_id = $1', [storeId]);
    } catch {
      // Table may not exist on a database that hasn't run migration 029 yet.
    }
  }
}
