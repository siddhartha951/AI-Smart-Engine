import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { MetaAdsRepository } from './meta_ads.repository';
import { MetaAdsExplorerRepository } from './meta_ads_explorer.repository';
import { MetaAdsConfig, MetaAdsExplorerCache } from '../../database/types';
import { encryptString, decryptString } from '../../utils/crypto';
import {
  MetaAdsClient,
  MetaAdsApiError,
  MetaAdAccount,
  MetaInsightOptions,
  MetaInsightsResult,
  MetaExplorerAd,
  META_TOKEN_EXPIRY_WARNING_DAYS,
  getMetaAdsClient,
} from '../../providers/meta';
import { TenantIsolationError, ValidationError, AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Meta long-lived user tokens expire after ~60 days; we store this as an estimate.
const TOKEN_LIFETIME_DAYS = 60;

export interface MetaConnectionStatus {
  connected: boolean;
  status: 'disconnected' | 'connected' | 'error';
  adAccountId: string | null;
  adAccountName: string | null;
  accountCurrency: string | null;
  tokenConnectedAt: string | null;
  tokenExpiresAt: string | null;
  /** Days since the token was connected; null when never connected. */
  tokenAgeDays: number | null;
  /** True when the token is approaching/past the ~60 day expiry window. */
  tokenExpiringSoon: boolean;
  tokenExpiryNote: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface MetaCampaignAttribution {
  campaignName: string;
  storeAttributedRevenue: number;
  storeAttributedOrders: number;
}

export interface MetaInsightsResponse extends MetaInsightsResult {
  attribution: MetaCampaignAttribution[];
  attributionNote: string;
}

export interface MetaExplorerSyncResult {
  synced: boolean;
  adAccountId: string;
  adAccountName: string | null;
  adsFetched: number;
  cached: number;
  removed: number;
  lastSyncAt: string;
}

export interface MetaExplorerAdsResult {
  ads: MetaAdsExplorerCache[];
  count: number;
  adAccountId: string;
  adAccountName: string | null;
  lastSyncAt: string | null;
  /** False when the explorer was never synced — frontend shows the empty state. */
  synced: boolean;
}

export class MetaAdsService {
  private db: IDatabaseClient;
  private repo: MetaAdsRepository;
  private explorerRepo: MetaAdsExplorerRepository;
  private client: MetaAdsClient;

  constructor(opts?: { db?: IDatabaseClient; repo?: MetaAdsRepository; client?: MetaAdsClient }) {
    this.db = opts?.db || getDatabaseClient();
    this.repo = opts?.repo || new MetaAdsRepository(this.db);
    this.explorerRepo = new MetaAdsExplorerRepository(this.db);
    this.client = opts?.client || getMetaAdsClient();
  }

  private decryptToken(config: MetaAdsConfig): string {
    if (!config.encrypted_access_token) return '';
    try {
      return decryptString(config.encrypted_access_token);
    } catch (err) {
      logger.error('Failed to decrypt Meta access token', err, { storeId: config.store_id });
      throw new AppError('Stored Meta credentials could not be decrypted. Please reconnect.', 500, 'META_TOKEN_DECRYPT_ERROR');
    }
  }

  /** Converts Meta API errors to merchant-safe AppErrors; flags the stored connection on token failures. Never logs tokens. */
  private async toMetaAppError(storeId: string, err: unknown): Promise<AppError> {
    if (err instanceof MetaAdsApiError) {
      if (err.isTokenError) {
        await this.repo.upsertConfig(storeId, {
          status: 'error',
          lastError: err.toUserMessage(),
        }).catch(() => undefined);
      }
      return new AppError(err.toUserMessage(), err.statusCode, 'META_API_ERROR');
    }
    if (err instanceof AppError) return err;
    return new AppError('Meta Ads request failed. Please try again.', 502, 'META_API_ERROR');
  }

  // ==========================================
  // 1. Connection Management
  // ==========================================

  async getConnectionStatus(storeId: string): Promise<MetaConnectionStatus> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const config = await this.repo.getConfig(storeId);
    const empty: MetaConnectionStatus = {
      connected: false,
      status: 'disconnected',
      adAccountId: null,
      adAccountName: null,
      accountCurrency: null,
      tokenConnectedAt: null,
      tokenExpiresAt: null,
      tokenAgeDays: null,
      tokenExpiringSoon: false,
      tokenExpiryNote: null,
      lastSyncAt: null,
      lastError: null,
    };
    if (!config || !config.encrypted_access_token) return empty;

    const connectedAt = config.token_connected_at ? new Date(config.token_connected_at) : null;
    const tokenAgeDays = connectedAt ? Math.floor((Date.now() - connectedAt.getTime()) / MS_PER_DAY) : null;
    const tokenExpiringSoon = tokenAgeDays !== null && tokenAgeDays >= META_TOKEN_EXPIRY_WARNING_DAYS;

    return {
      connected: config.status === 'connected',
      status: config.status,
      adAccountId: config.ad_account_id,
      adAccountName: config.ad_account_name,
      accountCurrency: config.account_currency,
      tokenConnectedAt: connectedAt ? connectedAt.toISOString() : null,
      tokenExpiresAt: config.token_expires_at ? new Date(config.token_expires_at).toISOString() : null,
      tokenAgeDays,
      tokenExpiringSoon,
      tokenExpiryNote: tokenExpiringSoon
        ? `This token is ${tokenAgeDays} days old. Meta long-lived tokens expire after ~${TOKEN_LIFETIME_DAYS} days — reconnect soon to avoid interruptions.`
        : null,
      lastSyncAt: config.last_sync_at ? new Date(config.last_sync_at).toISOString() : null,
      lastError: config.last_error,
    };
  }

  /** Validates a token against the Meta API without saving anything. */
  async testToken(accessToken: string): Promise<{ valid: boolean; userName: string; accounts: MetaAdAccount[] }> {
    const token = (accessToken || '').trim();
    if (!token) throw new ValidationError('access_token is required');
    try {
      const info = await this.client.validateToken(token);
      const accounts = await this.client.listAdAccounts(token);
      return { valid: true, userName: info.userName, accounts };
    } catch (err) {
      if (err instanceof MetaAdsApiError) {
        throw new AppError(err.toUserMessage(), err.statusCode, 'META_API_ERROR');
      }
      throw err;
    }
  }

  /**
   * Connects a store: validates the token, resolves the ad account, encrypts
   * the token at rest, and records the connection. If the token is invalid,
   * nothing is stored (previous working connection is preserved).
   */
  async connect(
    storeId: string,
    params: { accessToken: string; adAccountId?: string | null }
  ): Promise<MetaConnectionStatus> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const token = (params.accessToken || '').trim();
    if (!token) throw new ValidationError('access_token is required');

    let accounts: MetaAdAccount[];
    try {
      await this.client.validateToken(token);
      accounts = await this.client.listAdAccounts(token);
    } catch (err) {
      if (err instanceof MetaAdsApiError) {
        await this.repo.upsertConfig(storeId, { status: 'error', lastError: err.toUserMessage() }).catch(() => undefined);
        throw new AppError(err.toUserMessage(), err.statusCode, 'META_API_ERROR');
      }
      throw err;
    }

    if (accounts.length === 0) {
      throw new ValidationError('This Meta token has access to no ad accounts. Make sure it was created with the ads_read permission on an account you can access.');
    }

    const requested = (params.adAccountId || '').trim().replace(/^act_/, '');
    const chosen =
      (requested && accounts.find((a) => a.accountId === requested)) ||
      accounts.find((a) => a.accountStatus === 1) ||
      accounts[0];

    const now = new Date();
    const { encryptedString } = encryptString(token);

    await this.repo.upsertConfig(storeId, {
      encryptedAccessToken: encryptedString,
      adAccountId: chosen.accountId,
      adAccountName: chosen.name,
      accountCurrency: chosen.currency || null,
      tokenConnectedAt: now,
      // Estimate: Meta long-lived user tokens expire ~60 days after issuance.
      tokenExpiresAt: new Date(now.getTime() + TOKEN_LIFETIME_DAYS * MS_PER_DAY),
      status: 'connected',
      lastError: null,
      lastSyncAt: now,
    });

    logger.info('Meta Ads connected', { storeId, adAccountId: chosen.accountId });
    return this.getConnectionStatus(storeId);
  }

  async listAdAccounts(storeId: string): Promise<MetaAdAccount[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const config = await this.repo.getConfig(storeId);
    const token = config ? this.decryptToken(config) : '';
    if (!token) throw new ValidationError('No Meta access token connected for this store. Connect first.');
    try {
      return await this.client.listAdAccounts(token);
    } catch (err) {
      throw await this.toMetaAppError(storeId, err);
    }
  }

  async disconnect(storeId: string): Promise<{ disconnected: boolean }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    await this.repo.deleteConfig(storeId);
    // Stale ad snapshots must not linger after credentials are removed.
    await this.explorerRepo.clearStore(storeId).catch(() => undefined);
    logger.info('Meta Ads disconnected', { storeId });
    return { disconnected: true };
  }

  // ==========================================
  // 2. Insights (Meta-reported + store attribution)
  // ==========================================

  /**
   * Public store-side campaign attribution for the Merchant AI Agent.
   * Thin wrapper over the private ledger query — always tenant-scoped.
   */
  async getCampaignAttribution(
    storeId: string,
    since?: string,
    until?: string
  ): Promise<MetaCampaignAttribution[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    return this.getStoreCampaignAttribution(storeId, since, until);
  }

  private async getStoreCampaignAttribution(
    storeId: string,
    since?: string,
    until?: string
  ): Promise<MetaCampaignAttribution[]> {
    // Store-side attributed revenue per campaign from the multi-touch ledger,
    // limited to Meta-family sources (facebook / instagram / meta).
    const params: unknown[] = [storeId];
    let dateFilter = '';
    if (since && until) {
      params.push(since, until);
      dateFilter = `AND t.created_at >= $${params.length - 1}::date AND t.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }
    const res = await this.db.query<{ campaign: string; revenue: string; orders: string }>(
      `SELECT t.campaign AS campaign,
              COALESCE(SUM(t.attributed_revenue), 0) AS revenue,
              COUNT(DISTINCT t.order_id) AS orders
       FROM order_attribution_touchpoints t
       WHERE t.store_id = $1
         AND t.campaign IS NOT NULL AND t.campaign <> '' AND t.campaign <> 'none'
         AND (t.source ILIKE '%facebook%' OR t.source ILIKE '%instagram%' OR t.source ILIKE '%meta%')
         ${dateFilter}
       GROUP BY t.campaign
       ORDER BY revenue DESC
       LIMIT 200`,
      params
    );
    return res.rows.map((r) => ({
      campaignName: r.campaign,
      storeAttributedRevenue: parseFloat(r.revenue || '0'),
      storeAttributedOrders: parseInt(r.orders || '0', 10),
    }));
  }

  async getInsights(
    storeId: string,
    opts: MetaInsightOptions & { adAccountId?: string }
  ): Promise<MetaInsightsResponse> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const datePreset = opts.datePreset || 'last_30d';
    if (opts.since && !/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) {
      throw new ValidationError('since must be YYYY-MM-DD');
    }
    if (opts.until && !/^\d{4}-\d{2}-\d{2}$/.test(opts.until)) {
      throw new ValidationError('until must be YYYY-MM-DD');
    }
    if (opts.since && opts.until && opts.since > opts.until) {
      throw new ValidationError('since must be on or before until');
    }

    const config = await this.repo.getConfig(storeId);
    const token = config ? this.decryptToken(config) : '';
    if (!token || config?.status !== 'connected') {
      throw new ValidationError('No Meta Ads connection for this store. Connect your Meta access token first.');
    }

    const accountId = (opts.adAccountId || config.ad_account_id || '').replace(/^act_/, '');
    if (!accountId) {
      throw new ValidationError('No Meta ad account selected for this store.');
    }

    let result: MetaInsightsResult;
    try {
      result = await this.client.getInsights(token, accountId, {
        level: opts.level,
        datePreset,
        since: opts.since,
        until: opts.until,
        limit: opts.limit,
      });
    } catch (err) {
      throw await this.toMetaAppError(storeId, err);
    }

    const account = (await this.client.listAdAccounts(token).catch(() => [] as MetaAdAccount[]))
      .find((a) => a.accountId === accountId);
    if (account?.currency) {
      result!.accountCurrency = account.currency;
    } else if (config.account_currency) {
      result!.accountCurrency = config.account_currency;
    }

    await this.repo.upsertConfig(storeId, { lastSyncAt: new Date(), lastError: null }).catch(() => undefined);

    // Synergy: store-side attributed revenue per campaign (multi-touch ledger).
    const attribution = await this.getStoreCampaignAttribution(storeId, opts.since, opts.until).catch(() => []);

    return {
      ...result!,
      attribution,
      attributionNote:
        'Store-side revenue comes from your on-site multi-touch attribution ledger (Meta-family sources only: facebook / instagram / meta). Meta-reported conversions come from the ad account.',
    };
  }

  // ==========================================
  // 3. Ads Explorer (cached ad + creative snapshots)
  // ==========================================

  /** Resolves the decrypted token + ad account for explorer operations. */
  private async getExplorerContext(
    storeId: string,
    adAccountId?: string | null
  ): Promise<{ token: string; accountId: string; accountName: string | null }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const config = await this.repo.getConfig(storeId);
    const token = config ? this.decryptToken(config) : '';
    if (!token || config?.status !== 'connected') {
      throw new ValidationError('No Meta Ads connection for this store. Connect your Meta access token first.');
    }
    const accountId = ((adAccountId || config.ad_account_id || '').trim().replace(/^act_/, ''));
    if (!accountId) {
      throw new ValidationError('No Meta ad account selected for this store.');
    }
    return { token, accountId, accountName: config.ad_account_name };
  }

  /**
   * Syncs the explorer cache from the Meta Marketing API (one paginated pass,
   * on demand only). The dashboard serves explorer data from cache, never from
   * a live Meta call, so page loads stay fast and rate limits are respected.
   */
  async syncExplorerAds(
    storeId: string,
    opts: { adAccountId?: string | null } = {}
  ): Promise<MetaExplorerSyncResult> {
    const { token, accountId, accountName } = await this.getExplorerContext(storeId, opts.adAccountId);

    let ads: MetaExplorerAd[];
    try {
      ads = await this.client.listAdsWithCreatives(token, accountId);
    } catch (err) {
      throw await this.toMetaAppError(storeId, err);
    }

    const { cached, removed } = await this.explorerRepo.replaceAds(storeId, accountId, ads);
    const lastSyncAt = await this.explorerRepo.getLastSyncAt(storeId, accountId);

    logger.info('Meta Ads explorer synced', { storeId, adAccountId: accountId, cached, removed });
    return {
      synced: true,
      adAccountId: accountId,
      adAccountName: accountName,
      adsFetched: ads.length,
      cached,
      removed,
      lastSyncAt: (lastSyncAt || new Date()).toISOString(),
    };
  }

  /** Serves explorer ads from cache (fast, no Meta API call). */
  async getExplorerAds(
    storeId: string,
    opts: { adAccountId?: string | null } = {}
  ): Promise<MetaExplorerAdsResult> {
    const { accountId, accountName } = await this.getExplorerContext(storeId, opts.adAccountId);
    const ads = await this.explorerRepo.listAds(storeId, accountId);
    const lastSyncAt = await this.explorerRepo.getLastSyncAt(storeId, accountId);
    return {
      ads,
      count: ads.length,
      adAccountId: accountId,
      adAccountName: accountName,
      lastSyncAt: lastSyncAt ? lastSyncAt.toISOString() : null,
      synced: lastSyncAt !== null,
    };
  }
}
