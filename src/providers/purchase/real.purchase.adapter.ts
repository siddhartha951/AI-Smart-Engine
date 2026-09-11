import { IPurchaseAdapter } from './purchase.adapter';
import { IDatabaseClient, getDatabaseClient } from '../../database/client';

export class RealPurchaseAdapter implements IPurchaseAdapter {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  /**
   * Checks if a visitor with the given email has made a purchase since the given date.
   * Cross-references the database events table for 'purchase_completed' events.
   */
  async hasPurchasedSince(storeId: string, email: string, since: Date): Promise<boolean> {
    if (!storeId || !email) return false;
    const cleanEmail = email.trim().toLowerCase();

    try {
      const res = await this.db.query(
        `SELECT e.id FROM events e
         JOIN visitors v ON e.visitor_id = v.id
         WHERE e.store_id = $1 
           AND LOWER(v.email) = $2 
           AND e.type = 'purchase_completed'
           AND e.created_at >= $3
         LIMIT 1`,
        [storeId, cleanEmail, since]
      );
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Checks if a visitor with the given visitor_id has made a purchase within windowMs.
   */
  async hasVisitorPurchased(storeId: string, visitorId: string, windowMs = 86400000): Promise<boolean> {
    if (!storeId || !visitorId) return false;
    const sinceDate = new Date(Date.now() - windowMs);

    try {
      const res = await this.db.query(
        `SELECT id FROM events 
         WHERE store_id = $1 
           AND visitor_id = $2 
           AND type = 'purchase_completed'
           AND created_at >= $3
         LIMIT 1`,
        [storeId, visitorId, sinceDate]
      );
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }
}
