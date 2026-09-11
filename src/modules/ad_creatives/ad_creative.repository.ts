import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { AdCreative, AdObjective, AdPlatform } from '../../database/types';

export interface CreateAdCreativeInput {
  productId: string;
  productTitle: string;
  platform: AdPlatform;
  objective: AdObjective;
  hook: string;
  primaryText: string;
  headline: string;
  cta: string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}

export class AdCreativeRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  /**
   * Save an ad creative variation with strict store_id scoping.
   */
  async saveCreative(
    storeId: string,
    input: CreateAdCreativeInput
  ): Promise<AdCreative> {
    const res = await this.db.query<AdCreative>(
      `INSERT INTO ad_creatives (
        store_id, product_id, product_title, platform, objective, hook, primary_text, headline, cta, image_url, metadata, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
      ) RETURNING *`,
      [
        storeId,
        input.productId,
        input.productTitle,
        input.platform,
        input.objective,
        input.hook,
        input.primaryText,
        input.headline,
        input.cta,
        input.imageUrl || '',
        JSON.stringify(input.metadata || {}),
      ]
    );

    return res.rows[0];
  }

  /**
   * Retrieve saved ad creatives for a store in reverse chronological order.
   */
  async getSavedCreatives(
    storeId: string,
    limit = 50,
    offset = 0
  ): Promise<{ creatives: AdCreative[]; total: number }> {
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ad_creatives WHERE store_id = $1`,
      [storeId]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listRes = await this.db.query<AdCreative>(
      `SELECT * FROM ad_creatives 
       WHERE store_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [storeId, limit, offset]
    );

    return {
      creatives: listRes.rows,
      total,
    };
  }

  /**
   * Retrieve a single saved creative by ID with strict store_id scoping.
   */
  async getSavedCreativeById(
    storeId: string,
    id: string
  ): Promise<AdCreative | null> {
    const res = await this.db.query<AdCreative>(
      `SELECT * FROM ad_creatives WHERE id = $1 AND store_id = $2`,
      [id, storeId]
    );
    return res.rows[0] || null;
  }

  /**
   * Delete a saved creative by ID with strict store_id scoping.
   */
  async deleteSavedCreative(
    storeId: string,
    id: string
  ): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM ad_creatives WHERE id = $1 AND store_id = $2`,
      [id, storeId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
