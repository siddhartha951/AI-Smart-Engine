import { Router, Request, Response, NextFunction } from 'express';
import { getDatabaseClient } from '../../database/client';
import { EventRepository } from '../../modules/events/event.repository';
import { createStoreAuthMiddleware } from '../middlewares/store-auth.middleware';
import { validateStoreOrigin } from '../middlewares/cors.middleware';
import { z } from 'zod';

const router = Router();

router.get('/bootstrap', (req, res, next) => createStoreAuthMiddleware()(req, res, next), validateStoreOrigin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.storeId!;
    const db = getDatabaseClient();

    // Check if agent is active
    const agentRes = await db.query('SELECT is_active, tone, welcome_message FROM assistant_settings WHERE store_id = $1', [storeId]);
    const agent = agentRes.rows[0] || { is_active: false };

    if (!agent.is_active) {
      res.status(403).json({ error: 'Agent is currently paused' });
      return;
    }

    const widgetRes = await db.query('SELECT * FROM widget_settings WHERE store_id = $1', [storeId]);
    const policiesRes = await db.query('SELECT delivery_policy, returns_policy, faq_content FROM store_policies WHERE store_id = $1', [storeId]);
    
    res.json({
      success: true,
      config: {
        agent: {
          tone: agent.tone,
          welcome_message: agent.welcome_message
        },
        widget: widgetRes.rows[0] || {},
        policies: policiesRes.rows[0] || {}
      }
    });
  } catch (err) {
    next(err);
  }
});

const EventSchema = z.object({
  widget_key: z.string().uuid(),
  session_id: z.string().optional(),
  visitor_id: z.string().uuid(),
  type: z.enum([
    'widget_opened',
    'product_click',
    'add_to_cart',
    'purchase_signal',
    'unsubscribe',
    'email_submitted',
    'marketing_opted_in',
    'recommendation_shown'
  ]),
  payload: z.record(z.string(), z.any()).optional()
});

router.post('/events', (req, res, next) => createStoreAuthMiddleware()(req, res, next), validateStoreOrigin, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = EventSchema.parse(req.body);
    const storeId = req.storeId!;

    const eventRepo = new EventRepository();
    await eventRepo.recordEvent(storeId, input.visitor_id, input.type, input.payload || {}, input.session_id);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
