import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { EventRecord } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class EventRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
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

    const res = await this.db.query<EventRecord>(
      `INSERT INTO events (store_id, visitor_id, session_id, type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [storeId, visitorId, sessionId || null, type, JSON.stringify(payload)]
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
