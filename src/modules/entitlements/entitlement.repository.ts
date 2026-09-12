import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { ALL_FEATURE_KEYS, FEATURE_CATALOG, FeatureKey } from './entitlement.types';
import { AuditRepository } from '../merchant/audit.repository';

export class EntitlementRepository {
  private db: IDatabaseClient;
  private auditRepo: AuditRepository;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
    this.auditRepo = new AuditRepository(this.db);
  }

  /**
   * Returns a map of all feature keys and their enabled status for a given store.
   */
  async getStoreEntitlements(storeId: string): Promise<Record<FeatureKey, boolean>> {
    const res = await this.db.query<{ feature_key: string; enabled: boolean }>(
      `SELECT feature_key, enabled 
       FROM store_feature_entitlements 
       WHERE store_id = $1`,
      [storeId]
    );

    const existingMap: Record<string, boolean> = {};
    for (const row of res.rows) {
      existingMap[row.feature_key] = Boolean(row.enabled);
    }

    // Compose full map ensuring all canonical keys are present
    const result: Record<string, boolean> = {};
    let hasMissing = false;

    for (const key of ALL_FEATURE_KEYS) {
      if (key in existingMap) {
        result[key] = existingMap[key];
      } else {
        result[key] = FEATURE_CATALOG[key].defaultEnabled;
        hasMissing = true;
      }
    }

    // Auto-seed missing rows in background if needed
    if (hasMissing) {
      this.ensureDefaultEntitlements(storeId).catch(() => {});
    }

    return result as Record<FeatureKey, boolean>;
  }

  /**
   * Checks if a single feature is enabled for a given store.
   */
  async isFeatureEnabled(storeId: string, featureKey: FeatureKey): Promise<boolean> {
    const res = await this.db.query<{ enabled: boolean }>(
      `SELECT enabled 
       FROM store_feature_entitlements 
       WHERE store_id = $1 AND feature_key = $2`,
      [storeId, featureKey]
    );

    if (res.rows.length > 0) {
      return Boolean(res.rows[0].enabled);
    }

    // Default if not explicitly registered
    return FEATURE_CATALOG[featureKey]?.defaultEnabled ?? true;
  }

  /**
   * Sets the entitlement status of a feature for a store and audits the change.
   */
  async setFeatureEntitlement(
    storeId: string,
    featureKey: FeatureKey,
    enabled: boolean,
    adminUserId?: string
  ): Promise<void> {
    const previous = await this.db.query<{ enabled: boolean }>(
      `SELECT enabled 
       FROM store_feature_entitlements 
       WHERE store_id = $1 AND feature_key = $2`,
      [storeId, featureKey]
    );

    const prevEnabled = previous.rows[0]?.enabled ?? FEATURE_CATALOG[featureKey]?.defaultEnabled ?? true;

    await this.db.query(
      `INSERT INTO store_feature_entitlements (store_id, feature_key, enabled, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (store_id, feature_key) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         updated_at = NOW()`,
      [storeId, featureKey, enabled]
    );

    // Record in audit_logs
    if (adminUserId) {
      await this.auditRepo.logAction(
        adminUserId,
        storeId,
        'UPDATE_FEATURE_ENTITLEMENT',
        'store_feature_entitlements',
        { feature_key: featureKey, enabled: prevEnabled },
        { feature_key: featureKey, enabled }
      );
    }
  }

  /**
   * Sets multiple feature entitlements in a batch and audits changes.
   */
  async setBulkFeatureEntitlements(
    storeId: string,
    entitlements: Partial<Record<FeatureKey, boolean>>,
    adminUserId?: string
  ): Promise<void> {
    for (const [key, enabled] of Object.entries(entitlements)) {
      if (enabled !== undefined) {
        await this.setFeatureEntitlement(storeId, key as FeatureKey, enabled, adminUserId);
      }
    }
  }

  /**
   * Seeds default feature records for a store if none exist.
   */
  async ensureDefaultEntitlements(storeId: string): Promise<void> {
    for (const key of ALL_FEATURE_KEYS) {
      await this.db.query(
        `INSERT INTO store_feature_entitlements (store_id, feature_key, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (store_id, feature_key) DO NOTHING`,
        [storeId, key, FEATURE_CATALOG[key].defaultEnabled]
      );
    }
  }
}
