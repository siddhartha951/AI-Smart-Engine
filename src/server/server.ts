import { createApp } from './app';
import { getEnvConfig } from '../config/env';
import { logger } from '../utils/logger';
import { Migrator } from '../database/migrator';

async function startServer(): Promise<void> {
  try {
    const env = getEnvConfig();

    // Auto-run migrations in production or development if configured
    if (env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('mock') || !process.env.DATABASE_URL || env.NODE_ENV === 'development') {
      logger.info('Running pending database migrations before startup...');
      const migrator = new Migrator();
      await migrator.runMigrations();
    }

    const app = createApp();
    const port = env.PORT;

    app.listen(port, () => {
      logger.info(`AI Smart Engine server listening on port ${port}`, {
        port,
        environment: env.NODE_ENV,
        aiProvider: env.AI_PROVIDER,
        shopifyAdapter: env.SHOPIFY_ADAPTER_MODE,
      });
    });
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}
