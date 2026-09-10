import { Pool, PoolConfig, QueryResultRow } from 'pg';
import { newDb, IMemoryDb, DataType } from 'pg-mem';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface IDatabaseClient {
  query<T extends QueryResultRow = any>(sqlText: string, params?: any[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

export class PostgresClient implements IDatabaseClient {
  private pool: Pool;

  constructor(connectionStringOrConfig?: string | PoolConfig) {
    if (typeof connectionStringOrConfig === 'string') {
      const isLocalOrInternal =
        connectionStringOrConfig.includes('localhost') ||
        connectionStringOrConfig.includes('railway.internal') ||
        connectionStringOrConfig.includes('127.0.0.1');

      this.pool = new Pool({
        connectionString: connectionStringOrConfig,
        ssl: isLocalOrInternal ? undefined : { rejectUnauthorized: false },
      });
    } else {
      this.pool = new Pool(connectionStringOrConfig);
    }
  }

  async query<T extends QueryResultRow = any>(sqlText: string, params?: any[]): Promise<QueryResult<T>> {
    const rawResult: any = await this.pool.query<T>(sqlText, params);
    if (Array.isArray(rawResult)) {
      const last = rawResult[rawResult.length - 1];
      const rows = (last?.rows || []) as T[];
      return {
        rows,
        rowCount: last?.rowCount ?? rows.length,
      };
    }
    const rows = (rawResult?.rows || []) as T[];
    return {
      rows,
      rowCount: rawResult?.rowCount ?? rows.length,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.query('SELECT 1 as alive');
      return (res.rows?.length || 0) > 0;
    } catch (err) {
      logger.error('Database health check failed', err);
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class InMemoryPostgresClient implements IDatabaseClient {
  private memDb: IMemoryDb;
  private adapter: any;

  constructor() {
    this.memDb = newDb({
      noAstCoverageCheck: true,
    });

    this.memDb.registerExtension('uuid-ossp', () => {});
    this.memDb.registerExtension('pgcrypto', () => {});

    // Register gen_random_uuid
    this.memDb.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.text,
      implementation: () => crypto.randomUUID(),
      impure: true, // Prevents pg-mem from caching the result per statement/transaction
    });

    // Register trim function
    this.memDb.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (x: string) => (x ? x.trim() : x),
    });

    // Register now function if needed
    this.memDb.public.registerFunction({
      name: 'now',
      returns: DataType.timestamp,
      implementation: () => new Date(),
    });

    const { Pool: MemPool } = this.memDb.adapters.createPg();
    this.adapter = new MemPool();
  }

  async query<T extends QueryResultRow = any>(sqlText: string, params?: any[]): Promise<QueryResult<T>> {
    const rawResult: any = await this.adapter.query(sqlText, params);
    if (Array.isArray(rawResult)) {
      const last = rawResult[rawResult.length - 1];
      const rows = (last?.rows || []) as T[];
      return {
        rows,
        rowCount: last?.rowCount ?? rows.length,
      };
    }
    const rows = (rawResult?.rows || []) as T[];
    return {
      rows,
      rowCount: rawResult?.rowCount ?? rows.length,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.query('SELECT 1 as alive');
      return (res.rows?.length || 0) > 0;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.adapter.end();
  }
}

let defaultClient: IDatabaseClient | null = null;

export function getDatabaseClient(): IDatabaseClient {
  if (!defaultClient) {
    if (process.env.NODE_ENV === 'test' || process.env.DATABASE_URL?.includes('mock') || !process.env.DATABASE_URL) {
      defaultClient = new InMemoryPostgresClient();
    } else {
      defaultClient = new PostgresClient(process.env.DATABASE_URL);
    }
  }
  return defaultClient;
}

export function setDatabaseClient(client: IDatabaseClient): void {
  defaultClient = client;
}
