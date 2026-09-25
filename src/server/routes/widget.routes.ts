import { Router, Request, Response, NextFunction } from 'express';
import { getDatabaseClient } from '../../database/client';
import { EventRepository } from '../../modules/events/event.repository';
import { createStoreAuthMiddleware } from '../middlewares/store-auth.middleware';
import { validateStoreOrigin } from '../middlewares/cors.middleware';
import { z } from 'zod';
import { recordFeedback } from '../../modules/learning/learning.service';

const router = Router();

router.get('/bootstrap', (req, res, next) => createStoreAuthMiddleware()(req, res, next), validateStoreOrigin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.storeId!;
    const db = getDatabaseClient();

    // Check if agent is active
    const agentRes = await db.query('SELECT is_active, tone, welcome_message, assistant_name FROM assistant_settings WHERE store_id = $1', [storeId]);
    const agent = agentRes.rows[0] || { is_active: true, assistant_name: 'Mira' };

    if (agent.is_active === false) {
      res.status(403).json({ error: 'Agent is currently paused' });
      return;
    }

    const widgetRes = await db.query('SELECT * FROM widget_settings WHERE store_id = $1', [storeId]);
    const policiesRes = await db.query('SELECT delivery_policy, returns_policy, faq_content FROM store_policies WHERE store_id = $1', [storeId]);
    
    const rawWidget = widgetRes.rows[0] || {};
    const widget = {
      ...rawWidget,
      country_code: rawWidget.country_code || 'IN',
      avatar_persona: rawWidget.avatar_persona || 'female',
      avatar_url: rawWidget.avatar_url || '/assets/avatars/mira-3d.jpg',
      proactive_nudge_enabled: rawWidget.proactive_nudge_enabled !== false,
      proactive_nudge_interval_seconds: Number(rawWidget.proactive_nudge_interval_seconds || 60),
      offer_code: rawWidget.offer_code || '',
      offer_discount_percent: Number(rawWidget.offer_discount_percent || 0),
      offer_text: rawWidget.offer_text || '',
    };

    res.json({
      success: true,
      config: {
        agent: {
          tone: agent.tone,
          welcome_message: agent.welcome_message,
          assistant_name: agent.assistant_name || 'Mira'
        },
        widget,
        policies: policiesRes.rows[0] || {}
      }
    });
  } catch (err) {
    next(err);
  }
});

// 👍 / 👎 on an assistant reply: a 👎 puts the question on the merchant's "To teach" list
const FeedbackSchema = z.object({
  widget_key: z.string().min(1).optional(),
  session_id: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  question: z.string().max(2000).optional(),
  answer: z.string().max(8000).optional(),
});

router.post('/chat/feedback', (req, res, next) => createStoreAuthMiddleware()(req, res, next), validateStoreOrigin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = FeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid feedback' });
      return;
    }
    const storeId = req.storeId!;
    const db = getDatabaseClient();
    const session = await db.query('SELECT id FROM chat_sessions WHERE store_id = $1 AND id = $2', [storeId, parsed.data.session_id]);
    if (session.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    await recordFeedback(db, storeId, {
      surface: 'shopper',
      rating: parsed.data.rating,
      question: parsed.data.question,
      answer: parsed.data.answer,
      sessionId: parsed.data.session_id,
    });
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});

const EventSchema = z.object({
  widget_key: z.string().min(1),
  session_id: z.string().optional(),
  visitor_id: z.string().uuid(),
  type: z.enum([
    'page_view',
    'widget_opened',
    'product_click',
    'add_to_cart',
    'purchase_completed',
    'purchase_signal',
    'unsubscribe',
    'email_submitted',
    'marketing_opted_in',
    'recommendation_shown',
    'heartbeat',
    'product_view',
    'checkout_started'
  ]),
  payload: z.record(z.string(), z.any()).optional()
});

router.post('/events', (req, res, next) => createStoreAuthMiddleware()(req, res, next), validateStoreOrigin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = EventSchema.parse(req.body);
    const storeId = req.storeId!;

    const eventRepo = new EventRepository();
    await eventRepo.recordEvent(storeId, input.visitor_id, input.type, input.payload || {}, input.session_id);

    // Auto-schedule recovery sequence for abandoned cart if visitor consented
    if (input.type === 'add_to_cart') {
      try {
        const db = getDatabaseClient();
        const visitorRes = await db.query(
          `SELECT v.id, v.email, v.phone, mc.opted_in as email_opted_in, wc.opted_in as wa_opted_in
           FROM visitors v
           LEFT JOIN marketing_consents mc ON mc.store_id = v.store_id AND mc.visitor_id = v.id AND mc.opted_in = true
           LEFT JOIN whatsapp_consents wc ON wc.store_id = v.store_id AND wc.visitor_id = v.id AND wc.opted_in = true
           WHERE v.store_id = $1 AND v.id = $2`,
          [storeId, input.visitor_id]
        );
        const visitor = visitorRes.rows[0];
        if (visitor) {
          // Schedule email recovery job if email & consent exist
          if (visitor.email && visitor.email_opted_in) {
            const { EmailRepository } = await import('../../modules/email/email.repository');
            const emailRepo = new EmailRepository(db);
            const isSuppressed = await emailRepo.isSuppressed(storeId, visitor.email);
            if (!isSuppressed) {
              const delayMinutes = parseInt(process.env.EMAIL_STAGE_1_DELAY_MINUTES || '60', 10);
              const scheduledFor = new Date(Date.now() + delayMinutes * 60000);
              const pendingJob = await db.query(
                `SELECT id FROM email_campaign_events WHERE store_id = $1 AND visitor_id = $2 AND status = 'pending'`,
                [storeId, input.visitor_id]
              );
              if (pendingJob.rows.length === 0) {
                let sessionId = input.session_id;
                if (!sessionId) {
                  const sRes = await db.query(
                    `SELECT id FROM chat_sessions WHERE store_id = $1 AND visitor_id = $2 ORDER BY created_at DESC LIMIT 1`,
                    [storeId, input.visitor_id]
                  );
                  if (sRes.rows.length > 0) {
                    sessionId = sRes.rows[0].id;
                  } else {
                    const newS = await db.query(
                      `INSERT INTO chat_sessions (store_id, visitor_id, status) VALUES ($1, $2, 'active') RETURNING id`,
                      [storeId, input.visitor_id]
                    );
                    sessionId = newS.rows[0].id;
                  }
                }
                await emailRepo.scheduleRecoveryJob(storeId, input.visitor_id, sessionId!, 1, scheduledFor);
              }
            }
          }

          // Schedule WhatsApp recovery job if phone & consent exist
          if (visitor.phone && visitor.wa_opted_in) {
            const { WhatsAppService } = await import('../../modules/whatsapp/whatsapp.service');
            const waService = new WhatsAppService({ db });
            await waService.scheduleAbandonedCartRecovery(storeId, {
              visitorId: input.visitor_id,
              phone: visitor.phone,
              productId: input.payload?.product_id ? String(input.payload.product_id) : undefined,
              productTitle: input.payload?.title ? String(input.payload.title) : undefined,
              price: input.payload?.price ? parseFloat(String(input.payload.price)) : undefined,
              currency: input.payload?.currency ? String(input.payload.currency) : undefined,
            });
          }

        }
      } catch (err) {
        // Safe non-blocking error logging
        console.warn(`[WidgetEvents] Failed to schedule cart recovery for store ${storeId}:`, err);
      }
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

