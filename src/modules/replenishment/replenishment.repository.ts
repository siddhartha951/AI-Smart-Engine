import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import {
  ReplenishmentProductSettings,
  ReplenishmentSchedule,
  ReplenishmentChannelSettings,
} from '../../database/types';

export class ReplenishmentRepository {
  private db: IDatabaseClient;

  constructor(db?: IDatabaseClient) {
    this.db = db || getDatabaseClient();
  }

  // ==========================================
  // 1. Product Replenishment Settings
  // ==========================================

  async getProductSettings(
    storeId: string,
    productId: string,
    variantId = ''
  ): Promise<ReplenishmentProductSettings | null> {
    const res = await this.db.query<ReplenishmentProductSettings>(
      `SELECT * FROM replenishment_product_settings 
       WHERE store_id = $1 AND product_id = $2 AND variant_id = $3`,
      [storeId, productId, variantId]
    );
    return res.rows[0] || null;
  }

  async listProductSettings(storeId: string): Promise<ReplenishmentProductSettings[]> {
    const res = await this.db.query<ReplenishmentProductSettings>(
      `SELECT * FROM replenishment_product_settings 
       WHERE store_id = $1 
       ORDER BY updated_at DESC`,
      [storeId]
    );
    return res.rows;
  }

  async upsertProductSettings(
    storeId: string,
    data: {
      productId: string;
      variantId?: string;
      replenishable: boolean;
      cycleDays: number;
      reminderDaysBefore: number;
      enabled: boolean;
    }
  ): Promise<ReplenishmentProductSettings> {
    const variantId = data.variantId || '';
    const existing = await this.getProductSettings(storeId, data.productId, variantId);

    if (existing) {
      const res = await this.db.query<ReplenishmentProductSettings>(
        `UPDATE replenishment_product_settings 
         SET replenishable = $1, cycle_days = $2, reminder_days_before = $3, enabled = $4, updated_at = NOW() 
         WHERE store_id = $5 AND product_id = $6 AND variant_id = $7 
         RETURNING *`,
        [data.replenishable, data.cycleDays, data.reminderDaysBefore, data.enabled, storeId, data.productId, variantId]
      );
      return res.rows[0];
    } else {
      const res = await this.db.query<ReplenishmentProductSettings>(
        `INSERT INTO replenishment_product_settings 
         (store_id, product_id, variant_id, replenishable, cycle_days, reminder_days_before, enabled) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING *`,
        [storeId, data.productId, variantId, data.replenishable, data.cycleDays, data.reminderDaysBefore, data.enabled]
      );
      return res.rows[0];
    }
  }

  // ==========================================
  // 2. Channel Configuration
  // ==========================================

  async getChannelSettings(storeId: string): Promise<ReplenishmentChannelSettings> {
    const res = await this.db.query<ReplenishmentChannelSettings>(
      `SELECT * FROM replenishment_channel_settings WHERE store_id = $1`,
      [storeId]
    );
    if (res.rows.length > 0) {
      return res.rows[0];
    }
    // Return default settings
    return {
      id: '',
      store_id: storeId,
      email_enabled: true,
      whatsapp_enabled: false,
      discount_code: '',
      discount_percentage: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  async upsertChannelSettings(
    storeId: string,
    data: {
      emailEnabled?: boolean;
      whatsappEnabled?: boolean;
      discountCode?: string;
      discountPercentage?: number;
    }
  ): Promise<ReplenishmentChannelSettings> {
    const existing = await this.db.query<ReplenishmentChannelSettings>(
      `SELECT * FROM replenishment_channel_settings WHERE store_id = $1`,
      [storeId]
    );

    const emailEnabled = data.emailEnabled !== undefined ? data.emailEnabled : (existing.rows[0]?.email_enabled ?? true);
    const whatsappEnabled = data.whatsappEnabled !== undefined ? data.whatsappEnabled : (existing.rows[0]?.whatsapp_enabled ?? false);
    const discountCode = data.discountCode !== undefined ? data.discountCode.trim() : (existing.rows[0]?.discount_code ?? '');
    const discountPercentage = data.discountPercentage !== undefined ? data.discountPercentage : (existing.rows[0]?.discount_percentage ?? 0);

    if (existing.rows.length > 0) {
      const res = await this.db.query<ReplenishmentChannelSettings>(
        `UPDATE replenishment_channel_settings 
         SET email_enabled = $1, whatsapp_enabled = $2, discount_code = $3, discount_percentage = $4, updated_at = NOW() 
         WHERE store_id = $5 
         RETURNING *`,
        [emailEnabled, whatsappEnabled, discountCode, discountPercentage, storeId]
      );
      return res.rows[0];
    } else {
      const res = await this.db.query<ReplenishmentChannelSettings>(
        `INSERT INTO replenishment_channel_settings 
         (store_id, email_enabled, whatsapp_enabled, discount_code, discount_percentage) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [storeId, emailEnabled, whatsappEnabled, discountCode, discountPercentage]
      );
      return res.rows[0];
    }
  }

  // ==========================================
  // 3. Replenishment Schedules
  // ==========================================

  async createSchedule(
    storeId: string,
    data: {
      visitorId?: string | null;
      customerEmail?: string | null;
      customerPhone?: string | null;
      orderId: string;
      orderNumber?: string | null;
      productId: string;
      variantId?: string;
      productTitle: string;
      productImageUrl?: string;
      productPrice?: number;
      currency?: string;
      purchasedAt: Date;
      cycleDays: number;
      expectedReorderAt: Date;
      reminderAt: Date;
      channel?: 'email' | 'whatsapp' | 'both';
      reorderCheckoutUrl?: string;
    }
  ): Promise<ReplenishmentSchedule | null> {
    const variantId = data.variantId || '';
    // Deduplication check: Do not create duplicate schedule for identical order line
    const dupCheck = await this.db.query<ReplenishmentSchedule>(
      `SELECT * FROM replenishment_schedules 
       WHERE store_id = $1 AND order_id = $2 AND product_id = $3 AND variant_id = $4`,
      [storeId, data.orderId, data.productId, variantId]
    );
    if (dupCheck.rows.length > 0) {
      return dupCheck.rows[0];
    }

    const res = await this.db.query<ReplenishmentSchedule>(
      `INSERT INTO replenishment_schedules (
         store_id, visitor_id, customer_email, customer_phone,
         order_id, order_number, product_id, variant_id,
         product_title, product_image_url, product_price, currency,
         purchased_at, cycle_days, expected_reorder_at, reminder_at,
         status, channel, reorder_checkout_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pending', $17, $18)
       RETURNING *`,
      [
        storeId,
        data.visitorId || null,
        data.customerEmail || null,
        data.customerPhone || null,
        data.orderId,
        data.orderNumber || null,
        data.productId,
        variantId,
        data.productTitle,
        data.productImageUrl || '',
        data.productPrice || 0,
        data.currency || 'GBP',
        data.purchasedAt,
        data.cycleDays,
        data.expectedReorderAt,
        data.reminderAt,
        data.channel || 'email',
        data.reorderCheckoutUrl || '',
      ]
    );

    return res.rows[0];
  }

  async findActiveScheduleForCustomer(
    storeId: string,
    customerEmail: string | null,
    customerPhone: string | null,
    productId: string,
    variantId = ''
  ): Promise<ReplenishmentSchedule | null> {
    let query = `
      SELECT * FROM replenishment_schedules 
      WHERE store_id = $1 AND product_id = $2 AND status = 'pending'
    `;
    const params: any[] = [storeId, productId];

    if (variantId) {
      params.push(variantId);
      query += ` AND variant_id = $${params.length}`;
    }

    if (customerEmail && customerPhone) {
      params.push(customerEmail, customerPhone);
      query += ` AND (customer_email = $${params.length - 1} OR customer_phone = $${params.length})`;
    } else if (customerEmail) {
      params.push(customerEmail);
      query += ` AND customer_email = $${params.length}`;
    } else if (customerPhone) {
      params.push(customerPhone);
      query += ` AND customer_phone = $${params.length}`;
    } else {
      return null;
    }

    query += ' ORDER BY created_at DESC LIMIT 1';
    const res = await this.db.query<ReplenishmentSchedule>(query, params);
    return res.rows[0] || null;
  }

  async markScheduleSuperseded(
    storeId: string,
    scheduleId: string,
    reason: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE replenishment_schedules 
       SET status = 'repurchased', cancel_reason = $1, updated_at = NOW() 
       WHERE store_id = $2 AND id = $3`,
      [reason, storeId, scheduleId]
    );
  }

  async getDueSchedules(limit = 50): Promise<ReplenishmentSchedule[]> {
    const res = await this.db.query<ReplenishmentSchedule>(
      `SELECT * FROM replenishment_schedules 
       WHERE status = 'pending' AND reminder_at <= NOW() 
       ORDER BY reminder_at ASC 
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  }

  async updateScheduleStatus(
    storeId: string,
    scheduleId: string,
    status: 'pending' | 'sent' | 'suppressed' | 'repurchased' | 'cancelled',
    details?: { sentChannel?: string; cancelReason?: string }
  ): Promise<void> {
    const sentAt = status === 'sent' ? 'NOW()' : 'sent_at';
    await this.db.query(
      `UPDATE replenishment_schedules 
       SET status = $1, 
           sent_at = ${sentAt},
           sent_channel = COALESCE($2, sent_channel), 
           cancel_reason = COALESCE($3, cancel_reason), 
           updated_at = NOW() 
       WHERE store_id = $4 AND id = $5`,
      [status, details?.sentChannel || null, details?.cancelReason || null, storeId, scheduleId]
    );
  }

  async getScheduleById(storeId: string, scheduleId: string): Promise<ReplenishmentSchedule | null> {
    const res = await this.db.query<ReplenishmentSchedule>(
      `SELECT * FROM replenishment_schedules WHERE store_id = $1 AND id = $2`,
      [storeId, scheduleId]
    );
    return res.rows[0] || null;
  }

  async listSchedules(
    storeId: string,
    filters?: { status?: string; limit?: number; offset?: number }
  ): Promise<{ schedules: ReplenishmentSchedule[]; total: number }> {
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    let whereSql = 'WHERE store_id = $1';
    const params: any[] = [storeId];

    if (filters?.status) {
      params.push(filters.status);
      whereSql += ` AND status = $${params.length}`;
    }

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM replenishment_schedules ${whereSql}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    params.push(limit, offset);
    const listRes = await this.db.query<ReplenishmentSchedule>(
      `SELECT * FROM replenishment_schedules ${whereSql} 
       ORDER BY reminder_at ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { schedules: listRes.rows, total };
  }

  // ==========================================
  // 4. Analytics & Metrics
  // ==========================================

  async getAnalytics(storeId: string): Promise<{
    activeSchedules: number;
    upcomingReminders: number;
    remindersSent: number;
    reordersCompleted: number;
    conversionRate: number;
  }> {
    const activeRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM replenishment_schedules WHERE store_id = $1 AND status = 'pending'`,
      [storeId]
    );
    const activeSchedules = parseInt(activeRes.rows[0]?.count || '0', 10);

    const upcomingRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM replenishment_schedules 
       WHERE store_id = $1 AND status = 'pending' AND reminder_at <= (NOW() + interval '7 days')`,
      [storeId]
    );
    const upcomingReminders = parseInt(upcomingRes.rows[0]?.count || '0', 10);

    const sentRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM replenishment_schedules WHERE store_id = $1 AND status = 'sent'`,
      [storeId]
    );
    const remindersSent = parseInt(sentRes.rows[0]?.count || '0', 10);

    const reorderedRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM replenishment_schedules WHERE store_id = $1 AND status = 'repurchased'`,
      [storeId]
    );
    const reordersCompleted = parseInt(reorderedRes.rows[0]?.count || '0', 10);

    const conversionRate = remindersSent > 0
      ? Number(((reordersCompleted / remindersSent) * 100).toFixed(1))
      : 0;

    return {
      activeSchedules,
      upcomingReminders,
      remindersSent,
      reordersCompleted,
      conversionRate,
    };
  }
}
