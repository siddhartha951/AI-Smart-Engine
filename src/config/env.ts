import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  BASE_URL: z.preprocess((val) => {
    if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
      return val;
    }
    return 'http://localhost:3000';
  }, z.string().url()),

  DATABASE_URL: z.string().default('postgresql://user:password@localhost:5432/ai_smart_engine'),

  AI_PROVIDER: z.preprocess((val) => typeof val === 'string' ? val.toLowerCase() : val, z.enum(['mock', 'openai'])).default('mock'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  AI_MONTHLY_BUDGET_WARN_USD: z.coerce.number().default(10.0),
  AI_MONTHLY_BUDGET_STOP_USD: z.coerce.number().default(14.0),

  SHOPIFY_ADAPTER_MODE: z.enum(['fake', 'real']).default('fake'),
  SHOPIFY_API_VERSION: z.string().default('2024-01'),
  SHOPIFY_CLIENT_SECRET: z.string().default('test_shopify_secret_change_in_production'),

  EMAIL_PROVIDER_MODE: z.enum(['fake', 'resend', 'postmark']).default('fake'),
  EMAIL_API_KEY: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM_ADDRESS: z.string().default('notifications@ai-smart-engine.com'),
  EMAIL_FROM_NAME: z.string().default('Shopify Shopping Assistant'),

  SESSION_SECRET: z.string().default('dev-session-secret-change-in-production-min-32-chars-ok'),
  UNSUBSCRIBE_SIGNING_SECRET: z.string().default('dev-unsub-secret-change-in-production-min-32-chars-ok'),
  ENCRYPTION_KEY: z.string().default('dev-encryption-key-must-be-32-bytes-long-ok!!'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedEnv: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!cachedEnv) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Environment validation error: ${issues}`);
    }
    cachedEnv = result.data;
  }
  return cachedEnv;
}

export function resetEnvConfig(): void {
  cachedEnv = null;
}
