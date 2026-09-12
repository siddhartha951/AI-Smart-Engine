import { z } from 'zod';
import { getAiProvider, IAiProvider, BudgetGuard } from '../../providers/ai';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';

export class AiBudgetExceededError extends Error {
  constructor(public storeId: string) {
    super(`Store ${storeId} has exceeded its monthly AI budget limit.`);
    this.name = 'AiBudgetExceededError';
  }
}

export interface OrchestrationOptions {
  modelTier?: 'fast' | 'analysis' | 'smart';
  temperature?: number;
  systemPrompt?: string;
}

export class AiOrchestratorService {
  private aiProvider: IAiProvider;
  private budgetGuard: BudgetGuard;

  constructor(deps?: { aiProvider?: IAiProvider; db?: IDatabaseClient }) {
    const db = deps?.db || getDatabaseClient();
    this.aiProvider = deps?.aiProvider || getAiProvider();
    this.budgetGuard = new BudgetGuard(db);
  }

  /**
   * Generates schema-validated structured JSON output with budget enforcement and token accounting.
   */
  async generateStructuredJson<T>(
    storeId: string,
    prompt: string,
    schema: z.ZodType<T>,
    options?: OrchestrationOptions
  ): Promise<T> {
    // 1. Budget check
    const exceeded = await this.budgetGuard.isBudgetExceeded(storeId);
    if (exceeded) {
      logger.warn(`AI request blocked: Store ${storeId} exceeded monthly AI budget.`);
      throw new AiBudgetExceededError(storeId);
    }

    // 2. Call provider
    try {
      const result = await this.aiProvider.generateStructuredJson<T>(prompt, schema, {
        storeId,
        modelTier: options?.modelTier || 'analysis',
        temperature: options?.temperature,
        systemPrompt: options?.systemPrompt,
      });

      // 3. Record usage in ledger
      await this.budgetGuard.recordUsage(
        storeId,
        null,
        result.model,
        result.input_tokens,
        result.output_tokens,
        result.estimated_cost_usd
      );

      return result.data;
    } catch (err: any) {
      if (err instanceof AiBudgetExceededError) throw err;
      logger.error(`AiOrchestratorService structured call failed for store ${storeId}:`, err);
      throw err;
    }
  }

  /**
   * Generates conversational or textual output with budget enforcement and token accounting.
   */
  async generateText(
    storeId: string,
    prompt: string,
    options?: OrchestrationOptions
  ): Promise<string> {
    // 1. Budget check
    const exceeded = await this.budgetGuard.isBudgetExceeded(storeId);
    if (exceeded) {
      logger.warn(`AI request blocked: Store ${storeId} exceeded monthly AI budget.`);
      throw new AiBudgetExceededError(storeId);
    }

    // 2. Call provider
    try {
      const result = await this.aiProvider.generateText(prompt, {
        storeId,
        modelTier: options?.modelTier || 'fast',
        temperature: options?.temperature,
        systemPrompt: options?.systemPrompt,
      });

      // 3. Record usage
      await this.budgetGuard.recordUsage(
        storeId,
        null,
        result.model,
        result.input_tokens,
        result.output_tokens,
        result.estimated_cost_usd
      );

      return result.text;
    } catch (err: any) {
      if (err instanceof AiBudgetExceededError) throw err;
      logger.error(`AiOrchestratorService text call failed for store ${storeId}:`, err);
      throw err;
    }
  }
}
