/**
 * Small Shopify Admin API client shared by the orders sync, order lookup, webhooks and
 * the merchant AI tools. Never throws for HTTP errors: callers get the status and decide
 * (403 = a scope is missing, 401 = token invalid). The access token only travels in the
 * X-Shopify-Access-Token header and is never logged or returned.
 */
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { getEnvConfig } from '../../config/env';
import { decryptString } from '../../utils/crypto';
import { TenantIsolationError } from '../../utils/errors';
import { logger } from '../../utils/logger';

const REQUEST_TIMEOUT_MS = 20000;

/** One API version for every Shopify call (SHOPIFY_API_VERSION overrides it). */
export function shopifyApiVersion(): string {
  try {
    return getEnvConfig().SHOPIFY_API_VERSION || '2025-10';
  } catch {
    return '2025-10';
  }
}

export interface AdminCredentials {
  shopDomain: string;
  adminToken: string;
}

/** Decrypted admin token + domain for a store, or null when Shopify is not connected. */
export async function getAdminCredentials(storeId: string, db: IDatabaseClient = getDatabaseClient()): Promise<AdminCredentials | null> {
  if (!storeId) throw new TenantIsolationError('store_id is required');
  const res = await db.query(
    `SELECT c.encrypted_admin_token, c.encryption_iv, s.shop_domain
     FROM store_credentials c JOIN stores s ON s.id = c.store_id
     WHERE c.store_id = $1`,
    [storeId]
  );
  const row = res.rows[0];
  if (!row || !row.encrypted_admin_token || !row.shop_domain) return null;
  try {
    const adminToken = decryptString(row.encrypted_admin_token, row.encryption_iv);
    return adminToken ? { shopDomain: String(row.shop_domain), adminToken } : null;
  } catch {
    logger.warn('Shopify admin token could not be decrypted', { storeId });
    return null;
  }
}

export interface AdminResponse<T = any> {
  /** null = network error or timeout */
  status: number | null;
  ok: boolean;
  body: T | null;
  /** Shopify cursor for the next page (REST Link header), when there is one */
  nextPageInfo: string | null;
}

/** "<...page_info=abc...>; rel=\"next\"" -> "abc" */
export function parseNextPageInfo(link: string | null | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="?next"?/.test(part)) continue;
    const url = part.match(/<([^>]+)>/)?.[1];
    if (!url) continue;
    try {
      return new URL(url).searchParams.get('page_info');
    } catch {
      return null;
    }
  }
  return null;
}

async function request<T>(creds: AdminCredentials, url: string, init: RequestInit = {}): Promise<AdminResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'X-Shopify-Access-Token': creds.adminToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
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
      ok: res.ok,
      body,
      nextPageInfo: parseNextPageInfo(res.headers.get('link') || res.headers.get('Link')),
    };
  } catch {
    return { status: null, ok: false, body: null, nextPageInfo: null };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /admin/api/<version>/<path>?<params> */
export function adminGet<T = any>(creds: AdminCredentials, path: string, params: Record<string, string> = {}): Promise<AdminResponse<T>> {
  const qs = new URLSearchParams(params).toString();
  const url = `https://${creds.shopDomain}/admin/api/${shopifyApiVersion()}/${path}${qs ? `?${qs}` : ''}`;
  return request<T>(creds, url);
}

export function adminPost<T = any>(creds: AdminCredentials, path: string, payload: unknown): Promise<AdminResponse<T>> {
  const url = `https://${creds.shopDomain}/admin/api/${shopifyApiVersion()}/${path}`;
  return request<T>(creds, url, { method: 'POST', body: JSON.stringify(payload) });
}

/** Admin GraphQL. A 200 can still carry errors (e.g. ACCESS_DENIED for a missing scope). */
export async function adminGraphql<T = any>(
  creds: AdminCredentials,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<AdminResponse<{ data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> }>> {
  const url = `https://${creds.shopDomain}/admin/api/${shopifyApiVersion()}/graphql.json`;
  return request(creds, url, { method: 'POST', body: JSON.stringify({ query, variables }) });
}

/** True when a GraphQL response was refused because the token lacks a scope. */
export function graphqlAccessDenied(body: { errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null): boolean {
  return Boolean(body?.errors?.some((e) => e?.extensions?.code === 'ACCESS_DENIED' || /access denied/i.test(String(e?.message || ''))));
}
