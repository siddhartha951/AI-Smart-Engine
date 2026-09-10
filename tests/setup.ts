import { resetEnvConfig } from '../src/config/env';

process.env.NODE_ENV = 'test';
process.env.SHOPIFY_ADAPTER_MODE = 'fake';
process.env.AI_PROVIDER = 'mock';
process.env.EMAIL_PROVIDER_MODE = 'fake';
process.env.DATABASE_URL = 'mock';

resetEnvConfig();
