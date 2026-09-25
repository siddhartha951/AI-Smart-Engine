import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { encryptString } from '../../utils/crypto';
import { AuditRepository } from '../../modules/merchant/audit.repository';
import { getDataStatus } from '../../modules/shopify_data/data-status.service';
import { syncStoreOrders } from '../../modules/shopify_data/orders-sync.service';
import { ensureWebhooks } from '../../modules/shopify_data/webhooks.service';
import { syncStoreMetaSpend } from '../../modules/shopify_data/meta-spend-sync';
import { buildPixelSnippet } from '../../modules/shopify_data/pixel';
import { ShopifyDataScheduler } from '../../modules/shopify_data/data-scheduler';

/**
 * Settings → Shopify connection: data status, sync now, webhook secret, storefront token,
 * pixel code. Mounted at /api/v1/dashboard/:storeId/shopify-data (store access enforced by
 * the parent). Secrets are write-only: they are encrypted on save and never returned.
 */
export const shopifyDataRouter = Router({ mergeParams: true });

function requestBaseUrl(req: Request): string {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

async function audit(req: Request, storeId: string, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await new AuditRepository(getDatabaseClient()).logAction(req.user!.id, storeId, action, 'store_credentials', {}, details);
  } catch {
    // audit never breaks the merchant's action
  }
}

shopifyDataRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const data = await getDataStatus(storeId, { refresh: req.query.refresh === '1' });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

shopifyDataRouter.post('/orders/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    // A few pages now so the request stays quick; the background sync continues from here
    const result = await syncStoreOrders(storeId, { maxPages: 4 });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

shopifyDataRouter.post('/webhooks/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const result = await ensureWebhooks(storeId, { baseUrl: requestBaseUrl(req) });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

shopifyDataRouter.post('/meta-spend/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const result = await syncStoreMetaSpend(storeId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

const SecretSchema = z.object({ secret: z.string().trim().min(16, 'Paste the full API secret key').max(200) }).strict();

shopifyDataRouter.put('/webhook-secret', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const parsed = SecretSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues[0]?.message || 'Invalid secret' } });
      return;
    }
    const db = getDatabaseClient();
    const updated = await db.query(
      'UPDATE store_credentials SET encrypted_webhook_secret = $2, updated_at = NOW() WHERE store_id = $1 RETURNING store_id',
      [storeId, encryptString(parsed.data.secret).encryptedString]
    );
    if (updated.rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Connect Shopify with an access token first.' } });
      return;
    }
    await audit(req, storeId, 'SHOPIFY_WEBHOOK_SECRET_SAVED', { saved: true });
    const webhooks = ShopifyDataScheduler.shouldRun()
      ? await ensureWebhooks(storeId, { baseUrl: requestBaseUrl(req) }).catch(() => null)
      : null;
    res.json({ success: true, data: { saved: true, webhooks } });
  } catch (err) {
    next(err);
  }
});

const StorefrontSchema = z.object({ token: z.string().trim().min(16, 'Paste the full Storefront API access token').max(500) }).strict();

shopifyDataRouter.put('/storefront-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const parsed = StorefrontSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: { message: parsed.error.issues[0]?.message || 'Invalid token' } });
      return;
    }
    const db = getDatabaseClient();
    const updated = await db.query(
      'UPDATE store_credentials SET encrypted_storefront_token = $2, updated_at = NOW() WHERE store_id = $1 RETURNING store_id',
      [storeId, encryptString(parsed.data.token).encryptedString]
    );
    if (updated.rows.length === 0) {
      res.status(400).json({ success: false, error: { message: 'Connect Shopify with an Admin API access token first.' } });
      return;
    }
    await audit(req, storeId, 'SHOPIFY_STOREFRONT_TOKEN_SAVED', { saved: true });
    res.json({ success: true, data: { saved: true } });
  } catch (err) {
    next(err);
  }
});

shopifyDataRouter.get('/pixel-snippet', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const storeRes = await getDatabaseClient().query('SELECT widget_key FROM stores WHERE id = $1', [storeId]);
    const widgetKey = storeRes.rows[0]?.widget_key;
    if (!widgetKey) {
      res.status(404).json({ success: false, error: { message: 'Store not found' } });
      return;
    }
    const base = (process.env.BASE_URL || process.env.APP_URL || '').trim() || requestBaseUrl(req);
    res.json({ success: true, data: { snippet: buildPixelSnippet(base, String(widgetKey)) } });
  } catch (err) {
    next(err);
  }
});
