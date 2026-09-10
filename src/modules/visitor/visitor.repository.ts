import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { Visitor, MarketingConsent } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class VisitorRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  async getOrCreateVisitor(storeId: string, anonymousId: string): Promise<Visitor> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    if (!anonymousId) throw new Error('anonymous_id is required');

    // First attempt to find existing visitor
    const existing = await this.db.query<Visitor>(
      `SELECT * FROM visitors WHERE store_id = $1 AND anonymous_id = $2`,
      [storeId, anonymousId]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    // Insert new visitor scoped to store_id
    const inserted = await this.db.query<Visitor>(
      `INSERT INTO visitors (store_id, anonymous_id)
       VALUES ($1, $2)
       RETURNING *`,
      [storeId, anonymousId]
    );
    return inserted.rows[0];
  }

  async updateVisitorLead(
    storeId: string,
    visitorId: string,
    email: string,
    phone?: string
  ): Promise<Visitor> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<Visitor>(
      `UPDATE visitors
       SET email = $3,
           phone = COALESCE($4, phone),
           updated_at = NOW()
       WHERE store_id = $1 AND id = $2
       RETURNING *`,
      [storeId, visitorId, email.toLowerCase().trim(), phone || null]
    );

    if (res.rows.length === 0) {
      throw new TenantIsolationError(`Visitor not found in store ${storeId}`);
    }
    return res.rows[0];
  }

  async getVisitorById(storeId: string, visitorId: string): Promise<Visitor | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<Visitor>(
      `SELECT * FROM visitors WHERE store_id = $1 AND id = $2`,
      [storeId, visitorId]
    );
    return res.rows[0] || null;
  }

  async recordMarketingConsent(
    storeId: string,
    visitorId: string,
    optedIn: boolean,
    wording: string,
    version = '1.0',
    source = 'widget_chat_v1'
  ): Promise<MarketingConsent> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // Verify visitor belongs to store_id before recording consent
    const visitor = await this.getVisitorById(storeId, visitorId);
    if (!visitor) {
      throw new TenantIsolationError(`Cannot record consent: visitor ${visitorId} does not belong to store ${storeId}`);
    }

    const res = await this.db.query<MarketingConsent>(
      `INSERT INTO marketing_consents (store_id, visitor_id, opted_in, wording, version, source, captured_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [storeId, visitorId, optedIn, wording, version, source]
    );
    return res.rows[0];
  }

  async getLatestMarketingConsent(
    storeId: string,
    visitorId: string
  ): Promise<MarketingConsent | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<MarketingConsent>(
      `SELECT * FROM marketing_consents
       WHERE store_id = $1 AND visitor_id = $2
       ORDER BY captured_at DESC
       LIMIT 1`,
      [storeId, visitorId]
    );
    return res.rows[0] || null;
  }
}
