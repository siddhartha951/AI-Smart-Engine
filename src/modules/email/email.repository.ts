import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { EmailCampaignEvent, SuppressionEntry, EmailWebhookEvent } from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class EmailRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  async scheduleRecoveryJob(
    storeId: string,
    visitorId: string,
    sessionId: string,
    stage: number,
    scheduledFor: Date,
    campaignType = 'abandoned_chat_recovery'
  ): Promise<EmailCampaignEvent> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<EmailCampaignEvent>(
      `INSERT INTO email_campaign_events (store_id, visitor_id, session_id, campaign_type, stage, scheduled_for, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       ON CONFLICT (store_id, session_id, stage) DO NOTHING
       RETURNING *`,
      [storeId, visitorId, sessionId, campaignType, stage, scheduledFor]
    );
    return res.rows[0];
  }

  async getPendingJobs(storeId?: string, limit = 50): Promise<EmailCampaignEvent[]> {
    let selectSql = `SELECT id FROM email_campaign_events WHERE status = 'pending' AND scheduled_for <= NOW()`;
    const params: unknown[] = [];

    if (storeId) {
      params.push(storeId);
      selectSql += ` AND store_id = $${params.length}`;
    }
    selectSql += ` ORDER BY scheduled_for ASC`;
    params.push(limit);
    selectSql += ` LIMIT $${params.length} FOR UPDATE SKIP LOCKED`;

    const res = await this.db.query<EmailCampaignEvent>(
      `UPDATE email_campaign_events 
       SET status = 'processing', updated_at = NOW() 
       WHERE id IN (${selectSql}) 
       RETURNING *`, 
      params
    );
    return res.rows;
  }

  async isIdempotencyKeyDispatched(storeId: string, idempotencyKey: string): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<EmailCampaignEvent>(
      `SELECT id FROM email_campaign_events 
       WHERE store_id = $1 AND idempotency_key = $2 AND (status = 'sent' OR sent_at IS NOT NULL OR provider_message_id IS NOT NULL)`,
      [storeId, idempotencyKey]
    );
    return res.rows.length > 0;
  }

  async updateJobStatus(
    id: string,
    status: 'sent' | 'cancelled' | 'failed',
    details?: {
      cancelReason?: string;
      errorMsg?: string;
      providerMessageId?: string;
      idempotencyKey?: string;
    }
  ): Promise<void> {
    if (status === 'sent') {
      await this.db.query(
        `UPDATE email_campaign_events 
         SET status = $1, 
             sent_at = NOW(), 
             provider_message_id = COALESCE($3, provider_message_id),
             idempotency_key = COALESCE($4, idempotency_key),
             updated_at = NOW() 
         WHERE id = $2`,
        [status, id, details?.providerMessageId || null, details?.idempotencyKey || null]
      );
    } else if (status === 'cancelled') {
      await this.db.query(
        `UPDATE email_campaign_events 
         SET status = $1, 
             cancel_reason = $2, 
             updated_at = NOW() 
         WHERE id = $3`,
        [status, details?.cancelReason || 'Unknown', id]
      );
    } else if (status === 'failed') {
      await this.db.query(
        `UPDATE email_campaign_events 
         SET status = $1, 
             last_error = $2, 
             retry_count = retry_count + 1, 
             updated_at = NOW() 
         WHERE id = $3`,
        [status, details?.errorMsg || 'Unknown Error', id]
      );
    }
  }

  async cancelVisitorJobs(
    storeId: string,
    visitorId: string,
    cancelReason: string
  ): Promise<number> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query(
      `UPDATE email_campaign_events
       SET status = 'cancelled',
           cancel_reason = $3,
           updated_at = NOW()
       WHERE store_id = $1 AND visitor_id = $2 AND status = 'pending'`,
      [storeId, visitorId, cancelReason]
    );
    return res.rowCount || 0;
  }

  async cancelVisitorJobsByEmail(
    storeId: string,
    email: string,
    cancelReason: string
  ): Promise<number> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const cleanEmail = email.toLowerCase().trim();
    const res = await this.db.query(
      `UPDATE email_campaign_events
       SET status = 'cancelled',
           cancel_reason = $3,
           updated_at = NOW()
       WHERE store_id = $1 
         AND status = 'pending'
         AND visitor_id IN (
           SELECT id FROM visitors WHERE store_id = $1 AND LOWER(email) = $2
         )`,
      [storeId, cleanEmail, cancelReason]
    );
    return res.rowCount || 0;
  }

  async addSuppression(
    storeId: string,
    email: string,
    reason: string
  ): Promise<SuppressionEntry> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const cleanEmail = email.toLowerCase().trim();
    const res = await this.db.query<SuppressionEntry>(
      `INSERT INTO suppression_list (store_id, email, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (store_id, email) DO UPDATE SET reason = EXCLUDED.reason
       RETURNING *`,
      [storeId, cleanEmail, reason]
    );
    return res.rows[0];
  }

  async isSuppressed(storeId: string, email: string): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const cleanEmail = email.toLowerCase().trim();
    const res = await this.db.query(
      `SELECT id FROM suppression_list WHERE store_id = $1 AND email = $2`,
      [storeId, cleanEmail]
    );
    return res.rows.length > 0;
  }

  async recordWebhookEvent(
    storeId: string,
    eventType: string,
    recipient: string,
    payload: any,
    providerMessageId?: string
  ): Promise<EmailWebhookEvent> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<EmailWebhookEvent>(
      `INSERT INTO email_webhook_events (store_id, event_type, recipient, provider_message_id, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [storeId, eventType, recipient.toLowerCase().trim(), providerMessageId || null, JSON.stringify(payload)]
    );
    return res.rows[0];
  }

  async getWebhookEvents(storeId: string, limit = 50): Promise<EmailWebhookEvent[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<EmailWebhookEvent>(
      `SELECT * FROM email_webhook_events WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [storeId, limit]
    );
    return res.rows;
  }
}
