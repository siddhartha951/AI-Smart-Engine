import { Router, Request, Response } from 'express';
import { getDatabaseClient } from '../../database/client';
import { getWhatsAppProvider } from '../../providers/whatsapp';
import { WhatsAppService } from '../../modules/whatsapp/whatsapp.service';

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

export default router;
