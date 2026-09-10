import { IAiProvider } from './ai.provider';
import { MockAiProvider } from './mock.ai.provider';
import { OpenAiProvider } from './openai.provider';
import { getEnvConfig } from '../../config/env';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';

export * from './ai.provider';

export function getAiProvider(): IAiProvider {
  const env = getEnvConfig();
  if (env.AI_PROVIDER === 'openai') {
    return new OpenAiProvider();
  }
  return new MockAiProvider();
}

export class BudgetGuard {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  /**
   * Returns true if the store has exceeded its monthly AI budget limit.
   */
  async isBudgetExceeded(storeId: string): Promise<boolean> {
    const env = getEnvConfig();
    const period = new Date().toISOString().substring(0, 7); // e.g., "2024-01"

    const res = await this.db.query<{ total_cost: number }>(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total_cost 
       FROM ai_usage_ledger 
       WHERE store_id = $1 AND billing_period = $2`,
      [storeId, period]
    );

    const totalCost = Number(res.rows[0]?.total_cost || 0);
    return totalCost >= env.AI_MONTHLY_BUDGET_STOP_USD;
  }

  /**
   * Records usage after an AI request is made.
   */
  async recordUsage(
    storeId: string,
    sessionId: string | null,
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number
  ): Promise<void> {
    const period = new Date().toISOString().substring(0, 7);
    await this.db.query(
      `INSERT INTO ai_usage_ledger (store_id, session_id, model, input_tokens, output_tokens, estimated_cost_usd, billing_period)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [storeId, sessionId, model, inputTokens, outputTokens, costUsd, period]
    );
  }
}
