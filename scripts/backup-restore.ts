import fs from 'fs';
import path from 'path';
import { getDatabaseClient, IDatabaseClient } from '../src/database/client';
import { logger } from '../src/utils/logger';

export interface DatabaseSnapshot {
  version: string;
  createdAt: string;
  tables: Record<string, any[]>;
}

export const BACKUP_TABLES = [
  'platform_config',
  'merchants',
  'stores',
  'users',
  'store_credentials',
  'widget_settings',
  'assistant_settings',
  'store_policies',
  'email_settings',
  'visitors',
  'marketing_consents',
  'chat_sessions',
  'chat_messages',
  'events',
  'email_campaign_events',
  'suppression_list',
  'ai_usage_ledger',
  'admin_alerts',
  'audit_logs'
];

export async function createBackup(db?: IDatabaseClient, targetPath?: string): Promise<string> {
  const client = db || getDatabaseClient();
  const snapshot: DatabaseSnapshot = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    tables: {}
  };

  for (const table of BACKUP_TABLES) {
    try {
      const res = await client.query(`SELECT * FROM ${table}`);
      snapshot.tables[table] = res.rows;
    } catch (err) {
      // Table might not exist in early migrations or optional tables
      logger.warn(`Skipping table '${table}' during backup: ${(err as any).message}`);
    }
  }

  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const filename = targetPath || path.join(backupDir, `backup_${Date.now()}.json`);
  fs.writeFileSync(filename, JSON.stringify(snapshot, null, 2), 'utf8');
  logger.info(`Database backup successfully written to: ${filename}`);
  return filename;
}

export async function restoreBackup(filePath: string, db?: IDatabaseClient): Promise<number> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const snapshot: DatabaseSnapshot = JSON.parse(raw);
  const client = db || getDatabaseClient();

  let restoredRecordsCount = 0;

  // Restore in dependency order or truncate first
  for (const table of BACKUP_TABLES) {
    const rows = snapshot.tables[table];
    if (!rows || rows.length === 0) continue;

    for (const row of rows) {
      const columns = Object.keys(row);
      const values = Object.values(row);
      if (columns.length === 0) continue;

      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const colNames = columns.join(', ');

      const query = `
        INSERT INTO ${table} (${colNames}) 
        VALUES (${placeholders}) 
        ON CONFLICT DO NOTHING
      `;

      try {
        await client.query(query, values);
        restoredRecordsCount++;
      } catch (err) {
        logger.warn(`Warning inserting into ${table} during restore: ${(err as any).message}`);
      }
    }
  }

  logger.info(`Database restore complete. Restored ${restoredRecordsCount} records from ${filePath}`);
  return restoredRecordsCount;
}

// CLI Execution if executed directly
if (require.main === module) {
  const mode = process.argv[2] || 'backup';
  const filePath = process.argv[3];

  if (mode === 'backup') {
    createBackup(undefined, filePath)
      .then((p) => {
        console.log(`Backup completed: ${p}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('Backup failed:', err);
        process.exit(1);
      });
  } else if (mode === 'restore') {
    if (!filePath) {
      console.error('Usage: ts-node scripts/backup-restore.ts restore <filePath>');
      process.exit(1);
    }
    restoreBackup(filePath)
      .then((count) => {
        console.log(`Restore completed. Records: ${count}`);
        process.exit(0);
      })
      .catch((err) => {
        console.error('Restore failed:', err);
        process.exit(1);
      });
  } else {
    console.log('Usage: ts-node scripts/backup-restore.ts [backup|restore] [filePath]');
  }
}
