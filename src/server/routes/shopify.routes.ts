import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { WebhookService } from '../../modules/events/webhook.service';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      shopDomain?: string;
    }
  }
}

const router = Router();

// Verify Shopify HMAC middleware
const verifyShopifyWebhook = (req: Request, res: Response, next: NextFunction): void => {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  const shopDomain = req.get('X-Shopify-Shop-Domain');

  if (!hmacHeader || !shopDomain) {
    res.status(401).json({ error: 'Missing Shopify headers' });
    return;
  }

  const env = getEnvConfig();
  const secret = env.SHOPIFY_CLIENT_SECRET;

  if (!req.rawBody) {
    res.status(500).json({ error: 'Raw body not captured. Check express.json configuration.' });
    return;
  }

  const generatedHash = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('base64');

  if (generatedHash !== hmacHeader) {
    logger.warn(`HMAC validation failed for webhook from ${shopDomain}`);
    // In a real app we'd block here. For local testing with simulated payloads, we might want to bypass or mock it.
    // However, the test should generate the correct HMAC so we can enforce it.
    res.status(401).json({ error: 'HMAC validation failed' });
    return;
  }

  req.shopDomain = shopDomain;
  next();
};

router.post('/webhooks/orders', verifyShopifyWebhook, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const shopDomain = req.shopDomain!;
    const webhookService = new WebhookService();
    await webhookService.processOrderWebhook(shopDomain, req.body);
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Failed to process order webhook', err);
    // Return 200 so Shopify stops retrying if it's a fatal error, 
    // or 500 if we want them to retry. We'll use 500 for now.
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
