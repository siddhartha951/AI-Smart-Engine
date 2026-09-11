import { IDatabaseClient, getDatabaseClient } from '../../database/client';
import { WhatsAppRepository } from './whatsapp.repository';
import {
  getWhatsAppProvider,
  IWhatsAppProvider,
  WhatsAppProviderType,
} from '../../providers/whatsapp';
import { getAiProvider, IAiProvider, BudgetGuard, ChatMessage } from '../../providers/ai';
import { getShopifyAdapter, IShopifyCatalogAdapter } from '../../providers/shopify';
import { getPurchaseAdapter, IPurchaseAdapter, FakePurchaseAdapter } from '../../providers/purchase';
import { MerchantRepository } from '../merchant/merchant.repository';
import { VisitorRepository } from '../visitor/visitor.repository';
import { EventRepository } from '../events/event.repository';
import { encryptString, decryptString } from '../../utils/crypto';
import { WhatsAppConfig } from '../../database/types';
import { ValidationError } from '../../utils/errors';

export class WhatsAppService {
  private db: IDatabaseClient;
  private repo: WhatsAppRepository;
  private explicitProvider: IWhatsAppProvider | null = null;
  private aiProvider: IAiProvider;
  private shopifyAdapter: IShopifyCatalogAdapter;
  private purchaseAdapter: IPurchaseAdapter;
  private merchantRepo: MerchantRepository;
  private visitorRepo: VisitorRepository;
  private eventRepo: EventRepository;
  private budgetGuard: BudgetGuard;

  constructor(opts?: {
    db?: IDatabaseClient;
    repo?: WhatsAppRepository;
    whatsappProvider?: IWhatsAppProvider;
    aiProvider?: IAiProvider;
    shopifyAdapter?: IShopifyCatalogAdapter;
    purchaseAdapter?: IPurchaseAdapter;
    merchantRepo?: MerchantRepository;
    visitorRepo?: VisitorRepository;
    eventRepo?: EventRepository;
    budgetGuard?: BudgetGuard;
  }) {
    this.db = opts?.db || getDatabaseClient();
    this.repo = opts?.repo || new WhatsAppRepository(this.db);
    this.explicitProvider = opts?.whatsappProvider || null;
    this.aiProvider = opts?.aiProvider || getAiProvider();
    this.shopifyAdapter = opts?.shopifyAdapter || getShopifyAdapter();
    try {
      this.purchaseAdapter = opts?.purchaseAdapter || getPurchaseAdapter();
    } catch {
      this.purchaseAdapter = new FakePurchaseAdapter();
    }
    this.merchantRepo = opts?.merchantRepo || new MerchantRepository(this.db);
    this.visitorRepo = opts?.visitorRepo || new VisitorRepository(this.db);
    this.eventRepo = opts?.eventRepo || new EventRepository(this.db);
    this.budgetGuard = opts?.budgetGuard || new BudgetGuard(this.db);
  }

  /**
   * Resolves the appropriate provider based on store configuration or test override.
   */
  getProviderForConfig(config?: WhatsAppConfig | null): IWhatsAppProvider {
    if (this.explicitProvider) {
      return this.explicitProvider;
    }
    const type = (config?.provider || 'meta') as WhatsAppProviderType;
    return getWhatsAppProvider(type);
  }

  /**
   * Decrypts the active access token for the given store configuration.
   */
  private getDecryptedToken(config: WhatsAppConfig): string {
    if (config.provider === 'wati') {
      return config.encrypted_wati_token ? this.decryptToken(config.encrypted_wati_token) : '';
    }
    return config.encrypted_access_token ? this.decryptToken(config.encrypted_access_token) : '';
  }

  // ==========================================
  // 1. Merchant Configuration & Security
  // ==========================================

  async saveConfig(
    storeId: string,
    params: {
      provider?: WhatsAppProviderType;
      phoneNumberId?: string | null;
      wabaId?: string | null;
      accessToken?: string | null;
      webhookVerifyToken?: string | null;
      appSecret?: string | null;
      displayPhoneNumber?: string | null;
      watiApiEndpoint?: string | null;
      watiAccessToken?: string | null;
    }
  ) {
    const provider = params.provider || 'meta';

    if (provider === 'wati' && params.watiApiEndpoint) {
      const trimmedEndpoint = params.watiApiEndpoint.trim();
      if (!trimmedEndpoint.startsWith('http://') && !trimmedEndpoint.startsWith('https://')) {
        throw new ValidationError('WATI API Endpoint URL must start with http:// or https://');
      }
    }

    let encryptedToken: string | undefined;
    if (params.accessToken) {
      const cleanToken = params.accessToken.trim().replace(/^(?:Bearer\s+)+/i, '');
      const encrypted = encryptString(cleanToken);
      encryptedToken = encrypted.encryptedString;
    }

    let encryptedWatiToken: string | undefined;
    if (params.watiAccessToken) {
      const cleanToken = params.watiAccessToken.trim().replace(/^(?:Bearer\s+)+/i, '');
      const encrypted = encryptString(cleanToken);
      encryptedWatiToken = encrypted.encryptedString;
    }

    const existing = await this.repo.getConfig(storeId);

    // Determine connection status based on provider
    let isConnected = false;
    if (provider === 'meta') {
      const hasPhone = params.phoneNumberId || existing?.phone_number_id;
      const hasToken = encryptedToken || existing?.encrypted_access_token;
      isConnected = Boolean(hasPhone && hasToken);
    } else if (provider === 'wati') {
      const hasEndpoint = params.watiApiEndpoint || existing?.wati_api_endpoint;
      const hasToken = encryptedWatiToken || existing?.encrypted_wati_token;
      isConnected = Boolean(hasEndpoint && hasToken);
    } else if (provider === 'mock') {
      isConnected = true;
    }

    const config = await this.repo.upsertConfig(storeId, {
      provider,
      phoneNumberId: params.phoneNumberId !== undefined ? (params.phoneNumberId ? params.phoneNumberId.trim() : null) : undefined,
      wabaId: params.wabaId !== undefined ? (params.wabaId ? params.wabaId.trim() : null) : undefined,
      encryptedAccessToken: encryptedToken,
      webhookVerifyToken: params.webhookVerifyToken ? params.webhookVerifyToken.trim() : undefined,
      appSecret: params.appSecret ? params.appSecret.trim() : undefined,
      displayPhoneNumber: params.displayPhoneNumber !== undefined ? (params.displayPhoneNumber ? params.displayPhoneNumber.trim() : null) : undefined,
      watiApiEndpoint: params.watiApiEndpoint !== undefined ? (params.watiApiEndpoint ? params.watiApiEndpoint.trim() : null) : undefined,
      encryptedWatiToken,
      status: isConnected ? 'connected' : 'disconnected',
    });

    return this.sanitizeConfig(config);
  }

  async getConfig(storeId: string) {
    const config = await this.repo.getConfig(storeId);
    return config ? this.sanitizeConfig(config) : {
      configured: false,
      status: 'disconnected',
      provider: 'meta',
      phone_number_id: null,
      waba_id: null,
      display_phone_number: null,
      webhook_verify_token: null,
      has_access_token: false,
      wati_api_endpoint: null,
      has_wati_token: false,
    };
  }

  /**
   * Sanitizes configuration by masking secret access tokens.
   */
  private sanitizeConfig(config: any) {
    const provider = config.provider || 'meta';
    const isConfigured = provider === 'wati'
      ? Boolean(config.wati_api_endpoint && config.encrypted_wati_token)
      : provider === 'mock'
      ? true
      : Boolean(config.phone_number_id && config.encrypted_access_token);

    return {
      id: config.id,
      store_id: config.store_id,
      provider,
      phone_number_id: config.phone_number_id,
      waba_id: config.waba_id,
      display_phone_number: config.display_phone_number,
      webhook_verify_token: config.webhook_verify_token,
      app_secret: config.app_secret ? '••••••••' : null,
      has_access_token: Boolean(config.encrypted_access_token),
      wati_api_endpoint: config.wati_api_endpoint || null,
      has_wati_token: Boolean(config.encrypted_wati_token),
      status: config.status,
      configured: isConfigured,
      quality_rating: config.quality_rating,
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }

  private decryptToken(encryptedString: string): string {
    return decryptString(encryptedString);
  }

  // ==========================================
  // 2. Test Message Dispatch
  // ==========================================

  async sendTestMessage(storeId: string, toPhone: string) {
    const config = await this.repo.getConfig(storeId);
    if (!config || config.status !== 'connected') {
      throw new Error('WhatsApp is not configured or connected for this store.');
    }

    const provider = this.getProviderForConfig(config);
    const store = await this.merchantRepo.getStoreById(storeId);
    const brandName = store?.brand_name || 'Our Store';

    let accessToken = '';
    if (config.provider === 'wati') {
      if (!config.encrypted_wati_token || !config.wati_api_endpoint) {
        throw new Error('WATI is not fully configured for this store. Please save your API Endpoint and Access Token.');
      }
      accessToken = this.decryptToken(config.encrypted_wati_token);
    } else if (config.provider === 'meta') {
      if (!config.encrypted_access_token || !config.phone_number_id) {
        throw new Error('WhatsApp is not fully configured for this store. Please save your Phone Number ID and Access Token.');
      }
      accessToken = this.decryptToken(config.encrypted_access_token);
    }

    const providerLabel = (config.provider || 'meta').toUpperCase();
    const result = await provider.sendMessage({
      phoneNumberId: config.phone_number_id || undefined,
      apiEndpoint: config.wati_api_endpoint || undefined,
      channelPhoneNumber: config.display_phone_number || undefined,
      accessToken,
      to: toPhone.trim(),
      message: {
        type: 'text',
        text: {
          body: `✨ Hi from ${brandName}! Your WhatsApp Growth Engine integration (${providerLabel}) is successfully connected and operational.`,
        },
      },
    });

    if (!result.success) {
      throw new Error(result.error || `Failed to dispatch test message via ${providerLabel}`);
    }

    return {
      ...result,
      wamid: result.messageId,
    };
  }

  // ==========================================
  // 3. Webhook Ingestion & Two-Way AI Chat
  // ==========================================

  async handleIncomingMessage(params: {
    storeId?: string;
    phoneNumberId?: string;
    from: string;
    customerName?: string;
    text?: string;
    messageId: string;
    timestamp: number;
    wabaId?: string;
  }): Promise<{ handled: boolean; replySent: boolean; optOut?: boolean }> {
    const { storeId: explicitStoreId, phoneNumberId, from, customerName, text, messageId } = params;

    // Deduplication check
    const alreadyProcessed = await this.repo.isWebhookEventProcessed(messageId);
    if (alreadyProcessed) {
      return { handled: true, replySent: false };
    }

    // Resolve store configuration: by explicit storeId or by phoneNumberId
    let config: WhatsAppConfig | null = null;
    if (explicitStoreId) {
      config = await this.repo.getConfig(explicitStoreId);
    } else if (phoneNumberId) {
      config = await this.repo.findConfigByPhoneNumberId(phoneNumberId);
    }

    if (!config) {
      return { handled: false, replySent: false };
    }

    const storeId = config.store_id;
    const provider = this.getProviderForConfig(config);
    const accessToken = this.getDecryptedToken(config);

    if (!accessToken && config.provider !== 'mock') {
      return { handled: false, replySent: false };
    }

    // Record webhook event for idempotency
    await this.repo.recordWebhookEvent(storeId, messageId, 'message', params);

    // Clean phone number
    const cleanPhone = from.trim();
    const cleanText = (text || '').trim();

    // Find or create visitor associated with this phone
    let visitor = await this.visitorRepo.getOrCreateVisitor(storeId, `wa_${cleanPhone}`);
    if (!visitor.phone) {
      visitor = await this.visitorRepo.updateVisitorLead(storeId, visitor.id, visitor.email || `${cleanPhone}@whatsapp.user`, cleanPhone);
    }

    // Get or create active conversation
    const conversation = await this.repo.getOrCreateConversation(
      storeId,
      cleanPhone,
      visitor.id,
      customerName || 'Customer'
    );

    // Save inbound message
    await this.repo.addMessage(storeId, {
      conversationId: conversation.id,
      direction: 'inbound',
      content: cleanText,
      wamid: messageId,
      status: 'received',
    });

    // Track inbound event
    await this.eventRepo.recordEvent(storeId, visitor.id, 'whatsapp_message_received', {
      phone: cleanPhone,
      message_id: messageId,
      content: cleanText,
      provider: config.provider,
    });

    const store = await this.merchantRepo.getStoreById(storeId);
    const brandName = store?.brand_name || 'Our Store';

    // 1. Check Opt-Out Keywords
    const upperText = cleanText.toUpperCase();
    const optOutKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'];
    if (optOutKeywords.includes(upperText)) {
      await this.repo.revokeConsent(storeId, cleanPhone, 'whatsapp_keyword_stop');
      await this.eventRepo.recordEvent(storeId, visitor.id, 'whatsapp_opt_out', {
        phone: cleanPhone,
        keyword: upperText,
        provider: config.provider,
      });

      const optOutReply = `You have been unsubscribed from WhatsApp notifications by ${brandName}. You will not receive marketing messages. Reply START at any time to re-subscribe.`;
      
      const sendRes = await provider.sendMessage({
        phoneNumberId: config.phone_number_id || undefined,
        apiEndpoint: config.wati_api_endpoint || undefined,
        channelPhoneNumber: config.display_phone_number || undefined,
        accessToken,
        to: cleanPhone,
        message: {
          type: 'text',
          text: { body: optOutReply },
        },
      });

      if (sendRes.success) {
        await this.repo.addMessage(storeId, {
          conversationId: conversation.id,
          direction: 'outbound',
          content: optOutReply,
          wamid: sendRes.messageId,
          status: 'sent',
        });
      }

      return { handled: true, replySent: true, optOut: true };
    }

    // 2. Check Opt-In Keywords
    const optInKeywords = ['START', 'YES', 'SUBSCRIBE', 'OPTIN'];
    if (optInKeywords.includes(upperText)) {
      await this.repo.recordConsent(storeId, {
        phoneNumber: cleanPhone,
        optedIn: true,
        wording: 'Opted in via WhatsApp keyword START',
        source: 'whatsapp_keyword',
        visitorId: visitor.id,
      });

      await this.eventRepo.recordEvent(storeId, visitor.id, 'whatsapp_opt_in', {
        phone: cleanPhone,
        keyword: upperText,
        provider: config.provider,
      });

      const optInReply = `Welcome to ${brandName} on WhatsApp! 🎉 You're all set to receive product updates, personalized recommendations, and exclusive drops. How can we help you today?`;

      const sendRes = await provider.sendMessage({
        phoneNumberId: config.phone_number_id || undefined,
        apiEndpoint: config.wati_api_endpoint || undefined,
        channelPhoneNumber: config.display_phone_number || undefined,
        accessToken,
        to: cleanPhone,
        message: {
          type: 'text',
          text: { body: optInReply },
        },
      });

      if (sendRes.success) {
        await this.repo.addMessage(storeId, {
          conversationId: conversation.id,
          direction: 'outbound',
          content: optInReply,
          wamid: sendRes.messageId,
          status: 'sent',
        });
      }

      return { handled: true, replySent: true };
    }

    // 3. Two-Way AI Shopping Assistant
    const isBudgetExceeded = await this.budgetGuard.isBudgetExceeded(storeId);
    if (isBudgetExceeded) {
      const budgetMsg = `Thank you for reaching out to ${brandName}! Our automated assistant is currently experiencing high demand. Please visit our store directly or contact support.`;
      await provider.sendMessage({
        phoneNumberId: config.phone_number_id || undefined,
        apiEndpoint: config.wati_api_endpoint || undefined,
        channelPhoneNumber: config.display_phone_number || undefined,
        accessToken,
        to: cleanPhone,
        message: {
          type: 'text',
          text: { body: budgetMsg },
        },
      });
      return { handled: true, replySent: true };
    }

    // Load store context
    const [assistantSettings, storePolicies] = await Promise.all([
      this.merchantRepo.getAssistantSettings(storeId),
      this.merchantRepo.getStorePolicies(storeId),
    ]);

    // Search catalogue products grounded in query
    const searchWords = cleanText.split(/\s+/).filter(w => w.length > 2);
    const catalogSubset = await this.shopifyAdapter.searchProducts(storeId, {
      keywords: searchWords.length > 0 ? searchWords : undefined,
    });

    // Build chat history from recent messages
    const recentMessages = await this.repo.getMessages(storeId, conversation.id, 8);
    const chatHistory: ChatMessage[] = recentMessages.map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Generate response using existing IAiProvider
    const aiResponse = await this.aiProvider.generateResponse(chatHistory, {
      storeId,
      sessionId: conversation.id,
      catalogSubset: catalogSubset.slice(0, 4),
      storePolicies: {
        delivery_policy: storePolicies?.delivery_policy || '',
        returns_policy: storePolicies?.returns_policy || '',
        faq_content: storePolicies?.faq_content || '',
      },
      assistantSettings: {
        assistant_name: assistantSettings?.assistant_name || `${brandName} Assistant`,
        allowed_topics: assistantSettings?.allowed_topics || ['products', 'policies', 'orders'],
        custom_prompt: assistantSettings?.custom_prompt,
        knowledge_base: assistantSettings?.knowledge_base,
        support_contact: assistantSettings?.support_contact,
      },
    });

    // Record AI usage in ledger
    await this.budgetGuard.recordUsage(
      storeId,
      null,
      'gpt-4o-mini',
      aiResponse.input_tokens,
      aiResponse.output_tokens,
      aiResponse.estimated_cost_usd
    );

    // Send AI reply via WhatsApp
    const sendResult = await provider.sendMessage({
      phoneNumberId: config.phone_number_id || undefined,
      apiEndpoint: config.wati_api_endpoint || undefined,
      channelPhoneNumber: config.display_phone_number || undefined,
      accessToken,
      to: cleanPhone,
      message: {
        type: 'text',
        text: { body: aiResponse.content },
      },
    });

    if (sendResult.success) {
      await this.repo.addMessage(storeId, {
        conversationId: conversation.id,
        direction: 'outbound',
        content: aiResponse.content,
        wamid: sendResult.messageId,
        status: 'sent',
        aiGenerated: true,
        tokensUsed: aiResponse.input_tokens + aiResponse.output_tokens,
        costUsd: aiResponse.estimated_cost_usd,
      });

      await this.eventRepo.recordEvent(storeId, visitor.id, 'whatsapp_ai_response', {
        phone: cleanPhone,
        recommended_ids: aiResponse.recommended_product_ids,
        provider: config.provider,
      });

      await this.eventRepo.recordEvent(storeId, visitor.id, 'whatsapp_message_sent', {
        phone: cleanPhone,
        message_id: sendResult.messageId,
        provider: config.provider,
      });
    }

    return { handled: true, replySent: sendResult.success };
  }

  // ==========================================
  // 4. Status Updates Ingestion
  // ==========================================

  async handleStatusUpdate(params: {
    messageId: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    recipientId?: string;
    error?: any;
  }) {
    await this.repo.updateMessageStatus(params.messageId, params.status, params.error ? JSON.stringify(params.error) : undefined);
  }

  // ==========================================
  // 5. Abandoned Cart Recovery Engine
  // ==========================================

  async scheduleAbandonedCartRecovery(
    storeId: string,
    params: {
      phone: string;
      cartToken?: string;
      productId?: string;
      productTitle?: string;
      price?: number;
      currency?: string;
      checkoutUrl?: string;
      cartItems?: any[];
      visitorId?: string | null;
    }
  ): Promise<{ scheduled: boolean; skipped?: boolean; reason?: string; id?: string }> {
    const cleanPhone = params.phone.trim();
    if (!cleanPhone) {
      return { scheduled: false, skipped: true, reason: 'Missing customer phone number' };
    }

    // 2. Resolve Product Details
    let resolvedProductTitle = params.productTitle;
    let resolvedPrice = params.price;

    if (!resolvedProductTitle && params.productId) {
      const product = await this.shopifyAdapter.getProductDetails(storeId, params.productId);
      if (product) {
        resolvedProductTitle = product.title;
        resolvedPrice = product.price;
      }
    }

    // 3. Prevent duplicate scheduling via idempotency key
    const idempotencyKey = `${storeId}:${params.cartToken || cleanPhone}:${params.productId || 'cart'}`;

    const job = await this.repo.scheduleRecoveryJob(storeId, {
      phoneNumber: cleanPhone,
      visitorId: params.visitorId,
      cartToken: params.cartToken,
      productId: params.productId,
      productTitle: resolvedProductTitle,
      price: resolvedPrice,
      currency: params.currency || 'GBP',
      checkoutUrl: params.checkoutUrl,
      idempotencyKey,
    });

    return { scheduled: true, ...job };
  }

  async processRecoveryJob(storeId: string, jobId: string): Promise<{ success: boolean; status?: string; skipped_reason?: string; reason?: string }> {
    const config = await this.repo.getConfig(storeId);
    if (!config || config.status !== 'connected') {
      await this.repo.updateRecoveryJobStatus(storeId, jobId, 'cancelled', 'WhatsApp channel disconnected');
      return { success: false, reason: 'WhatsApp channel disconnected' };
    }

    const token = this.getDecryptedToken(config);
    if (!token && config.provider !== 'mock') {
      await this.repo.updateRecoveryJobStatus(storeId, jobId, 'cancelled', 'Missing credentials');
      return { success: false, reason: 'Missing credentials' };
    }

    const jobs = await this.repo.getPendingRecoveryJobs(storeId, 50);
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      return { success: false, reason: 'Recovery job not found or already processed' };
    }

    // 1. Verify consent is still active
    const hasConsent = await this.repo.hasConsent(storeId, job.phone_number);
    if (!hasConsent) {
      await this.repo.updateRecoveryJobStatus(storeId, jobId, 'cancelled', 'No active opt-in consent');
      return { success: true, status: 'skipped', skipped_reason: 'No active opt-in consent' };
    }

    // 2. Check if customer completed purchase
    let hasPurchased = false;
    if (job.visitor_id) {
      if (typeof (this.purchaseAdapter as any)?.hasVisitorPurchased === 'function') {
        hasPurchased = await (this.purchaseAdapter as any).hasVisitorPurchased(storeId, job.visitor_id, 24 * 60 * 60 * 1000);
      }
      if (!hasPurchased) {
        const purchaseEvents = await this.db.query(
          `SELECT id FROM events 
           WHERE store_id = $1 AND visitor_id = $2 AND type = 'purchase_completed'
           AND created_at >= NOW() - INTERVAL '24 hours'
           LIMIT 1`,
          [storeId, job.visitor_id]
        );
        if (purchaseEvents.rows.length > 0) {
          hasPurchased = true;
        }
      }
    }
    if (!hasPurchased && job.cart_token) {
      const orderMatch = await this.db.query(
        `SELECT id FROM events 
         WHERE store_id = $1 AND type = 'purchase_completed' 
         AND (payload::text LIKE $2 OR (payload->>'phone') = $3)
         LIMIT 1`,
        [storeId, `%${job.cart_token}%`, job.phone_number]
      );
      if (orderMatch.rows.length > 0) {
        hasPurchased = true;
      }
    }
    if (hasPurchased) {
      await this.repo.updateRecoveryJobStatus(storeId, jobId, 'cancelled', 'Order already completed');
      return { success: true, status: 'skipped', skipped_reason: 'Order already completed' };
    }

    const store = await this.merchantRepo.getStoreById(storeId);
    const brandName = store?.brand_name || 'Our Store';
    const currency = job.currency || 'GBP';
    const priceFormatted = job.price ? `${currency} ${Number(job.price).toFixed(2)}` : '';

    // Grounded recovery message
    const itemDesc = job.product_title ? `the ${job.product_title}${priceFormatted ? ` (${priceFormatted})` : ''}` : 'your selected items';
    const linkPart = job.checkout_url ? `\n\nComplete your order here: ${job.checkout_url}` : '';
    const recoveryText = `Hi there! 👋 We noticed you left ${itemDesc} in your cart at ${brandName}. They're still reserved for you.${linkPart}\n\nReply to this message if you have any questions before ordering!`;

    const provider = this.getProviderForConfig(config);
    const sendResult = await provider.sendMessage({
      phoneNumberId: config.phone_number_id || undefined,
      apiEndpoint: config.wati_api_endpoint || undefined,
      channelPhoneNumber: config.display_phone_number || undefined,
      accessToken: token,
      to: job.phone_number,
      message: {
        type: 'text',
        text: { body: recoveryText },
      },
    });

    if (!sendResult.success) {
      await this.repo.updateRecoveryJobStatus(storeId, jobId, 'failed', sendResult.error || 'Failed to dispatch');
      return { success: false, reason: sendResult.error };
    }

    // Mark job sent
    await this.repo.updateRecoveryJobStatus(storeId, jobId, 'sent');

    // Record conversation message
    const conv = await this.repo.getOrCreateConversation(storeId, job.phone_number, job.visitor_id);
    await this.repo.addMessage(storeId, {
      conversationId: conv.id,
      direction: 'outbound',
      content: recoveryText,
      wamid: sendResult.messageId,
      status: 'sent',
    });

    // Record event
    if (job.visitor_id) {
      await this.eventRepo.recordEvent(storeId, job.visitor_id, 'whatsapp_recovery_sent', {
        job_id: job.id,
        phone: job.phone_number,
        product_id: job.product_id,
        provider: config.provider,
      });
    }

    return { success: true, status: 'sent' };
  }

  // ==========================================
  // 6. Order / Delivery Transactional Notifications
  // ==========================================

  async processOrderNotification(
    storeId: string,
    params: {
      orderNumber: string;
      phone: string;
      totalPrice: number | string;
      currency?: string;
      customerName?: string;
      trackingUrl?: string;
      itemsCount?: number;
      isFulfillment?: boolean;
    }
  ): Promise<{ success: boolean; reason?: string }> {
    const config = await this.repo.getConfig(storeId);
    if (!config || config.status !== 'connected') {
      return { success: false, reason: 'WhatsApp channel not configured or disconnected' };
    }

    const token = this.getDecryptedToken(config);
    if (!token && config.provider !== 'mock') {
      return { success: false, reason: 'WhatsApp credentials missing' };
    }

    if (!params.phone) {
      return { success: false, reason: 'Order has no customer phone number' };
    }

    const store = await this.merchantRepo.getStoreById(storeId);
    const brandName = store?.brand_name || 'Our Store';
    const currency = params.currency || 'GBP';
    const nameGreeting = params.customerName ? `Hi ${params.customerName}!` : 'Hi!';

    const displayOrderNum = params.orderNumber.startsWith('#') ? params.orderNumber : `#${params.orderNumber}`;
    let notificationText: string;
    if (params.isFulfillment) {
      const trackPart = params.trackingUrl ? `\nTrack delivery: ${params.trackingUrl}` : '';
      notificationText = `${nameGreeting} 🚚 Great news! Your order ${displayOrderNum} from ${brandName} is on its way.${trackPart}\n\nThank you for shopping with us!`;
    } else {
      notificationText = `${nameGreeting} 🎉 Thank you for your order ${displayOrderNum} at ${brandName}! Total: ${currency} ${params.totalPrice}.\n\nWe'll notify you as soon as your package ships.`;
    }

    const provider = this.getProviderForConfig(config);
    const sendRes = await provider.sendMessage({
      phoneNumberId: config.phone_number_id || undefined,
      apiEndpoint: config.wati_api_endpoint || undefined,
      channelPhoneNumber: config.display_phone_number || undefined,
      accessToken: token,
      to: params.phone.trim(),
      message: {
        type: 'text',
        text: { body: notificationText },
      },
    });

    if (sendRes.success) {
      const conv = await this.repo.getOrCreateConversation(storeId, params.phone.trim(), null, params.customerName);
      await this.repo.addMessage(storeId, {
        conversationId: conv.id,
        direction: 'outbound',
        content: notificationText,
        wamid: sendRes.messageId,
        status: 'sent',
      });
    }

    return { success: sendRes.success, reason: sendRes.error };
  }

  // ==========================================
  // 7. Dashboard Analytics & Data Retrieval
  // ==========================================

  async getConversations(storeId: string, limit = 50, offset = 0) {
    return this.repo.getConversations(storeId, limit, offset);
  }

  async getConversationMessages(storeId: string, conversationId: string, limit = 100) {
    return this.repo.getMessages(storeId, conversationId, limit);
  }

  async getConsents(storeId: string, limit = 50, offset = 0) {
    return this.repo.getConsents(storeId, limit, offset);
  }

  async revokeConsent(storeId: string, phone: string, reason = 'merchant_dashboard_revocation') {
    return this.repo.revokeConsent(storeId, phone, reason);
  }

  async revokeConsentById(storeId: string, consentId: string, reason = 'merchant_dashboard_revocation') {
    return this.repo.revokeConsentById(storeId, consentId, reason);
  }

  async getAnalytics(storeId: string) {
    return this.repo.getAnalyticsSummary(storeId);
  }
}
