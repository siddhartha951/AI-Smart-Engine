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

      // 2. We need to tie the order to a visitor.
      // In Shopify, orderData.email or orderData.customer.email is usually available.
      // Or we can rely on the Cart Token if available.
      // For Phase 10 MVP, let's just record the event generally if we can't find a visitor.
      // But eventRepo requires visitor_id. 
      // If no visitor is found by email, we might create a ghost visitor or skip.
      const customerEmail = orderData.email || orderData.contact_email || orderData.customer?.email;
      let visitorId = null;

      if (customerEmail) {
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

      // Record purchase event
      await this.eventRepo.recordEvent(storeId, visitorId, 'purchase_completed', {
        order_id: orderData.id,
        order_number: orderData.order_number,
        total_price: orderData.total_price,
        currency: orderData.currency,
        line_items: orderData.line_items?.map((item: any) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          title: item.title,
          price: item.price,
          quantity: item.quantity
        }))
      });

      logger.info(`Processed order webhook for store ${storeId}, order ${orderData.order_number}`);
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
