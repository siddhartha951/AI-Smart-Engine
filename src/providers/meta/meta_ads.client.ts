/**
 * Meta Marketing API client (graph.facebook.com).
 *
 * Thin, dependency-free HTTP wrapper around the endpoints the dashboard needs:
 * token validation, ad account listing, and ads insights. Uses global fetch with
 * a request timeout so a slow Meta API can never hang a production request.
 *
 * Security: access tokens are passed as query params (Meta's required style).
 * This client NEVER logs tokens or full URLs containing them.
 */
import { logger } from '../../utils/logger';

export const META_GRAPH_API_VERSION = 'v21.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

// Long-lived Meta user tokens expire after ~60 days. We warn the merchant when
// the token is older than this threshold because the Graph API does not expose
// token expiry without an app access token.
export const META_TOKEN_EXPIRY_WARNING_DAYS = 50;

/** Default HTTP timeout for Meta Graph API calls (ms). */
export const META_REQUEST_TIMEOUT_MS = 20000;

export interface MetaApiErrorBody {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export class MetaAdsApiError extends Error {
  public readonly metaCode: number;
  public readonly metaType: string;
  public readonly statusCode: number;
  /** True when the token is invalid/expired (Meta OAuthException code 190 / 102). */
  public readonly isTokenError: boolean;

  constructor(message: string, metaCode: number, metaType: string, statusCode = 502) {
    super(message);
    this.name = 'MetaAdsApiError';
    this.metaCode = metaCode;
    this.metaType = metaType;
    this.statusCode = statusCode;
    this.isTokenError = metaCode === 190 || metaCode === 102 || (metaType === 'OAuthException' && metaCode === 0);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Merchant-safe message (no token, no internal trace details). */
  public toUserMessage(): string {
    if (this.isTokenError) {
      return 'Your Meta access token is invalid or has expired. Please reconnect with a fresh token (Meta tokens expire after ~60 days).';
    }
    if (this.metaCode === 200 || this.metaCode === 10) {
      return 'Meta rejected the request: missing permission. Make sure the token was created with the ads_read permission.';
    }
    return `Meta API error: ${this.message}`;
  }
}

export interface MetaTokenInfo {
  userId: string;
  userName: string;
}

export interface MetaAdAccount {
  id: string; // e.g. "act_123456789"
  accountId: string; // numeric part without "act_"
  name: string;
  accountStatus: number;
  currency: string;
  timezoneName?: string;
}

export type MetaInsightLevel = 'account' | 'campaign' | 'adset' | 'ad';

export type MetaDatePreset =
  | 'today'
  | 'yesterday'
  | 'last_7d'
  | 'last_14d'
  | 'last_30d'
  | 'last_90d';

export interface MetaInsightOptions {
  level?: MetaInsightLevel;
  datePreset?: MetaDatePreset;
  /** Explicit range (YYYY-MM-DD). Overrides datePreset when both since & until are set. */
  since?: string;
  until?: string;
  limit?: number;
  /** 1 = one row per day (used by the daily ad spend sync) */
  timeIncrement?: 1;
}

export interface MetaActionValue {
  action_type: string;
  value: string;
}

export interface MetaInsightRow {
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  adId?: string;
  adName?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number; // percent
  cpc: number;
  conversions: number; // purchase actions
  conversionValue: number;
  roas: number; // conversionValue / spend
  dateStart?: string;
  dateStop?: string;
}

export interface MetaInsightsResult {
  rows: MetaInsightRow[];
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    conversions: number;
    conversionValue: number;
    roas: number;
  };
  accountCurrency: string;
}

/** One ad with its creative snapshot, as returned by /act_{id}/ads. */
export interface MetaExplorerAd {
  adId: string;
  name: string;
  /** Meta effective_status (ACTIVE, PAUSED, ARCHIVED, ...). */
  status: string;
  campaignName: string | null;
  adsetName: string | null;
  /** Best available creative image (image_url, else thumbnail_url). */
  thumbnailUrl: string | null;
  /** Full creative asset URL when Meta exposes one (image_url). */
  creativeUrl: string | null;
  /** Destination link from object_story_spec.link_data.link. */
  destinationUrl: string | null;
}

/** Max pages fetched per explorer sync (100 ads/page => up to 10k ads). */
export const META_EXPLORER_MAX_PAGES = 100;

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parses one raw ad object from /act_{id}/ads into a MetaExplorerAd. */
export function parseExplorerAd(raw: Record<string, unknown>): MetaExplorerAd {
  const creatives =
    raw.adcreatives && typeof raw.adcreatives === 'object'
      ? (raw.adcreatives as { data?: Array<Record<string, unknown>> }).data
      : undefined;
  const creative = Array.isArray(creatives) && creatives.length > 0 ? creatives[0] : null;

  const linkData =
    creative && typeof creative.object_story_spec === 'object' && creative.object_story_spec !== null
      ? ((creative.object_story_spec as Record<string, unknown>).link_data as Record<string, unknown> | undefined)
      : undefined;

  const imageUrl = creative ? strOrNull(creative.image_url) : null;
  const thumbnailUrl = creative ? strOrNull(creative.thumbnail_url) : null;

  const campaign =
    raw.campaign && typeof raw.campaign === 'object'
      ? (raw.campaign as Record<string, unknown>)
      : null;
  const adset =
    raw.adset && typeof raw.adset === 'object' ? (raw.adset as Record<string, unknown>) : null;

  return {
    adId: String(raw.id || ''),
    name: typeof raw.name === 'string' ? raw.name : '',
    status: typeof raw.effective_status === 'string' ? raw.effective_status : 'UNKNOWN',
    campaignName: campaign ? strOrNull(campaign.name) : null,
    adsetName: adset ? strOrNull(adset.name) : null,
    thumbnailUrl: imageUrl || thumbnailUrl,
    creativeUrl: imageUrl,
    destinationUrl: linkData ? strOrNull(linkData.link) : null,
  };
}

function isPurchaseAction(actionType: string): boolean {
  const t = actionType.toLowerCase();
  return (
    t === 'purchase' ||
    t === 'offsite_conversion.fb_pixel_purchase' ||
    t === 'onsite_conversion.purchase' ||
    t === 'omni_purchase'
  );
}

function toNumber(value: unknown): number {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function parseInsightRow(raw: Record<string, unknown>): MetaInsightRow {
  const spend = toNumber(raw.spend);
  const impressions = Math.round(toNumber(raw.impressions));
  const clicks = Math.round(toNumber(raw.clicks));
  const actions = Array.isArray(raw.actions) ? (raw.actions as Array<Record<string, unknown>>) : [];
  const actionValues = Array.isArray(raw.action_values)
    ? (raw.action_values as Array<Record<string, unknown>>)
    : [];

  let conversions = 0;
  for (const a of actions) {
    if (isPurchaseAction(String(a.action_type || ''))) {
      conversions += Math.round(toNumber(a.value));
    }
  }
  let conversionValue = 0;
  for (const av of actionValues) {
    if (isPurchaseAction(String(av.action_type || ''))) {
      conversionValue += toNumber(av.value);
    }
  }

  const ctr = toNumber(raw.ctr);
  const cpc = toNumber(raw.cpc);

  return {
    campaignId: typeof raw.campaign_id === 'string' ? raw.campaign_id : undefined,
    campaignName: typeof raw.campaign_name === 'string' ? raw.campaign_name : undefined,
    adsetId: typeof raw.adset_id === 'string' ? raw.adset_id : undefined,
    adsetName: typeof raw.adset_name === 'string' ? raw.adset_name : undefined,
    adId: typeof raw.ad_id === 'string' ? raw.ad_id : undefined,
    adName: typeof raw.ad_name === 'string' ? raw.ad_name : undefined,
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 && !ctr ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : ctr,
    cpc: clicks > 0 && !cpc ? parseFloat((spend / clicks).toFixed(2)) : cpc,
    conversions,
    conversionValue: parseFloat(conversionValue.toFixed(2)),
    roas: spend > 0 ? parseFloat((conversionValue / spend).toFixed(2)) : 0,
    dateStart: typeof raw.date_start === 'string' ? raw.date_start : undefined,
    dateStop: typeof raw.date_stop === 'string' ? raw.date_stop : undefined,
  };
}

export function summarizeInsights(rows: MetaInsightRow[]): MetaInsightsResult['totals'] {
  const totals = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      conversions: acc.conversions + r.conversions,
      conversionValue: acc.conversionValue + r.conversionValue,
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
  );
  return {
    spend: parseFloat(totals.spend.toFixed(2)),
    impressions: totals.impressions,
    clicks: totals.clicks,
    ctr: totals.impressions > 0 ? parseFloat(((totals.clicks / totals.impressions) * 100).toFixed(2)) : 0,
    cpc: totals.clicks > 0 ? parseFloat((totals.spend / totals.clicks).toFixed(2)) : 0,
    conversions: totals.conversions,
    conversionValue: parseFloat(totals.conversionValue.toFixed(2)),
    roas: totals.spend > 0 ? parseFloat((totals.conversionValue / totals.spend).toFixed(2)) : 0,
  };
}

export class MetaAdsClient {
  private readonly timeoutMs: number;

  constructor(opts?: { timeoutMs?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? META_REQUEST_TIMEOUT_MS;
  }

  private async metaGet<T>(path: string, accessToken: string, params: Record<string, string> = {}): Promise<T> {
    if (!accessToken) {
      throw new MetaAdsApiError('Meta access token is required', 190, 'OAuthException', 400);
    }
    const url = new URL(`${META_GRAPH_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    // Token must travel as a query param for the Graph API. Never log it.
    url.searchParams.set('access_token', accessToken);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.error) {
        const errBody = (body.error || {}) as MetaApiErrorBody;
        const message = errBody.message || `Meta API request failed with status ${res.status}`;
        throw new MetaAdsApiError(message, errBody.code ?? 0, errBody.type || 'Unknown', res.status >= 500 ? 502 : 400);
      }
      return body as T;
    } catch (err) {
      if (err instanceof MetaAdsApiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MetaAdsApiError('Meta API request timed out. Please try again.', 0, 'Timeout', 504);
      }
      logger.warn('Meta Graph API request failed', { path });
      throw new MetaAdsApiError('Could not reach the Meta API. Please check your connection and try again.', 0, 'NetworkError', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Validates that the token belongs to a real Meta user. */
  async validateToken(accessToken: string): Promise<MetaTokenInfo> {
    const body = await this.metaGet<{ id: string; name: string }>('/me', accessToken, {
      fields: 'id,name',
    });
    if (!body.id) {
      throw new MetaAdsApiError('Meta token validation returned no user', 190, 'OAuthException', 400);
    }
    return { userId: body.id, userName: body.name || 'Meta User' };
  }

  /** Lists ad accounts the token can access (requires ads_read). */
  async listAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
    const body = await this.metaGet<{ data?: Array<Record<string, unknown>> }>(
      '/me/adaccounts',
      accessToken,
      { fields: 'id,name,account_status,currency,timezone_name', limit: '100' }
    );
    const accounts = Array.isArray(body.data) ? body.data : [];
    return accounts.map((a) => {
      const id = String(a.id || '');
      return {
        id,
        accountId: id.replace(/^act_/, ''),
        name: String(a.name || id),
        accountStatus: Number(a.account_status || 0),
        currency: String(a.currency || ''),
        timezoneName: typeof a.timezone_name === 'string' ? a.timezone_name : undefined,
      };
    });
  }

  /** Fetches an absolute Meta Graph URL (used to follow paging.next cursors). Never logs tokens. */
  private async metaGetAbsolute<T>(absoluteUrl: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(absoluteUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.error) {
        const errBody = (body.error || {}) as MetaApiErrorBody;
        const message = errBody.message || `Meta API request failed with status ${res.status}`;
        throw new MetaAdsApiError(message, errBody.code ?? 0, errBody.type || 'Unknown', res.status >= 500 ? 502 : 400);
      }
      return body as T;
    } catch (err) {
      if (err instanceof MetaAdsApiError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MetaAdsApiError('Meta API request timed out. Please try again.', 0, 'Timeout', 504);
      }
      logger.warn('Meta Graph API request failed', { absolute: true });
      throw new MetaAdsApiError('Could not reach the Meta API. Please check your connection and try again.', 0, 'NetworkError', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches ads with creatives for an ad account, following pagination.
   * One paginated pass only; capped at META_EXPLORER_MAX_PAGES pages so a
   * sync can never run away against Meta rate limits.
   * @param accountId numeric ad account id WITHOUT the "act_" prefix (prefix added automatically).
   */
  async listAdsWithCreatives(accessToken: string, accountId: string): Promise<MetaExplorerAd[]> {
    const cleanId = accountId.replace(/^act_/, '');
    if (!/^\d+$/.test(cleanId)) {
      throw new MetaAdsApiError('Invalid Meta ad account id', 0, 'ValidationError', 400);
    }
    if (!accessToken) {
      throw new MetaAdsApiError('Meta access token is required', 190, 'OAuthException', 400);
    }

    const ads: MetaExplorerAd[] = [];
    const params: Record<string, string> = {
      fields:
        'id,name,effective_status,campaign{name},adset{name},adcreatives{thumbnail_url,image_url,video_id,object_story_spec{link_data{link}}}',
      limit: '100',
      access_token: accessToken,
    };
    const url = new URL(`${META_GRAPH_BASE}/act_${cleanId}/ads`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    let nextUrl: string | null = url.toString();
    let pages = 0;
    while (nextUrl && pages < META_EXPLORER_MAX_PAGES) {
      pages += 1;
      const body: {
        data?: Array<Record<string, unknown>>;
        paging?: { next?: string };
      } = await this.metaGetAbsolute(nextUrl);
      const rows = Array.isArray(body.data) ? body.data : [];
      for (const raw of rows) {
        const ad = parseExplorerAd(raw);
        if (ad.adId) ads.push(ad);
      }
      nextUrl = body.paging && typeof body.paging.next === 'string' ? body.paging.next : null;
    }
    return ads;
  }

  /**
   * Fetches ads insights for an ad account.
   * @param accountId numeric ad account id WITHOUT the "act_" prefix (prefix added automatically).
   */
  async getInsights(
    accessToken: string,
    accountId: string,
    opts: MetaInsightOptions = {}
  ): Promise<MetaInsightsResult> {
    const cleanId = accountId.replace(/^act_/, '');
    if (!/^\d+$/.test(cleanId)) {
      throw new MetaAdsApiError('Invalid Meta ad account id', 0, 'ValidationError', 400);
    }
    const level = opts.level || 'campaign';
    const params: Record<string, string> = {
      level,
      fields:
        'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpc,actions,action_values,date_start,date_stop',
      limit: String(Math.min(Math.max(opts.limit || 100, 1), 500)),
    };
    if (opts.since && opts.until) {
      params.time_range = JSON.stringify({ since: opts.since, until: opts.until });
    } else {
      params.date_preset = opts.datePreset || 'last_30d';
    }
    if (opts.timeIncrement) params.time_increment = String(opts.timeIncrement);

    const body = await this.metaGet<{ data?: Array<Record<string, unknown>> }>(
      `/act_${cleanId}/insights`,
      accessToken,
      params
    );
    const rows = (Array.isArray(body.data) ? body.data : []).map(parseInsightRow);
    return { rows, totals: summarizeInsights(rows), accountCurrency: '' };
  }
}

let defaultClient: MetaAdsClient | null = null;

/** Shared MetaAdsClient instance (stateless; safe for concurrent use). */
export function getMetaAdsClient(): MetaAdsClient {
  if (!defaultClient) {
    defaultClient = new MetaAdsClient();
  }
  return defaultClient;
}
