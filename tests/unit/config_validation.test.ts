import { describe, it, expect, beforeEach } from 'vitest';
import { getEnvConfig, resetEnvConfig } from '../../src/config/env';
import { logger } from '../../src/utils/logger';

describe('Configuration & Logger Validation', () => {
  beforeEach(() => {
    resetEnvConfig();
  });

  it('validates environment with defaults successfully', () => {
    const config = getEnvConfig();
    expect(config.NODE_ENV).toBeDefined();
    expect(config.PORT).toBeGreaterThan(0);
    expect(config.AI_MONTHLY_BUDGET_WARN_USD).toBe(10.0);
    expect(config.AI_MONTHLY_BUDGET_STOP_USD).toBe(14.0);
    expect(config.AI_PROVIDER).toBe('mock');
    expect(config.SHOPIFY_ADAPTER_MODE).toBe('fake');
  });

  it('redacts sensitive keys in structured logger context', () => {
    const logs: string[] = [];
    const origInfo = console.info;
    console.info = (msg: string) => {
      logs.push(msg);
    };

    try {
      logger.info('Test context logging', {
        storeId: 'store-123',
        admin_token: 'secret-shopify-admin-token-12345',
        api_key: 'sk-secret-openai-api-key',
        password: 'super-secret-password',
      });

      expect(logs.length).toBe(1);
      const parsed = JSON.parse(logs[0]);
      expect(parsed.context.storeId).toBe('store-123');
      expect(parsed.context.admin_token).toBe('[REDACTED]');
      expect(parsed.context.api_key).toBe('[REDACTED]');
      expect(parsed.context.password).toBe('[REDACTED]');
      expect(logs[0]).not.toContain('secret-shopify-admin-token');
      expect(logs[0]).not.toContain('sk-secret-openai-api-key');
    } finally {
      console.info = origInfo;
    }
  });
});
