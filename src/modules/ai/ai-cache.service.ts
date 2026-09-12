import { IDatabaseClient, getDatabaseClient } from '../../database/client';

export class AiCacheService {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  async get<T>(storeId: string, analysisType: string, dataHash: string): Promise<T | null> {
    try {
      const res = await this.db.query<{ result: T }>(
        `SELECT result 
         FROM ai_cache 
         WHERE store_id = $1 AND analysis_type = $2 AND data_hash = $3 AND expires_at > NOW()
         LIMIT 1`,
        [storeId, analysisType, dataHash]
      );

      if (res.rows.length > 0) {
        return res.rows[0].result;
      }
      return null;
    } catch {
      return null;
    }
  }

  async set<T>(
    storeId: string,
    analysisType: string,
    dataHash: string,
    result: T,
    ttlSeconds: number = 3600
  ): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await this.db.query(
        `INSERT INTO ai_cache (store_id, analysis_type, data_hash, result, expires_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (store_id, analysis_type) DO UPDATE SET
           data_hash = EXCLUDED.data_hash,
           result = EXCLUDED.result,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [storeId, analysisType, dataHash, JSON.stringify(result), expiresAt]
      );
    } catch {
      // Non-blocking cache failure
    }
  }

  async invalidate(storeId: string, analysisType?: string): Promise<void> {
    try {
      if (analysisType) {
        await this.db.query(
          `DELETE FROM ai_cache WHERE store_id = $1 AND analysis_type = $2`,
          [storeId, analysisType]
        );
      } else {
        await this.db.query(`DELETE FROM ai_cache WHERE store_id = $1`, [storeId]);
      }
    } catch {
      // Non-blocking
    }
  }
}
