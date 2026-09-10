import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { AiUsageLedger } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class AiUsageRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  getCurrentBillingPeriod(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async recordUsage(
    storeId: string,
    sessionId: string | null,
    model: string,
    inputTokens: number,
    outputTokens: number,
    estimatedCostUsd: number
  ): Promise<AiUsageLedger> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const billingPeriod = this.getCurrentBillingPeriod();
    const res = await this.db.query<AiUsageLedger>(
      `INSERT INTO ai_usage_ledger (store_id, session_id, model, input_tokens, output_tokens, estimated_cost_usd, billing_period, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [storeId, sessionId, model, inputTokens, outputTokens, estimatedCostUsd, billingPeriod]
    );
    return res.rows[0];
  }

  async getTotalMonthlySpend(billingPeriod?: string): Promise<number> {
    const period = billingPeriod || this.getCurrentBillingPeriod();
    const res = await this.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM ai_usage_ledger
       WHERE billing_period = $1`,
      [period]
    );
    return parseFloat(res.rows[0]?.total || '0');
  }

  async getStoreMonthlySpend(storeId: string, billingPeriod?: string): Promise<number> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const period = billingPeriod || this.getCurrentBillingPeriod();
    const res = await this.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
       FROM ai_usage_ledger
       WHERE store_id = $1 AND billing_period = $2`,
      [storeId, period]
    );
    return parseFloat(res.rows[0]?.total || '0');
  }
}
