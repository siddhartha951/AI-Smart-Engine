import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { decryptString, encryptString } from '../../utils/crypto';

export type HelpdeskProvider = 'built_in' | 'freshdesk';
export type HelpdeskStatus = 'not_connected' | 'connected' | 'error';

/** What the dashboard may see: never the API key itself. */
export interface HelpdeskSettingsView {
  provider: HelpdeskProvider;
  freshdesk_domain: string | null;
  has_api_key: boolean;
  api_key_last4: string | null;
  status: HelpdeskStatus;
  last_error: string | null;
  last_tested_at: string | null;
}

export interface TicketSyncStats {
  synced: number;
  failed: number;
  pending: number;
}

const DEFAULT_VIEW: HelpdeskSettingsView = {
  provider: 'built_in',
  freshdesk_domain: null,
  has_api_key: false,
  api_key_last4: null,
  status: 'not_connected',
  last_error: null,
  last_tested_at: null,
};

export class HelpdeskRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  private async getRow(storeId: string): Promise<any | null> {
    const res = await this.db.query('SELECT * FROM store_helpdesk_settings WHERE store_id = $1', [storeId]);
    return res.rows[0] || null;
  }

  async getSettings(storeId: string): Promise<HelpdeskSettingsView> {
    const row = await this.getRow(storeId);
    if (!row) return { ...DEFAULT_VIEW };
    return {
      provider: row.provider === 'freshdesk' ? 'freshdesk' : 'built_in',
      freshdesk_domain: row.freshdesk_domain || null,
      has_api_key: Boolean(row.encrypted_api_key),
      api_key_last4: row.api_key_last4 || null,
      status: (['connected', 'error'].includes(row.status) ? row.status : 'not_connected') as HelpdeskStatus,
      last_error: row.last_error || null,
      last_tested_at: row.last_tested_at ? new Date(row.last_tested_at).toISOString() : null,
    };
  }

  /** Decrypted credentials for the server-side client only. */
  async getCredentials(storeId: string): Promise<{ domain: string; apiKey: string } | null> {
    const row = await this.getRow(storeId);
    if (!row || !row.freshdesk_domain || !row.encrypted_api_key) return null;
    try {
      return { domain: row.freshdesk_domain, apiKey: decryptString(row.encrypted_api_key) };
    } catch {
      return null; // key encrypted with an old ENCRYPTION_KEY: treat as not configured
    }
  }

  async save(
    storeId: string,
    values: {
      provider: HelpdeskProvider;
      domain?: string | null;
      apiKey?: string | null; // undefined = keep the stored key, null = remove it
      status: HelpdeskStatus;
      lastError?: string | null;
      tested?: boolean;
    },
    userId: string | null
  ): Promise<void> {
    const existing = await this.getRow(storeId);
    const encrypted =
      values.apiKey === undefined ? existing?.encrypted_api_key ?? null
        : values.apiKey === null ? null
          : encryptString(values.apiKey).encryptedString;
    const last4 =
      values.apiKey === undefined ? existing?.api_key_last4 ?? null
        : values.apiKey === null ? null
          : values.apiKey.slice(-4);
    const domain = values.domain === undefined ? existing?.freshdesk_domain ?? null : values.domain;
    const testedAt = values.tested ? new Date().toISOString() : existing?.last_tested_at ?? null;

    await this.db.query(
      `INSERT INTO store_helpdesk_settings (
         store_id, provider, freshdesk_domain, encrypted_api_key, api_key_last4, status, last_error,
         last_tested_at, updated_by, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (store_id) DO UPDATE SET
         provider = EXCLUDED.provider,
         freshdesk_domain = EXCLUDED.freshdesk_domain,
         encrypted_api_key = EXCLUDED.encrypted_api_key,
         api_key_last4 = EXCLUDED.api_key_last4,
         status = EXCLUDED.status,
         last_error = EXCLUDED.last_error,
         last_tested_at = EXCLUDED.last_tested_at,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [storeId, values.provider, domain, encrypted, last4, values.status, values.lastError ?? null, testedAt, userId]
    );
  }

  async setStatus(storeId: string, status: HelpdeskStatus, lastError: string | null): Promise<void> {
    await this.db.query(
      `UPDATE store_helpdesk_settings SET status = $2, last_error = $3, last_tested_at = NOW(), updated_at = NOW()
       WHERE store_id = $1`,
      [storeId, status, lastError]
    );
  }

  async markTicketPending(storeId: string, ticketId: string): Promise<void> {
    await this.db.query(
      `UPDATE support_tickets SET external_provider = 'freshdesk', external_sync_status = 'pending',
         external_sync_attempts = external_sync_attempts + 1, updated_at = NOW()
       WHERE id = $1 AND store_id = $2`,
      [ticketId, storeId]
    );
  }

  async markTicketSynced(storeId: string, ticketId: string, externalId: string, url: string): Promise<void> {
    await this.db.query(
      `UPDATE support_tickets SET external_provider = 'freshdesk', external_sync_status = 'synced',
         external_ticket_id = $3, external_url = $4, external_sync_error = NULL, external_synced_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND store_id = $2`,
      [ticketId, storeId, externalId, url]
    );
  }

  async markTicketFailed(storeId: string, ticketId: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE support_tickets SET external_provider = 'freshdesk', external_sync_status = 'failed',
         external_sync_error = $3, updated_at = NOW()
       WHERE id = $1 AND store_id = $2`,
      [ticketId, storeId, error.slice(0, 500)]
    );
  }

  /** Tickets that never reached Freshdesk (oldest first), for a retry. */
  async listUnsyncedTicketIds(storeId: string, limit = 20): Promise<string[]> {
    const res = await this.db.query<{ id: string }>(
      `SELECT id FROM support_tickets
       WHERE store_id = $1 AND external_provider = 'freshdesk' AND external_sync_status IN ('failed', 'pending')
       ORDER BY created_at ASC
       LIMIT $2`,
      [storeId, limit]
    );
    return res.rows.map((r) => r.id);
  }

  async syncStats(storeId: string): Promise<TicketSyncStats> {
    const res = await this.db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN external_sync_status = 'synced' THEN 1 ELSE 0 END), 0) AS synced,
         COALESCE(SUM(CASE WHEN external_sync_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
         COALESCE(SUM(CASE WHEN external_sync_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending
       FROM support_tickets WHERE store_id = $1 AND external_provider = 'freshdesk'`,
      [storeId]
    );
    const row = res.rows[0] || {};
    return { synced: Number(row.synced || 0), failed: Number(row.failed || 0), pending: Number(row.pending || 0) };
  }
}
