import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { EventRecord } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EventRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  /**
   * Resolves a session_id to one that is safe to reference. The storefront
   * widget can send a stale session_id (restored from browser storage after a
   * DB reset/migration, or from a different store); inserting it blindly
   * violates the events_session_id_fkey FK and turns a telemetry write into
   * a 500. Unknown sessions degrade to NULL instead.
   */
  private async resolveSessionId(storeId: string, sessionId?: string | null): Promise<string | null> {
    if (!sessionId || !UUID_RE.test(sessionId)) {
      return null;
    }
    const sessionCheck = await this.db.query(
      `SELECT id FROM chat_sessions WHERE store_id = $1 AND id = $2`,
      [storeId, sessionId]
    );
    if (sessionCheck.rows.length === 0) {
      console.warn(
        `[EventRepository] Dropping stale session_id ${sessionId} for store ${storeId}: session not found, recording event without session`
      );
      return null;
    }
    return sessionId;
  }

  async recordEvent(
    storeId: string,
    visitorId: string,
    type: string,
    payload: Record<string, unknown> = {},
    sessionId?: string | null
  ): Promise<EventRecord> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // Validate visitor belongs to store
    const visitorCheck = await this.db.query(
      `SELECT id FROM visitors WHERE store_id = $1 AND id = $2`,
      [storeId, visitorId]
    );
    if (visitorCheck.rows.length === 0) {
      throw new TenantIsolationError(`Visitor ${visitorId} does not belong to store ${storeId}`);
    }

    const safeSessionId = await this.resolveSessionId(storeId, sessionId);

    const res = await this.db.query<EventRecord>(
      `INSERT INTO events (store_id, visitor_id, session_id, type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [storeId, visitorId, safeSessionId, type, JSON.stringify(payload)]
    );
    return res.rows[0];
  }

  async getVisitorEvents(
    storeId: string,
    visitorId: string,
    type?: string
  ): Promise<EventRecord[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    let sql = `SELECT * FROM events WHERE store_id = $1 AND visitor_id = $2`;
    const params: unknown[] = [storeId, visitorId];

    if (type) {
      sql += ` AND type = $3`;
      params.push(type);
    }
    sql += ` ORDER BY created_at ASC`;

    const res = await this.db.query<EventRecord>(sql, params);
    return res.rows;
  }
}
