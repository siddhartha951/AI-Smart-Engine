import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    env: {
      NODE_ENV: 'test',
      AI_PROVIDER: 'mock',
      SHOPIFY_ADAPTER_MODE: 'fake',
      EMAIL_PROVIDER_MODE: 'fake',
      DATABASE_URL: 'mock',
      VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true'
    },
    setupFiles: ['tests/setup.ts']
  },
});
