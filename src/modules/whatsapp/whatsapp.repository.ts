import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import {
  WhatsAppConfig,
  WhatsAppConsent,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppRecoveryJob,
} from '../../database/types';
import { TenantIsolationError } from '../../utils/errors';

export class WhatsAppRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  // ==========================================
  // 1. WhatsApp Merchant Configuration
  // ==========================================

  async getConfig(storeId: string): Promise<WhatsAppConfig | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<WhatsAppConfig>(
      `SELECT * FROM whatsapp_configs WHERE store_id = $1`,
      [storeId]
    );
    return res.rows[0] || null;
  }

  async findConfigByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppConfig | null> {
    if (!phoneNumberId) return null;

    const res = await this.db.query<WhatsAppConfig>(
      `SELECT * FROM whatsapp_configs WHERE phone_number_id = $1 LIMIT 1`,
      [phoneNumberId]
    );
    return res.rows[0] || null;
  }

  async upsertConfig(
    storeId: string,
    data: {
      phoneNumberId?: string | null;
      wabaId?: string | null;
      encryptedAccessToken?: string | null;
      webhookVerifyToken?: string | null;
      appSecret?: string | null;
      displayPhoneNumber?: string | null;
      status?: 'disconnected' | 'connected' | 'error';
      qualityRating?: string | null;
    }
  ): Promise<WhatsAppConfig> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const existing = await this.getConfig(storeId);
    if (!existing) {
      const res = await this.db.query<WhatsAppConfig>(
        `INSERT INTO whatsapp_configs (
          store_id, phone_number_id, waba_id, encrypted_access_token,
          webhook_verify_token, app_secret, display_phone_number, status, quality_rating,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING *`,
        [
          storeId,
          data.phoneNumberId || null,
          data.wabaId || null,
          data.encryptedAccessToken || null,
          data.webhookVerifyToken || null,
          data.appSecret || null,
          data.displayPhoneNumber || null,
          data.status || 'disconnected',
          data.qualityRating || 'UNKNOWN',
        ]
      );
      return res.rows[0];
    }

    const res = await this.db.query<WhatsAppConfig>(
      `UPDATE whatsapp_configs
       SET phone_number_id = COALESCE($2, phone_number_id),
           waba_id = COALESCE($3, waba_id),
           encrypted_access_token = COALESCE($4, encrypted_access_token),
           webhook_verify_token = COALESCE($5, webhook_verify_token),
           app_secret = COALESCE($6, app_secret),
           display_phone_number = COALESCE($7, display_phone_number),
           status = COALESCE($8, status),
           quality_rating = COALESCE($9, quality_rating),
           updated_at = NOW()
       WHERE store_id = $1
       RETURNING *`,
      [
        storeId,
        data.phoneNumberId !== undefined ? data.phoneNumberId : existing.phone_number_id,
        data.wabaId !== undefined ? data.wabaId : existing.waba_id,
        data.encryptedAccessToken !== undefined ? data.encryptedAccessToken : existing.encrypted_access_token,
        data.webhookVerifyToken !== undefined ? data.webhookVerifyToken : existing.webhook_verify_token,
        data.appSecret !== undefined ? data.appSecret : existing.app_secret,
        data.displayPhoneNumber !== undefined ? data.displayPhoneNumber : existing.display_phone_number,
        data.status !== undefined ? data.status : existing.status,
        data.qualityRating !== undefined ? data.qualityRating : existing.quality_rating,
      ]
    );

    return res.rows[0];
  }

  // ==========================================
  // 2. Customer WhatsApp Opt-In / Consent
  // ==========================================

  async recordConsent(
    storeId: string,
    params: {
      phoneNumber: string;
      optedIn: boolean;
      wording: string;
      source?: string;
      visitorId?: string | null;
    }
  ): Promise<WhatsAppConsent> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const cleanPhone = params.phoneNumber.trim();

    const res = await this.db.query<WhatsAppConsent>(
      `INSERT INTO whatsapp_consents (
        store_id, phone_number, visitor_id, opted_in, wording, source, captured_at, revoked_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, NOW())
      RETURNING *`,
      [
        storeId,
        cleanPhone,
        params.visitorId || null,
        params.optedIn,
        params.wording,
        params.source || 'storefront',
        params.optedIn ? null : new Date(),
      ]
    );

    return res.rows[0];
  }

  async getLatestConsent(storeId: string, phoneNumber: string): Promise<WhatsAppConsent | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const cleanPhone = phoneNumber.trim();

    const res = await this.db.query<WhatsAppConsent>(
      `SELECT * FROM whatsapp_consents
       WHERE store_id = $1 AND phone_number = $2
       ORDER BY captured_at DESC
       LIMIT 1`,
      [storeId, cleanPhone]
    );

    return res.rows[0] || null;
  }

  async revokeConsent(storeId: string, phoneNumber: string, reason = 'customer_opt_out'): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const cleanPhone = phoneNumber.trim();

    await this.recordConsent(storeId, {
      phoneNumber: cleanPhone,
      optedIn: false,
      wording: `Revoked: ${reason}`,
      source: 'opt_out',
    });

    return true;
  }

  async revokeConsentById(storeId: string, consentId: string): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const res = await this.db.query(
      `UPDATE whatsapp_consents
       SET opted_in = false,
           revoked_at = NOW()
       WHERE store_id = $1 AND id = $2`,
      [storeId, consentId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getConsents(
    storeId: string,
    limit = 50,
    offset = 0
  ): Promise<{ consents: WhatsAppConsent[]; total: number }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT phone_number) as count FROM whatsapp_consents WHERE store_id = $1`,
      [storeId]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listRes = await this.db.query<WhatsAppConsent>(
      `SELECT DISTINCT ON (phone_number) *
       FROM whatsapp_consents
       WHERE store_id = $1
       ORDER BY phone_number, captured_at DESC
       LIMIT $2 OFFSET $3`,
      [storeId, limit, offset]
    );

    return {
      consents: listRes.rows,
      total,
    };
  }

  // ==========================================
  // 3. WhatsApp Conversations & Messages
  // ==========================================

  async getOrCreateConversation(
    storeId: string,
    phoneNumber: string,
    visitorId?: string | null,
    customerName?: string | null
  ): Promise<WhatsAppConversation> {
    if (!storeId) throw new TenantIsolationError('store_id is required');
    const cleanPhone = phoneNumber.trim();

    const existing = await this.db.query<WhatsAppConversation>(
      `SELECT * FROM whatsapp_conversations WHERE store_id = $1 AND phone_number = $2`,
      [storeId, cleanPhone]
    );

    if (existing.rows.length > 0) {
      if (customerName && customerName !== 'Customer' && existing.rows[0].customer_name !== customerName) {
        const updated = await this.db.query<WhatsAppConversation>(
          `UPDATE whatsapp_conversations SET customer_name = $3, updated_at = NOW() WHERE store_id = $1 AND id = $2 RETURNING *`,
          [storeId, existing.rows[0].id, customerName]
        );
        return updated.rows[0];
      }
      return existing.rows[0];
    }

    const inserted = await this.db.query<WhatsAppConversation>(
      `INSERT INTO whatsapp_conversations (
        store_id, phone_number, customer_name, visitor_id, status, last_message_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), NOW())
      RETURNING *`,
      [storeId, cleanPhone, customerName || 'Customer', visitorId || null]
    );

    return inserted.rows[0];
  }

  async getConversations(
    storeId: string,
    limit = 50,
    offset = 0
  ): Promise<{ conversations: WhatsAppConversation[]; total: number }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM whatsapp_conversations WHERE store_id = $1`,
      [storeId]
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listRes = await this.db.query<WhatsAppConversation>(
      `SELECT * FROM whatsapp_conversations
       WHERE store_id = $1
       ORDER BY last_message_at DESC
       LIMIT $2 OFFSET $3`,
      [storeId, limit, offset]
    );

    return {
      conversations: listRes.rows,
      total,
    };
  }

  async getConversationById(storeId: string, id: string): Promise<WhatsAppConversation | null> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<WhatsAppConversation>(
      `SELECT * FROM whatsapp_conversations WHERE store_id = $1 AND id = $2`,
      [storeId, id]
    );
    return res.rows[0] || null;
  }

  async addMessage(
    storeId: string,
    params: {
      conversationId: string;
      direction: 'inbound' | 'outbound';
      content: string;
      messageType?: 'text' | 'template' | 'interactive';
      wamid?: string | null;
      status?: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
      aiGenerated?: boolean;
      tokensUsed?: number;
      costUsd?: number;
      errorMessage?: string | null;
    }
  ): Promise<WhatsAppMessage> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    // Verify conversation belongs to store
    const conv = await this.getConversationById(storeId, params.conversationId);
    if (!conv) {
      throw new TenantIsolationError(`Conversation ${params.conversationId} does not belong to store ${storeId}`);
    }

    const res = await this.db.query<WhatsAppMessage>(
      `INSERT INTO whatsapp_messages (
        store_id, conversation_id, direction, message_type, content, wamid, status,
        ai_generated, tokens_used, cost_usd, error_message, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *`,
      [
        storeId,
        params.conversationId,
        params.direction,
        params.messageType || 'text',
        params.content,
        params.wamid || null,
        params.status || (params.direction === 'inbound' ? 'received' : 'sent'),
        Boolean(params.aiGenerated),
        params.tokensUsed || 0,
        params.costUsd || 0,
        params.errorMessage || null,
      ]
    );

    // Touch last_message_at on conversation
    await this.db.query(
      `UPDATE whatsapp_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE store_id = $1 AND id = $2`,
      [storeId, params.conversationId]
    );

    return res.rows[0];
  }

  async getMessages(storeId: string, conversationId: string, limit = 100): Promise<WhatsAppMessage[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<WhatsAppMessage>(
      `SELECT * FROM whatsapp_messages
       WHERE store_id = $1 AND conversation_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [storeId, conversationId, limit]
    );

    return res.rows;
  }

  async updateMessageStatus(wamid: string, status: string): Promise<boolean> {
    if (!wamid) return false;

    const res = await this.db.query(
      `UPDATE whatsapp_messages
       SET status = $2
       WHERE wamid = $1`,
      [wamid, status]
    );

    return (res.rowCount ?? 0) > 0;
  }

  // ==========================================
  // 4. Abandoned Cart Recovery Jobs
  // ==========================================

  async scheduleRecoveryJob(
    storeId: string,
    params: {
      phoneNumber: string;
      visitorId?: string | null;
      cartToken?: string | null;
      productId?: string | null;
      productTitle?: string | null;
      price?: number | null;
      currency?: string | null;
      checkoutUrl?: string | null;
      idempotencyKey: string;
    }
  ): Promise<WhatsAppRecoveryJob> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<WhatsAppRecoveryJob>(
      `INSERT INTO whatsapp_recovery_jobs (
        store_id, phone_number, visitor_id, cart_token, product_id, product_title, price,
        currency, checkout_url, idempotency_key, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW(), NOW())
      RETURNING *`,
      [
        storeId,
        params.phoneNumber.trim(),
        params.visitorId || null,
        params.cartToken || null,
        params.productId || null,
        params.productTitle || null,
        params.price || null,
        params.currency || 'GBP',
        params.checkoutUrl || null,
        params.idempotencyKey,
      ]
    );

    return res.rows[0];
  }

  async getPendingRecoveryJobs(storeId: string, limit = 50): Promise<WhatsAppRecoveryJob[]> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query<WhatsAppRecoveryJob>(
      `SELECT * FROM whatsapp_recovery_jobs
       WHERE store_id = $1 AND status = 'pending'
       ORDER BY created_at ASC
       LIMIT $2`,
      [storeId, limit]
    );

    return res.rows;
  }

  async updateRecoveryJobStatus(
    storeId: string,
    jobId: string,
    status: 'sent' | 'cancelled' | 'failed',
    cancelReason?: string | null
  ): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query(
      `UPDATE whatsapp_recovery_jobs
       SET status = $3,
           cancel_reason = $4,
           sent_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE sent_at END,
           updated_at = NOW()
       WHERE store_id = $1 AND id = $2`,
      [storeId, jobId, status, cancelReason || null]
    );

    return (res.rowCount ?? 0) > 0;
  }

  async isRecoveryIdempotencyKeyUsed(storeId: string, key: string): Promise<boolean> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const res = await this.db.query(
      `SELECT id FROM whatsapp_recovery_jobs WHERE store_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [storeId, key]
    );

    return res.rows.length > 0;
  }

  // ==========================================
  // 5. Webhook Idempotency & Deduplication
  // ==========================================

  async isWebhookEventProcessed(eventId: string): Promise<boolean> {
    if (!eventId) return false;

    const res = await this.db.query(
      `SELECT id FROM whatsapp_webhook_events WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );

    return res.rows.length > 0;
  }

  async recordWebhookEvent(
    storeId: string | null,
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    if (!eventId) return false;

    try {
      await this.db.query(
        `INSERT INTO whatsapp_webhook_events (store_id, event_id, event_type, payload, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [storeId || null, eventId, eventType, JSON.stringify(payload || {})]
      );
      return true;
    } catch {
      // Event already recorded (unique constraint)
      return false;
    }
  }

  // ==========================================
  // 6. WhatsApp Analytics Summary
  // ==========================================

  async getAnalyticsSummary(storeId: string): Promise<{
    activeConversations: number;
    inboundMessages: number;
    outboundMessages: number;
    recoveredCarts: number;
    consentedContacts: number;
  }> {
    if (!storeId) throw new TenantIsolationError('store_id is required');

    const convRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM whatsapp_conversations WHERE store_id = $1 AND status = 'active'`,
      [storeId]
    );

    const inMsgRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM whatsapp_messages WHERE store_id = $1 AND direction = 'inbound'`,
      [storeId]
    );

    const outMsgRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM whatsapp_messages WHERE store_id = $1 AND direction = 'outbound'`,
      [storeId]
    );

    const recoveryRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM whatsapp_recovery_jobs WHERE store_id = $1 AND status = 'sent'`,
      [storeId]
    );

    const consentRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT phone_number) as count FROM whatsapp_consents WHERE store_id = $1 AND opted_in = true AND revoked_at IS NULL`,
      [storeId]
    );

    return {
      activeConversations: parseInt(convRes.rows[0]?.count || '0', 10),
      inboundMessages: parseInt(inMsgRes.rows[0]?.count || '0', 10),
      outboundMessages: parseInt(outMsgRes.rows[0]?.count || '0', 10),
      recoveredCarts: parseInt(recoveryRes.rows[0]?.count || '0', 10),
      consentedContacts: parseInt(consentRes.rows[0]?.count || '0', 10),
    };
  }
}
