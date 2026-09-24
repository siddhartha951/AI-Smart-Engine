import { Router, Request, Response } from 'express';
import { getDatabaseClient } from '../../database/client';
import { getWhatsAppProvider } from '../../providers/whatsapp';
import { WhatsAppService } from '../../modules/whatsapp/whatsapp.service';
import { WhatsAppRepository } from '../../modules/whatsapp/whatsapp.repository';
import { timingSafeEqualStr, verifyMetaSignature } from '../../utils/webhook-signature';

const router = Router();

/**
 * GET /api/v1/webhooks/whatsapp
 * Meta WhatsApp Cloud API Webhook Challenge Verification.
 */
router.get('/', async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  if (!mode || !token || !challenge) {
    res.status(400).send('Missing webhook verification parameters');
    return;
  }

  const db = getDatabaseClient();
  const provider = getWhatsAppProvider();

  // 1. Check if token matches any store's configured webhook_verify_token
  const storeRes = await db.query<{ webhook_verify_token: string }>(
    `SELECT webhook_verify_token FROM whatsapp_configs WHERE webhook_verify_token = $1 LIMIT 1`,
    [token]
  );

  const envVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'ai_smart_engine_wa_secret';
  const isValid = (storeRes.rows.length > 0) || (token === envVerifyToken);

  if (isValid && mode === 'subscribe') {
    const verifiedChallenge = provider.verifyWebhookChallenge(mode, token, challenge, token);
    if (verifiedChallenge) {
      res.status(200).send(verifiedChallenge);
      return;
    }
  }

  res.status(403).send('Forbidden: Webhook verification failed');
});

/**
 * POST /api/v1/webhooks/whatsapp
 * Ingests incoming WhatsApp Cloud API messages and delivery statuses.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabaseClient();
    const provider = getWhatsAppProvider();
    const service = new WhatsAppService({ db, whatsappProvider: provider });

    const events = provider.parseWebhook(req.body);

    // X-Hub-Signature-256 check with the platform app secret, or the store's own app
    // secret. Stores that never saved one keep working unsigned, as before.
    const repo = new WhatsAppRepository(db);
    const phoneIds = [...new Set(events.map(e => e.phoneNumberId).filter(Boolean) as string[])];
    const secrets = process.env.WHATSAPP_APP_SECRET
      ? [process.env.WHATSAPP_APP_SECRET]
      : (await Promise.all(phoneIds.map(id => repo.findConfigByPhoneNumberId(id))))
          .map(c => c?.app_secret || '')
          .filter(Boolean);
    if (secrets.length > 0) {
      const signature = req.header('x-hub-signature-256');
      const raw = (req as any).rawBody || JSON.stringify(req.body || {});
      if (!secrets.some(secret => verifyMetaSignature(raw, signature, secret))) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }
    }

    for (const evt of events) {
      if (evt.message && evt.phoneNumberId) {
        await service.handleIncomingMessage({
          phoneNumberId: evt.phoneNumberId,
          from: evt.message.from,
          customerName: evt.customerName,
          text: evt.message.text || evt.message.buttonPayload,
          messageId: evt.message.messageId,
          timestamp: evt.message.timestamp,
          wabaId: evt.wabaId,
        });
      } else if (evt.status) {
        await service.handleStatusUpdate({
          messageId: evt.status.messageId,
          status: evt.status.status,
          recipientId: evt.status.recipientId,
        });
      }
    }

    res.status(200).json({ status: 'received' });
  } catch (err) {
    console.error('[WhatsAppWebhook] Error handling webhook payload:', err);
    res.status(200).json({ status: 'received', error: (err as any).message });
  }
});

/**
 * POST /api/v1/webhooks/whatsapp/wati/:storeId
 * Ingests incoming WATI messages and delivery statuses for a specific store.
 */
router.post('/wati/:storeId', async (req: Request, res: Response) => {
  const storeId = req.params.storeId as string;
  const token = (req.query.token as string) || (req.headers['x-wati-token'] as string);

  const db = getDatabaseClient();
  const repo = new WhatsAppRepository(db);
  const config = await repo.getConfig(storeId);

  if (!config || config.status !== 'connected' || (config.provider !== 'wati' && config.provider !== 'mock')) {
    res.status(403).json({ error: 'Forbidden: Store not found or WATI not connected' });
    return;
  }

  // Verify webhook token if configured
  if (config.webhook_verify_token) {
    if (!token || !timingSafeEqualStr(token, config.webhook_verify_token)) {
      res.status(403).json({ error: 'Forbidden: Invalid WATI webhook token' });
      return;
    }
  }

  try {
    const service = new WhatsAppService({ db });
    const provider = service.getProviderForConfig(config);
    const events = provider.parseWebhook(req.body);

    for (const evt of events) {
      if (evt.message) {
        await service.handleIncomingMessage({
          storeId,
          phoneNumberId: evt.phoneNumberId || config.display_phone_number || undefined,
          from: evt.message.from,
          customerName: evt.customerName,
          text: evt.message.text || evt.message.buttonPayload,
          messageId: evt.message.messageId,
          timestamp: evt.message.timestamp,
        });
      } else if (evt.status) {
        await service.handleStatusUpdate({
          messageId: evt.status.messageId,
          status: evt.status.status,
          recipientId: evt.status.recipientId,
        });
      }
    }

    res.status(200).json({ status: 'received' });
  } catch (err: any) {
    console.error('[WATIWebhook] Error processing webhook payload:', err);
    res.status(200).json({ status: 'received', error: err.message });
  }
});

export default router;
