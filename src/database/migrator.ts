import fs from 'fs';
import path from 'path';
import { IDatabaseClient, getDatabaseClient } from './client';
import { logger } from '../utils/logger';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export class Migrator {
  private db: IDatabaseClient;
  private migrationsDir: string;

  constructor(db?: IDatabaseClient, migrationsDir?: string) {
    this.db = db || getDatabaseClient();
    const defaultDir = path.resolve(process.cwd(), 'migrations');
    const fallbackDir = path.resolve(__dirname, '../../migrations');
    this.migrationsDir = migrationsDir || (fs.existsSync(defaultDir) ? defaultDir : fallbackDir);
  }

  private async ensureMigrationTable(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  public async getAppliedMigrations(): Promise<string[]> {
    await this.ensureMigrationTable();
    const res = await this.db.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version ASC');
    return res.rows.map((r) => r.version);
  }

  public async runMigrations(): Promise<MigrationResult> {
    await this.ensureMigrationTable();
    const applied = await this.getAppliedMigrations();
    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const result: MigrationResult = {
      applied: [],
      skipped: [],
    };

    for (const file of files) {
      if (applied.includes(file)) {
        result.skipped.push(file);
        continue;
      }

      const filePath = path.join(this.migrationsDir, file);
      let sqlContent = fs.readFileSync(filePath, 'utf-8');
      // Strip UTF-8 BOM if present
      if (sqlContent.charCodeAt(0) === 0xFEFF) {
        sqlContent = sqlContent.slice(1);
      }
      sqlContent = sqlContent.trim();

      logger.info(`Applying migration: ${file}`);
      // Split or run the whole SQL script
      await this.db.query(sqlContent);
      await this.db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);

      result.applied.push(file);
      logger.info(`Successfully applied migration: ${file}`);
    }

    return result;
  }
}

// CLI execution if executed directly
if (require.main === module) {
  const migrator = new Migrator();
  migrator
    .runMigrations()
    .then((res) => {
      console.log('Migrations complete:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
