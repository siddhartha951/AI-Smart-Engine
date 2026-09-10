import { getDatabaseClient } from '../../database/client';
import { EventRepository } from './event.repository';
import { logger } from '../../utils/logger';

export class WebhookService {
  constructor(private eventRepo: EventRepository = new EventRepository()) {}

  async processOrderWebhook(shopDomain: string, orderData: any): Promise<void> {
    try {
      const db = getDatabaseClient();
      
      // 1. Find store by shop_domain
      const storeRes = await db.query('SELECT id FROM stores WHERE shop_domain = $1', [shopDomain]);
      if (storeRes.rows.length === 0) {
        logger.warn(`Received webhook for unknown shop domain: ${shopDomain}`);
        return;
      }
      const storeId = storeRes.rows[0].id;

      // 2. Extract UTM and session attribution from note_attributes or landing_site
      let noteVisitorId: string | null = null;
      let noteSessionId: string | null = null;
      let utmSource = 'shopify_order';
      let utmMedium = 'storefront';
      let utmCampaign = 'general';

      if (Array.isArray(orderData.note_attributes)) {
        for (const attr of orderData.note_attributes) {
          if (attr.name === '_ai_visitor_id' || attr.name === 'ai_visitor_id') {
            noteVisitorId = attr.value;
          }
          if (attr.name === '_ai_session_id' || attr.name === 'ai_session_id') {
            noteSessionId = attr.value;
          }
          if (attr.name === 'utm_source') utmSource = attr.value;
          if (attr.name === 'utm_medium') utmMedium = attr.value;
          if (attr.name === 'utm_campaign') utmCampaign = attr.value;
        }
      }

      if (orderData.landing_site && typeof orderData.landing_site === 'string') {
        try {
          const u = new URL(orderData.landing_site, 'https://example.com');
          if (u.searchParams.get('ai_sid')) noteSessionId = u.searchParams.get('ai_sid');
          if (u.searchParams.get('ai_vid')) noteVisitorId = u.searchParams.get('ai_vid');
          if (u.searchParams.get('utm_source')) utmSource = u.searchParams.get('utm_source')!;
          if (u.searchParams.get('utm_medium')) utmMedium = u.searchParams.get('utm_medium')!;
          if (u.searchParams.get('utm_campaign')) utmCampaign = u.searchParams.get('utm_campaign')!;
        } catch (_) {}
      }

      // 3. We need to tie the order to a visitor.
      let visitorId: string | null = null;

      if (noteVisitorId) {
        const visCheck = await db.query(
          'SELECT id FROM visitors WHERE store_id = $1 AND id = $2',
          [storeId, noteVisitorId]
        );
        if (visCheck.rows.length > 0) {
          visitorId = visCheck.rows[0].id;
        }
      }

      const customerEmail = orderData.email || orderData.contact_email || orderData.customer?.email;
      if (!visitorId && customerEmail) {
        const visitorRes = await db.query(
          'SELECT id FROM visitors WHERE store_id = $1 AND email = $2', 
          [storeId, customerEmail]
        );
        if (visitorRes.rows.length > 0) {
          visitorId = visitorRes.rows[0].id;
        }
      }

      if (!visitorId) {
        // Create a ghost visitor for the purchase
        const newVis = await db.query(
          'INSERT INTO visitors (store_id, email, anonymous_id) VALUES ($1, $2, $3) RETURNING id',
          [storeId, customerEmail, 'anon-' + Date.now()]
        );
        visitorId = newVis.rows[0].id;
      }

      if (!visitorId) return;

      // Record purchase event with UTM and session tracking
      await this.eventRepo.recordEvent(
        storeId, 
        visitorId, 
        'purchase_completed', 
        {
          order_id: orderData.id,
          order_number: orderData.order_number,
          total_price: orderData.total_price,
          currency: orderData.currency,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_campaign: utmCampaign,
          session_id: noteSessionId,
          line_items: orderData.line_items?.map((item: any) => ({
            product_id: item.product_id,
            variant_id: item.variant_id,
            title: item.title,
            price: item.price,
            quantity: item.quantity
          }))
        }, 
        noteSessionId
      );

      logger.info(`Processed order webhook for store ${storeId}, order ${orderData.order_number}, utm_source: ${utmSource}`);
    } catch (err) {
      logger.error('Error processing order webhook', err);
      throw err;
    }
  }

  async processProductUpdateWebhook(shopDomain: string, productData: any): Promise<void> {
    try {
      const db = getDatabaseClient();
      const storeRes = await db.query('SELECT id FROM stores WHERE shop_domain = $1', [shopDomain]);
      if (storeRes.rows.length === 0) {
        return;
      }
      const storeId = storeRes.rows[0].id;

      // In the future: trigger partial catalog sync or update cache
      logger.info(`Processed product update webhook for store ${storeId}, product ${productData.id}`);
    } catch (err) {
      logger.error('Error processing product update webhook', err);
      throw err;
    }
  }
}
