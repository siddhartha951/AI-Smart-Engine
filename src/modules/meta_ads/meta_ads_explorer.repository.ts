import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { MetaAdsExplorerCache } from '../../database/types';
import { MetaExplorerAd } from '../../providers/meta/meta_ads.client';
import { TenantIsolationError } from '../../utils/errors';

/**
 * Cache repository for the Ads Explorer dashboard section.
 * Stores per-store Meta ad + creative snapshots so the explorer renders
 * instantly from cache; refreshed on demand by syncExplorerAds().
 */
export class MetaAdsExplorerRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  /**
   * Replaces the cached ads for one (store, ad account) with a fresh sync.
   * Uses upsert + stale-row cleanup so the cache is never left empty if the
   * sync is interrupted between statements.
   */
  async replaceAds(
    storeId: string,
    adAccountId: string,
    ads: MetaExplorerAd[]
  ): Promise<{ cached: number; removed: number }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    if (!adAccountId) throw new TenantIsolationError('ad_account_id is required');

    const now = new Date();
    for (const ad of ads) {
      await this.db.query(
        `INSERT INTO meta_ads_explorer_cache (
           store_id, ad_account_id, ad_id, name, status, campaign_name, adset_name,
           thumbnail_url, creative_url, destination_url, last_synced_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (store_id, ad_account_id, ad_id) DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           campaign_name = EXCLUDED.campaign_name,
           adset_name = EXCLUDED.adset_name,
           thumbnail_url = EXCLUDED.thumbnail_url,
           creative_url = EXCLUDED.creative_url,
           destination_url = EXCLUDED.destination_url,
           last_synced_at = EXCLUDED.last_synced_at,
           updated_at = EXCLUDED.updated_at`,
        [
          storeId,
          adAccountId,
          ad.adId,
          ad.name || null,
          ad.status || null,
          ad.campaignName,
          ad.adsetName,
          ad.thumbnailUrl,
          ad.creativeUrl,
          ad.destinationUrl,
          now,
        ]
      );
    }

    // Remove ads that no longer exist in the account (stale rows).
    const adIds = ads.map((a) => a.adId);
    let removed = 0;
    if (adIds.length > 0) {
      const placeholders = adIds.map((_, i) => `$${i + 3}`).join(', ');
      const res = await this.db.query(
        `DELETE FROM meta_ads_explorer_cache
         WHERE store_id = $1 AND ad_account_id = $2 AND ad_id NOT IN (${placeholders})`,
        [storeId, adAccountId, ...adIds]
      );
      removed = res.rowCount ?? 0;
    } else {
      const res = await this.db.query(
        `DELETE FROM meta_ads_explorer_cache WHERE store_id = $1 AND ad_account_id = $2`,
        [storeId, adAccountId]
      );
      removed = res.rowCount ?? 0;
    }

    return { cached: ads.length, removed };
  }

  async listAds(storeId: string, adAccountId: string): Promise<MetaAdsExplorerCache[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<MetaAdsExplorerCache>(
      `SELECT * FROM meta_ads_explorer_cache
       WHERE store_id = $1 AND ad_account_id = $2
       ORDER BY campaign_name NULLS LAST, name ASC`,
      [storeId, adAccountId]
    );
    return res.rows;
  }

  async getLastSyncAt(storeId: string, adAccountId: string): Promise<Date | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<{ max: Date | null }>(
      `SELECT MAX(last_synced_at) AS max FROM meta_ads_explorer_cache
       WHERE store_id = $1 AND ad_account_id = $2`,
      [storeId, adAccountId]
    );
    return res.rows[0]?.max ?? null;
  }

  async countAds(storeId: string, adAccountId: string): Promise<number> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM meta_ads_explorer_cache
       WHERE store_id = $1 AND ad_account_id = $2`,
      [storeId, adAccountId]
    );
    return parseInt(res.rows[0]?.count || '0', 10);
  }

  /** Clears a store's entire explorer cache (used on disconnect). */
  async clearStore(storeId: string): Promise<number> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query(
      `DELETE FROM meta_ads_explorer_cache WHERE store_id = $1`,
      [storeId]
    );
    return res.rowCount ?? 0;
  }
}
