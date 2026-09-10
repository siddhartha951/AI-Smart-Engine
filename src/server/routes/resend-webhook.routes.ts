import { Router, Request, Response, NextFunction } from 'express';
import { getDatabaseClient } from '../../database/client';
import { EmailRepository } from '../../modules/email/email.repository';
import { SenderDomainRepository } from '../../modules/email/sender-domain.repository';
import { logger } from '../../utils/logger';

const router = Router();

router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = req.body;
    if (!payload || !payload.type) {
      res.status(400).json({ error: 'Invalid webhook payload: missing event type' });
      return;
    }

    const eventType: string = payload.type.toLowerCase();
    const data = payload.data || {};
    const emailId = data.email_id || data.id || null;
    const recipient = Array.isArray(data.to) ? data.to[0] : (typeof data.to === 'string' ? data.to : null);

    const db = getDatabaseClient();
    const emailRepo = new EmailRepository(db);
    const domainRepo = new SenderDomainRepository(db);

    // 1. Resolve store_id
    let storeId: string | null = null;

    // Check tags
    if (Array.isArray(data.tags)) {
      const storeTag = data.tags.find((t: any) => t.name === 'store_id');
      if (storeTag && storeTag.value) {
        storeId = storeTag.value;
      }
    }

    // Check email_campaign_events by provider message id
    if (!storeId && emailId) {
      const jobRes = await db.query<{ store_id: string }>(
        `SELECT store_id FROM email_campaign_events WHERE provider_message_id = $1 LIMIT 1`,
        [emailId]
      );
      if (jobRes.rows.length > 0) {
        storeId = jobRes.rows[0].store_id;
      }
    }

    // Check sender domain if from address is provided
    if (!storeId && data.from) {
      const fromMatch = data.from.match(/@([a-zA-Z0-9.-]+)/);
      if (fromMatch) {
        const domainName = fromMatch[1];
        const domainRecord = await domainRepo.findByDomainName(domainName);
        if (domainRecord) {
          storeId = domainRecord.store_id;
        }
      }
    }

    if (!storeId) {
      logger.warn(`[ResendWebhook] Could not resolve store_id for webhook event ${eventType}`);
      res.status(200).json({ success: true, recorded: false, reason: 'Unresolved store_id' });
      return;
    }

    // 2. Record event in email_webhook_events
    await emailRepo.recordWebhookEvent(storeId, eventType, recipient || 'unknown', payload, emailId);
    logger.info(`[ResendWebhook] Recorded webhook event ${eventType} for store ${storeId}, recipient: ${recipient}`);

    // 3. Handle specific lifecycle events
    if (recipient) {
      if (eventType.includes('bounced') || eventType === 'email.bounced') {
        await emailRepo.addSuppression(storeId, recipient, 'bounced');
        await emailRepo.cancelVisitorJobsByEmail(storeId, recipient, 'Cancelled: recipient email bounced');
        logger.info(`[ResendWebhook] Added ${recipient} to suppression list (bounced) for store ${storeId}`);
      } else if (eventType.includes('complained') || eventType === 'email.complained') {
        await emailRepo.addSuppression(storeId, recipient, 'complained');
        await emailRepo.cancelVisitorJobsByEmail(storeId, recipient, 'Cancelled: recipient registered spam complaint');
        logger.info(`[ResendWebhook] Added ${recipient} to suppression list (complaint) for store ${storeId}`);
      }
    }

    res.status(200).json({ success: true, recorded: true, store_id: storeId, event: eventType });
  } catch (err) {
    next(err);
  }
});

export default router;
