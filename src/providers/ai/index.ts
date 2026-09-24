import { IAiProvider } from './ai.provider';
import { MockAiProvider } from './mock.ai.provider';
import { OpenAiProvider } from './openai.provider';
import { GeminiAiProvider } from './gemini.provider';
import { getEnvConfig } from '../../config/env';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { safeEffectiveLimits } from '../../modules/plans/plan.repository';

export * from './ai.provider';
export { GeminiAiProvider } from './gemini.provider';
export { OpenAiProvider } from './openai.provider';
export { MockAiProvider } from './mock.ai.provider';

export function getAiProvider(): IAiProvider {
  const env = getEnvConfig();
  const providerSetting = (env.AI_PROVIDER || 'auto').toLowerCase().trim();

  if (providerSetting === 'openai') {
    return new OpenAiProvider();
  }
  if (providerSetting === 'gemini') {
    return new GeminiAiProvider();
  }
  if (providerSetting === 'mock') {
    return new MockAiProvider();
  }

  // 'auto' mode: prioritize OpenAI first if OPENAI_API_KEY is configured and not mock
  if (env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'mock') {
    return new OpenAiProvider();
  }
  // Then Gemini if GEMINI_API_KEY or GOOGLE_AI_API_KEY is configured
  if (env.GEMINI_API_KEY || (process.env.GOOGLE_AI_API_KEY && process.env.GOOGLE_AI_API_KEY !== 'mock')) {
    return new GeminiAiProvider();
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
    // A store on a plan uses the plan's (or its custom) AI budget; others keep the platform default
    const { ai_budget_usd } = await safeEffectiveLimits(this.db, storeId);
    return totalCost >= (ai_budget_usd ?? env.AI_MONTHLY_BUDGET_STOP_USD);
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
