import { Router, Request, Response, NextFunction } from 'express';
import { WebhookService } from '../../modules/events/webhook.service';
import { getDatabaseClient } from '../../database/client';
import { logger } from '../../utils/logger';
import { verifyShopifySignature } from '../../modules/shopify_data/webhooks.service';
import { mirrorOrderFromWebhook, noteWebhookReceived } from '../../modules/shopify_data/order-webhook';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      shopDomain?: string;
    }
  }
}

const router = Router();

// Verify the Shopify HMAC: the store's own custom-app secret first, then the platform secret
const verifyShopifyWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const shopDomain = req.get('X-Shopify-Shop-Domain');

  if (!hmacHeader || !shopDomain) {
    res.status(401).json({ error: 'Missing Shopify headers' });
    return;
  }

  if (!req.rawBody) {
    res.status(500).json({ error: 'Raw body not captured. Check express.json configuration.' });
    return;
  }

  try {
    if (!(await verifyShopifySignature(req.rawBody, String(hmacHeader), shopDomain))) {
      logger.warn(`HMAC validation failed for webhook from ${shopDomain}`);
      await noteWebhookReceived(getDatabaseClient(), shopDomain, req.get('X-Shopify-Topic') || '', false).catch(() => undefined);
      res.status(401).json({ error: 'HMAC validation failed' });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  req.shopDomain = shopDomain;
  await noteWebhookReceived(getDatabaseClient(), shopDomain, req.get('X-Shopify-Topic') || '', true).catch(() => undefined);
  next();
};

router.post('/webhooks/orders', verifyShopifyWebhook, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const shopDomain = req.shopDomain!;
    const webhookService = new WebhookService();
    await webhookService.processOrderWebhook(shopDomain, req.body);
    // The dashboard reads shopify_orders; a mirror failure must not make Shopify retry the whole order
    await mirrorOrderFromWebhook(getDatabaseClient(), shopDomain, req.body).catch((err) =>
      logger.warn(`Could not mirror order webhook for ${shopDomain}: ${err?.message || err}`)
    );
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Failed to process order webhook', err);
    // Return 200 so Shopify stops retrying if it's a fatal error, 
    // or 500 if we want them to retry. We'll use 500 for now.
    res.status(500).send('Internal Server Error');
  }
});

// Status, fulfilment, refund and cancellation changes keep the mirrored order current
router.post('/webhooks/orders-updated', verifyShopifyWebhook, async (req: Request, res: Response): Promise<void> => {
  try {
    await mirrorOrderFromWebhook(getDatabaseClient(), req.shopDomain!, req.body);
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Failed to process order update webhook', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/webhooks/products', verifyShopifyWebhook, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const shopDomain = req.shopDomain!;
    const webhookService = new WebhookService();
    await webhookService.processProductUpdateWebhook(shopDomain, req.body);
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Failed to process product webhook', err);
    res.status(500).send('Internal Server Error');
  }
});

export default router;
