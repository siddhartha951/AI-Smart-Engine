/**
 * Shopify Connection Health Check — types.
 *
 * The health check probes the Shopify Admin REST API with lightweight
 * (limit=1) calls and classifies the result per scope so the dashboard can
 * tell a merchant exactly which permission is missing and how to fix it.
 */

export type ShopifyScopeStatus = 'ok' | 'missing' | 'error' | 'unchecked';
export type HealthOverallStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export type HealthReason =
  | 'not_connected'
  | 'token_invalid'
  | 'unreachable'
  | 'scopes_missing'
  | 'wrong_store'
  | 'ok';

export interface ShopifyScopeCheck {
  /** Shopify access scope, e.g. 'read_orders'. */
  scope: string;
  status: ShopifyScopeStatus;
  /** Endpoint probed, e.g. 'orders.json'. Never contains the token. */
  tested_endpoint: string;
  /** Merchant-facing description of what this scope unlocks. */
  unlocks: string;
  /** Extra detail for non-ok states, e.g. 'HTTP 403 — scope not granted'. */
  detail?: string;
}

export interface ShopifyHealthResult {
  overall_status: HealthOverallStatus;
  reason: HealthReason | null;
  token_valid: boolean;
  /** Null when the token could not be validated at all. */
  store_match: boolean | null;
  shop_name: string | null;
  scopes: ShopifyScopeCheck[];
  /** Raw X-Shopify-Shop-Api-Call-Limit header value, e.g. '12/40'. */
  rate_limit: string | null;
  /** Merchant-facing remediation steps (present when something needs fixing). */
  fix_steps: string[];
  checked_at: string; // ISO timestamp
}

/** Shape served by GET /:storeId/shopify/health when no check has run yet. */
export interface ShopifyHealthEmpty {
  checked: false;
}
