import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { MetaAdsConfig } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class MetaAdsRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  async getConfig(storeId: string): Promise<MetaAdsConfig | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<MetaAdsConfig>(
      `SELECT * FROM meta_ads_configs WHERE store_id = $1`,
      [storeId]
    );
    return res.rows[0] || null;
  }

  async upsertConfig(
    storeId: string,
    data: {
      encryptedAccessToken?: string | null;
      adAccountId?: string | null;
      adAccountName?: string | null;
      accountCurrency?: string | null;
      tokenConnectedAt?: Date | null;
      tokenExpiresAt?: Date | null;
      status?: 'disconnected' | 'connected' | 'error';
      lastError?: string | null;
      lastSyncAt?: Date | null;
    }
  ): Promise<MetaAdsConfig> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const existing = await this.getConfig(storeId);

    const encryptedAccessToken = data.encryptedAccessToken !== undefined ? data.encryptedAccessToken : existing?.encrypted_access_token ?? null;
    const adAccountId = data.adAccountId !== undefined ? data.adAccountId : existing?.ad_account_id ?? null;
    const adAccountName = data.adAccountName !== undefined ? data.adAccountName : existing?.ad_account_name ?? null;
    const accountCurrency = data.accountCurrency !== undefined ? data.accountCurrency : existing?.account_currency ?? null;
    const tokenConnectedAt = data.tokenConnectedAt !== undefined ? data.tokenConnectedAt : existing?.token_connected_at ?? null;
    const tokenExpiresAt = data.tokenExpiresAt !== undefined ? data.tokenExpiresAt : existing?.token_expires_at ?? null;
    const status = data.status !== undefined ? data.status : existing?.status ?? 'disconnected';
    const lastError = data.lastError !== undefined ? data.lastError : existing?.last_error ?? null;
    const lastSyncAt = data.lastSyncAt !== undefined ? data.lastSyncAt : existing?.last_sync_at ?? null;

    if (!existing) {
      const res = await this.db.query<MetaAdsConfig>(
        `INSERT INTO meta_ads_configs (
          store_id, encrypted_access_token, ad_account_id, ad_account_name, account_currency,
          token_connected_at, token_expires_at, status, last_error, last_sync_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING *`,
        [
          storeId,
          encryptedAccessToken,
          adAccountId,
          adAccountName,
          accountCurrency,
          tokenConnectedAt,
          tokenExpiresAt,
          status,
          lastError,
          lastSyncAt,
        ]
      );
      return res.rows[0];
    }

    const res = await this.db.query<MetaAdsConfig>(
      `UPDATE meta_ads_configs
       SET encrypted_access_token = $2,
           ad_account_id = $3,
           ad_account_name = $4,
           account_currency = $5,
           token_connected_at = $6,
           token_expires_at = $7,
           status = $8,
           last_error = $9,
           last_sync_at = $10,
           updated_at = NOW()
       WHERE store_id = $1
       RETURNING *`,
      [
        storeId,
        encryptedAccessToken,
        adAccountId,
        adAccountName,
        accountCurrency,
        tokenConnectedAt,
        tokenExpiresAt,
        status,
        lastError,
        lastSyncAt,
      ]
    );

    return res.rows[0];
  }

  async deleteConfig(storeId: string): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query(
      `DELETE FROM meta_ads_configs WHERE store_id = $1`,
      [storeId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
