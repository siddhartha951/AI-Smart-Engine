import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { ReplenishmentRepository } from './replenishment.repository';
import { MerchantRepository } from '../merchant/merchant.repository';
import { VisitorRepository } from '../visitor/visitor.repository';
import { EventRepository } from '../events/event.repository';
import { EmailRepository } from '../email/email.repository';
import { WhatsAppRepository } from '../whatsapp/whatsapp.repository';
import { getEmailProvider, IEmailProvider } from '../../providers/email';
import { getWhatsAppProvider, IWhatsAppProvider } from '../../providers/whatsapp';
import { ReplenishmentProductSettings, ReplenishmentSchedule } from '../../database/types';
import { ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { decryptString } from '../../utils/crypto';

export class ReplenishmentService {
  private db: IDatabaseClient;
  private repo: ReplenishmentRepository;
  private merchantRepo: MerchantRepository;
  private visitorRepo: VisitorRepository;
  private eventRepo: EventRepository;
  private emailRepo: EmailRepository;
  private waRepo: WhatsAppRepository;
  private emailProvider: IEmailProvider;
  private explicitWaProvider: IWhatsAppProvider | null = null;

  constructor(opts?: {
    db?: IDatabaseClient;
    repo?: ReplenishmentRepository;
    merchantRepo?: MerchantRepository;
    visitorRepo?: VisitorRepository;
    eventRepo?: EventRepository;
    emailRepo?: EmailRepository;
    waRepo?: WhatsAppRepository;
    emailProvider?: IEmailProvider;
    whatsappProvider?: IWhatsAppProvider;
  }) {
    this.db = opts?.db || getDatabaseClient();
    this.repo = opts?.repo || new ReplenishmentRepository(this.db);
    this.merchantRepo = opts?.merchantRepo || new MerchantRepository(this.db);
    this.visitorRepo = opts?.visitorRepo || new VisitorRepository(this.db);
    this.eventRepo = opts?.eventRepo || new EventRepository(this.db);
    this.emailRepo = opts?.emailRepo || new EmailRepository(this.db);
    this.waRepo = opts?.waRepo || new WhatsAppRepository(this.db);
    this.emailProvider = opts?.emailProvider || getEmailProvider();
    this.explicitWaProvider = opts?.whatsappProvider || null;
  }

  // ==========================================
  // 1. Deterministic Date Calculation
  // ==========================================

  /**
   * Deterministically calculates expected reorder date and reminder date.
   * - cycleDays must be > 0
   * - reminderDaysBefore must be >= 0 and < cycleDays
   */
  calculateReorderDates(
    purchasedAt: Date,
    cycleDays: number,
    reminderDaysBefore = 5
  ): { expectedReorderAt: Date; reminderAt: Date } {
    if (cycleDays <= 0 || !Number.isInteger(cycleDays)) {
      throw new ValidationError('Replenishment cycle must be a positive integer');
    }
    if (reminderDaysBefore < 0 || !Number.isInteger(reminderDaysBefore)) {
      throw new ValidationError('Reminder days before must be a non-negative integer');
    }
    if (reminderDaysBefore >= cycleDays) {
      throw new ValidationError('Reminder days before must be less than replenishment cycle days');
    }

    const expectedTime = purchasedAt.getTime() + cycleDays * 86400000;
    const expectedReorderAt = new Date(expectedTime);
    const reminderAt = new Date(expectedTime - reminderDaysBefore * 86400000);

    return { expectedReorderAt, reminderAt };
  }

  // ==========================================
  // 2. Product Replenishment Configuration
  // ==========================================

  async configureProduct(
    storeId: string,
    productId: string,
    params: {
      variantId?: string;
      replenishable: boolean;
      cycleDays: number;
      reminderDaysBefore?: number;
      enabled?: boolean;
    }
  ): Promise<ReplenishmentProductSettings> {
    const cycleDays = Math.round(params.cycleDays);
    const reminderDays = params.reminderDaysBefore !== undefined ? Math.round(params.reminderDaysBefore) : 5;
    const enabled = params.enabled !== undefined ? params.enabled : true;

    // Validate inputs
    if (cycleDays <= 0) {
      throw new ValidationError('Cycle days must be a positive integer greater than 0');
    }
    if (reminderDays < 0) {
      throw new ValidationError('Reminder days before must be 0 or greater');
    }
    if (reminderDays >= cycleDays) {
      throw new ValidationError('Reminder days before must be strictly less than cycle days');
    }

    return this.repo.upsertProductSettings(storeId, {
      productId,
      variantId: params.variantId || '',
      replenishable: params.replenishable,
      cycleDays,
      reminderDaysBefore: reminderDays,
      enabled,
    });
  }

  async listProductsWithSettings(storeId: string): Promise<any[]> {
    const productsRes = await this.db.query(
      `SELECT * FROM products WHERE store_id = $1 ORDER BY title ASC`,
      [storeId]
    );
    const settings = await this.repo.listProductSettings(storeId);
    const settingsMap = new Map<string, ReplenishmentProductSettings>();
    for (const s of settings) {
      settingsMap.set(`${s.product_id}:${s.variant_id || ''}`, s);
    }

    return productsRes.rows.map((p: any) => {
      const setting = settingsMap.get(`${p.id}:${p.variant_id || ''}`) ||
                      settingsMap.get(`${p.shopify_id}:${p.variant_id || ''}`) ||
                      settingsMap.get(`${p.id}:`) || null;
      return {
        ...p,
        replenishment: setting ? {
          replenishable: setting.replenishable,
          cycle_days: setting.cycle_days,
          reminder_days_before: setting.reminder_days_before,
          enabled: setting.enabled,
          updated_at: setting.updated_at,
        } : {
          replenishable: false,
          cycle_days: 30,
          reminder_days_before: 5,
          enabled: true,
          updated_at: null,
        },
      };
    });
  }

  // ==========================================
  // 3. Shopify Order Webhook Ingestion & Cycle Reset
  // ==========================================

  async handleOrderCompleted(
    storeId: string,
    orderData: any,
    visitorId?: string | null
  ): Promise<ReplenishmentSchedule[]> {
    if (!orderData || !Array.isArray(orderData.line_items) || orderData.line_items.length === 0) {
      return [];
    }

    const store = await this.merchantRepo.getStoreById(storeId);
    if (!store || store.status !== 'active') {
      logger.warn(`Skipping replenishment schedule creation: store ${storeId} not found or inactive`);
      return [];
    }

    const customerEmail = (orderData.email || orderData.contact_email || orderData.customer?.email || '').trim().toLowerCase() || null;
    const customerPhone = (orderData.phone || orderData.customer?.phone || orderData.shipping_address?.phone || '').trim() || null;

    const channelSettings = await this.repo.getChannelSettings(storeId);
    const discountCode = channelSettings.discount_code ? channelSettings.discount_code.trim() : '';

    const purchasedAt = orderData.created_at ? new Date(orderData.created_at) : new Date();
    const createdSchedules: ReplenishmentSchedule[] = [];

    for (const item of orderData.line_items) {
      const prodId = String(item.product_id || '');
      const varId = String(item.variant_id || '');

      // 1. Check if product is marked replenishable and enabled
      let prodSetting = await this.repo.getProductSettings(storeId, prodId, varId);
      if (!prodSetting) {
        prodSetting = await this.repo.getProductSettings(storeId, prodId, '');
      }
      if (!prodSetting || !prodSetting.replenishable || !prodSetting.enabled) {
        continue; // Non-replenishable or disabled product; ignore
      }

      // 2. Repurchase Suppression & Cycle Reset:
      // If customer has a previous active/pending schedule for this product, mark it superseded
      const existingSchedule = await this.repo.findActiveScheduleForCustomer(
        storeId,
        customerEmail,
        customerPhone,
        prodId,
        varId
      );

      if (existingSchedule) {
        await this.repo.markScheduleSuperseded(
          storeId,
          existingSchedule.id,
          `Superseded by repurchase in order #${orderData.order_number || orderData.id}`
        );
        // Record event
        const vid = await this.ensureVisitorId(storeId, customerEmail, customerPhone, visitorId || existingSchedule.visitor_id);
        await this.eventRepo.recordEvent(storeId, vid, 'reorder_schedule_reset', {
          superseded_schedule_id: existingSchedule.id,
          new_order_id: String(orderData.id),
          product_id: prodId,
          variant_id: varId,
        });
      }

      // 3. Calculate expected reorder date and reminder date
      const { expectedReorderAt, reminderAt } = this.calculateReorderDates(
        purchasedAt,
        prodSetting.cycle_days,
        prodSetting.reminder_days_before
      );

      // 4. Generate Pre-filled Shopify Cart Permalink
      // Format: https://{shop_domain}/cart/{variant_id}:1?discount={discount_code}
      const targetVariantId = varId || '1';
      let permalink = `https://${store.shop_domain}/cart/${targetVariantId}:1`;
      if (discountCode) {
        permalink += `?discount=${encodeURIComponent(discountCode)}`;
      }

      // 5. Create new replenishment schedule
      const schedule = await this.repo.createSchedule(storeId, {
        visitorId: visitorId || null,
        customerEmail,
        customerPhone,
        orderId: String(orderData.id),
        orderNumber: String(orderData.order_number || orderData.name || orderData.id),
        productId: prodId,
        variantId: varId,
        productTitle: item.title || 'Replenishable Item',
        productImageUrl: item.image_url || '',
        productPrice: Number(item.price || 0),
        currency: orderData.currency || 'GBP',
        purchasedAt,
        cycleDays: prodSetting.cycle_days,
        expectedReorderAt,
        reminderAt,
        channel: channelSettings.whatsapp_enabled ? 'both' : 'email',
        reorderCheckoutUrl: permalink,
      });

      if (schedule) {
        createdSchedules.push(schedule);
        // Record event
        const vid = await this.ensureVisitorId(storeId, customerEmail, customerPhone, visitorId || schedule.visitor_id);
        await this.eventRepo.recordEvent(storeId, vid, 'replenishment_schedule_created', {
          schedule_id: schedule.id,
          order_id: String(orderData.id),
          product_id: prodId,
          variant_id: varId,
          cycle_days: prodSetting.cycle_days,
          reminder_at: reminderAt.toISOString(),
          expected_reorder_at: expectedReorderAt.toISOString(),
        });
      }
    }

    return createdSchedules;
  }

  // ==========================================
  // 4. Reminder Worker & Multi-Channel Dispatch
  // ==========================================

  async processDueReminders(limit = 50): Promise<{
    processed: number;
    sent: number;
    suppressed: number;
    cancelled: number;
  }> {
    const dueSchedules = await this.repo.getDueSchedules(limit);
    let sentCount = 0;
    let suppressedCount = 0;
    let cancelledCount = 0;

    for (const schedule of dueSchedules) {
      try {
        const result = await this.processSingleReminder(schedule);
        if (result.status === 'sent') sentCount++;
        else if (result.status === 'suppressed' || result.status === 'repurchased') suppressedCount++;
        else if (result.status === 'cancelled') cancelledCount++;
      } catch (err) {
        logger.error(`Error processing replenishment schedule ${schedule.id}:`, err);
      }
    }

    return {
      processed: dueSchedules.length,
      sent: sentCount,
      suppressed: suppressedCount,
      cancelled: cancelledCount,
    };
  }

  private async processSingleReminder(
    schedule: ReplenishmentSchedule
  ): Promise<{ status: string; reason?: string }> {
    const storeId = schedule.store_id;

    // 1. Verify Store is active
    const store = await this.merchantRepo.getStoreById(storeId);
    if (!store || store.status !== 'active') {
      await this.repo.updateScheduleStatus(storeId, schedule.id, 'cancelled', {
        cancelReason: 'Store inactive or not found',
      });
      return { status: 'cancelled', reason: 'Store inactive' };
    }

    // 2. Verify Product is still replenishable and enabled
    const prodSetting = await this.repo.getProductSettings(storeId, schedule.product_id, schedule.variant_id) ||
                        await this.repo.getProductSettings(storeId, schedule.product_id, '');
    if (!prodSetting || !prodSetting.replenishable || !prodSetting.enabled) {
      await this.repo.updateScheduleStatus(storeId, schedule.id, 'cancelled', {
        cancelReason: 'Product no longer marked replenishable',
      });
      return { status: 'cancelled', reason: 'Product no longer replenishable' };
    }

    // 3. Verify Customer Identity/Contact exists
    if (!schedule.customer_email && !schedule.customer_phone) {
      await this.repo.updateScheduleStatus(storeId, schedule.id, 'cancelled', {
        cancelReason: 'No email or phone for customer',
      });
      return { status: 'cancelled', reason: 'No customer contact' };
    }

    // 4. Verify Repurchase Suppression (Critical):
    // Has the customer repurchased this replenishable item since the purchase date?
    const hasRepurchased = await this.checkRecentRepurchase(
      storeId,
      schedule.customer_email,
      schedule.customer_phone,
      schedule.visitor_id,
      schedule.product_id,
      schedule.variant_id,
      schedule.purchased_at
    );

    if (hasRepurchased) {
      await this.repo.updateScheduleStatus(storeId, schedule.id, 'repurchased', {
        cancelReason: 'Customer already repurchased product before reminder',
      });
      const vid = await this.ensureVisitorId(storeId, schedule.customer_email, schedule.customer_phone, schedule.visitor_id);
      await this.eventRepo.recordEvent(storeId, vid, 'reorder_suppressed', {
        schedule_id: schedule.id,
        product_id: schedule.product_id,
        reason: 'repurchased_before_reminder',
      });
      return { status: 'repurchased', reason: 'Repurchased before reminder' };
    }

    // 5. Check Store Channel Settings
    const channelSettings = await this.repo.getChannelSettings(storeId);

    // 6. Evaluate Channel Consents Independently
    const canSendEmail = await this.evaluateEmailEligibility(storeId, schedule, channelSettings.email_enabled);
    const canSendWhatsApp = await this.evaluateWhatsAppEligibility(storeId, schedule, channelSettings.whatsapp_enabled);

    if (!canSendEmail && !canSendWhatsApp) {
      await this.repo.updateScheduleStatus(storeId, schedule.id, 'cancelled', {
        cancelReason: 'Missing marketing consent or channel suppressed',
      });
      const vid = await this.ensureVisitorId(storeId, schedule.customer_email, schedule.customer_phone, schedule.visitor_id);
      await this.eventRepo.recordEvent(storeId, vid, 'reorder_reminder_skipped', {
        schedule_id: schedule.id,
        product_id: schedule.product_id,
        reason: 'no_channel_consent',
      });
      return { status: 'cancelled', reason: 'No channel consent' };
    }

    // 7. Dispatch Reminder (Avoid duplicate messaging: prefer WhatsApp if consented, otherwise Email)
    if (canSendWhatsApp) {
      return this.dispatchWhatsAppReminder(store, schedule);
    } else {
      return this.dispatchEmailReminder(store, schedule);
    }
  }

  // ==========================================
  // 5. Channel Consent & Repurchase Helpers
  // ==========================================

  private async checkRecentRepurchase(
    storeId: string,
    email: string | null,
    phone: string | null,
    visitorId: string | null,
    productId: string,
    variantId: string,
    since: Date
  ): Promise<boolean> {
    const params: any[] = [storeId, since.toISOString()];
    let customerFilter = '';

    if (email && phone) {
      params.push(email, phone);
      customerFilter = `AND ((payload->>'email') = $3 OR (payload->>'phone') = $4 OR (payload::text LIKE '%' || $3 || '%'))`;
    } else if (email) {
      params.push(email);
      customerFilter = `AND ((payload->>'email') = $3 OR (payload::text LIKE '%' || $3 || '%'))`;
    } else if (phone) {
      params.push(phone);
      customerFilter = `AND ((payload->>'phone') = $3)`;
    } else if (visitorId) {
      params.push(visitorId);
      customerFilter = `AND visitor_id = $3`;
    }

    const query = `
      SELECT id, payload FROM events 
      WHERE store_id = $1 AND type = 'purchase_completed' AND created_at > $2
      ${customerFilter}
      LIMIT 20
    `;

    const res = await this.db.query<{ id: string; payload: any }>(query, params);
    for (const row of res.rows) {
      const payload = row.payload;
      if (Array.isArray(payload?.line_items)) {
        const match = payload.line_items.some(
          (li: any) => String(li.product_id) === productId || (variantId && String(li.variant_id) === variantId)
        );
        if (match) return true;
      }
    }
    return false;
  }

  private async evaluateEmailEligibility(
    storeId: string,
    schedule: ReplenishmentSchedule,
    channelEnabled: boolean
  ): Promise<boolean> {
    if (!channelEnabled || !schedule.customer_email) return false;

    // Check suppression list
    const isSuppressed = await this.emailRepo.isSuppressed(storeId, schedule.customer_email);
    if (isSuppressed) return false;

    // Check explicit email marketing consent
    let consented = false;
    if (schedule.visitor_id) {
      const consent = await this.visitorRepo.getLatestMarketingConsent(storeId, schedule.visitor_id);
      if (consent && consent.opted_in) {
        consented = true;
      }
    }

    if (!consented) {
      const emailConsentRes = await this.db.query<{ opted_in: boolean }>(
        `SELECT mc.opted_in FROM marketing_consents mc
         JOIN visitors v ON mc.visitor_id = v.id
         WHERE mc.store_id = $1 AND LOWER(v.email) = $2
         ORDER BY mc.captured_at DESC LIMIT 1`,
        [storeId, schedule.customer_email.toLowerCase()]
      );
      if (emailConsentRes.rows[0]?.opted_in) {
        consented = true;
      }
    }

    return consented;
  }

  private async evaluateWhatsAppEligibility(
    storeId: string,
    schedule: ReplenishmentSchedule,
    channelEnabled: boolean
  ): Promise<boolean> {
    if (!channelEnabled || !schedule.customer_phone) return false;

    // Check WhatsApp store configuration
    const config = await this.waRepo.getConfig(storeId);
    if (!this.explicitWaProvider && (!config || config.status !== 'connected')) {
      return false;
    }

    // Check WhatsApp-specific marketing consent
    const waConsentRes = await this.db.query<{ opted_in: boolean; revoked_at: Date | null }>(
      `SELECT opted_in, revoked_at FROM whatsapp_consents 
       WHERE store_id = $1 AND phone_number = $2 
       ORDER BY created_at DESC LIMIT 1`,
      [storeId, schedule.customer_phone]
    );

    const waConsent = waConsentRes.rows[0];
    if (!waConsent || !waConsent.opted_in || waConsent.revoked_at !== null) {
      return false;
    }

    return true;
  }

  // ==========================================
  // Helper to ensure valid visitorId for event tracking
  // ==========================================
  private async ensureVisitorId(
    storeId: string,
    email: string | null,
    phone: string | null,
    existingVisitorId?: string | null
  ): Promise<string> {
    if (existingVisitorId) {
      const check = await this.db.query('SELECT id FROM visitors WHERE store_id = $1 AND id = $2', [storeId, existingVisitorId]);
      if (check.rows.length > 0) return existingVisitorId;
    }

    if (email) {
      const check = await this.db.query('SELECT id FROM visitors WHERE store_id = $1 AND LOWER(email) = $2', [storeId, email.toLowerCase()]);
      if (check.rows.length > 0) return check.rows[0].id;
    }

    if (phone) {
      const check = await this.db.query('SELECT id FROM visitors WHERE store_id = $1 AND phone = $2', [storeId, phone]);
      if (check.rows.length > 0) return check.rows[0].id;
    }

    const inserted = await this.db.query(
      'INSERT INTO visitors (store_id, email, phone, anonymous_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [storeId, email || null, phone || null, 'anon-rep-' + Date.now()]
    );
    return inserted.rows[0].id;
  }

  // ==========================================
  // 6. Dispatch Actions
  // ==========================================

  private async dispatchEmailReminder(
    store: any,
    schedule: ReplenishmentSchedule
  ): Promise<{ status: string; reason?: string }> {
    const brandName = store.brand_name || 'Our Store';
    const recipient = schedule.customer_email!;
    const checkoutUrl = schedule.reorder_checkout_url || `https://${store.shop_domain}`;

    const subject = `Time to reorder your ${schedule.product_title}!`;
    const priceText = schedule.product_price ? `${schedule.currency} ${Number(schedule.product_price).toFixed(2)}` : '';
    const imageTag = schedule.product_image_url ? `<img src="${schedule.product_image_url}" alt="${schedule.product_title}" style="max-width:300px;border-radius:8px;margin-bottom:16px;"/><br/>` : '';

    const textBody = `Hi there! 👋 It looks like it might be time to replenish your ${schedule.product_title} (${priceText}) from ${brandName}.\n\nReorder now: ${checkoutUrl}\n\nReply directly to this email or visit our store.`;

    const htmlBody = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2>Hi there! 👋</h2>
        <p>It looks like it might be time to replenish your <strong>${schedule.product_title}</strong> from ${brandName}.</p>
        ${imageTag}
        <p>Price: <strong>${priceText}</strong></p>
        <p style="margin:24px 0;">
          <a href="${checkoutUrl}" style="background:#008060;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;display:inline-block;">
            Reorder Now 🛍️
          </a>
        </p>
        <p style="color:#666;font-size:12px;">Need help? Reply directly to this email or visit our store.</p>
      </div>
    `;

    try {
      await this.emailProvider.sendEmail({
        storeId: schedule.store_id,
        to: recipient,
        from: `notifications@${store.shop_domain || 'ai-smart-engine.com'}`,
        subject,
        textBody,
        htmlBody,
        campaignType: 'reorder_reminder',
      });

      await this.repo.updateScheduleStatus(schedule.store_id, schedule.id, 'sent', {
        sentChannel: 'email',
      });

      const visitorId = await this.ensureVisitorId(schedule.store_id, schedule.customer_email, schedule.customer_phone, schedule.visitor_id);
      await this.eventRepo.recordEvent(schedule.store_id, visitorId, 'reorder_reminder_sent', {
        schedule_id: schedule.id,
        channel: 'email',
        product_id: schedule.product_id,
        recipient,
      });

      return { status: 'sent' };
    } catch (err: any) {
      logger.error(`Failed to dispatch reorder email for schedule ${schedule.id}:`, err);
      return { status: 'failed', reason: err.message };
    }
  }

  private async dispatchWhatsAppReminder(
    store: any,
    schedule: ReplenishmentSchedule
  ): Promise<{ status: string; reason?: string }> {
    const brandName = store.brand_name || 'Our Store';
    const checkoutUrl = schedule.reorder_checkout_url || `https://${store.shop_domain}`;
    const priceText = schedule.product_price ? ` (${schedule.currency} ${Number(schedule.product_price).toFixed(2)})` : '';
    const bodyText = `Hi there! 👋 It might be time to replenish your ${schedule.product_title}${priceText} from ${brandName}.\n\nReorder now in 1 click:\n${checkoutUrl}\n\nReply STOP to unsubscribe.`;

    const config = await this.waRepo.getConfig(schedule.store_id);
    const provider = this.explicitWaProvider || (config ? getWhatsAppProvider(config.provider as any) : getWhatsAppProvider('mock'));

    let accessToken = 'authenticated-token';
    if (config?.provider === 'wati' && config.encrypted_wati_token) {
      try {
        accessToken = decryptString(config.encrypted_wati_token);
      } catch {
        accessToken = 'authenticated-token';
      }
    } else if (config?.provider === 'meta' && config.encrypted_access_token) {
      try {
        accessToken = decryptString(config.encrypted_access_token);
      } catch {
        accessToken = 'authenticated-token';
      }
    }

    try {
      const sendRes = await provider.sendMessage({
        phoneNumberId: config?.phone_number_id || undefined,
        apiEndpoint: config?.wati_api_endpoint || undefined,
        channelPhoneNumber: config?.display_phone_number || undefined,
        accessToken,
        to: schedule.customer_phone!,
        message: {
          type: 'text',
          text: { body: bodyText },
        },
      });

      if (!sendRes.success) {
        throw new Error(sendRes.error || 'Failed to dispatch WhatsApp message');
      }

      await this.repo.updateScheduleStatus(schedule.store_id, schedule.id, 'sent', {
        sentChannel: 'whatsapp',
      });

      // Record outbound message in WhatsApp conversations ledger if exists
      const conv = await this.waRepo.getOrCreateConversation(schedule.store_id, schedule.customer_phone!, schedule.visitor_id);
      await this.waRepo.addMessage(schedule.store_id, {
        conversationId: conv.id,
        direction: 'outbound',
        content: bodyText,
        wamid: sendRes.messageId,
        status: 'sent',
      });

      const visitorId = await this.ensureVisitorId(schedule.store_id, schedule.customer_email, schedule.customer_phone, schedule.visitor_id);
      await this.eventRepo.recordEvent(schedule.store_id, visitorId, 'reorder_reminder_sent', {
        schedule_id: schedule.id,
        channel: 'whatsapp',
        product_id: schedule.product_id,
        phone: schedule.customer_phone,
      });

      return { status: 'sent' };
    } catch (err: any) {
      logger.error(`Failed to dispatch reorder WhatsApp for schedule ${schedule.id}:`, err);
      return { status: 'failed', reason: err.message };
    }
  }

  // ==========================================
  // 7. Click Tracking
  // ==========================================

  async trackReorderClick(storeId: string, scheduleId: string): Promise<string> {
    const schedule = await this.repo.getScheduleById(storeId, scheduleId);
    if (!schedule) {
      throw new ValidationError('Schedule not found');
    }

    const visitorId = await this.ensureVisitorId(storeId, schedule.customer_email, schedule.customer_phone, schedule.visitor_id);
    await this.eventRepo.recordEvent(storeId, visitorId, 'reorder_clicked', {
      schedule_id: schedule.id,
      product_id: schedule.product_id,
      channel: schedule.sent_channel || schedule.channel,
    });

    return schedule.reorder_checkout_url || `/`;
  }
}
