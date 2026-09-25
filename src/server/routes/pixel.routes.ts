import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { EventRepository } from '../../modules/events/event.repository';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { checkRateLimit } from '../../modules/ai_agent/rate_limiter';
import {
  PIXEL_EVENT_TYPES,
  isDuplicatePixelEvent,
  notePixelEvent,
  pixelPayload,
  resolvePixelVisitor,
} from '../../modules/shopify_data/pixel';

/**
 * Public endpoint for the Shopify custom pixel (mounted at /api/v1/pixel).
 * Custom pixels run in a sandboxed iframe with no page origin, so the store is identified
 * by its public widget key only; events are limited to four types and a per-IP rate.
 */
export const pixelRouter = Router();

const PixelEventSchema = z.object({
  // Any 8-4-4-4-12 hex id (the column is a Postgres UUID; older keys are not RFC version-4)
  widget_key: z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  event: z.enum(['product_viewed', 'product_added_to_cart', 'checkout_started', 'checkout_completed']),
  visitor_id: z.string().max(100).nullable().optional(),
  client_id: z.string().max(200).nullable().optional(),
  data: z.record(z.string(), z.any()).optional(),
});

const PIXEL_RATE_LIMIT = { maxRequests: 120, windowMs: 60 * 1000 };

pixelRouter.post('/events', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = PixelEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid pixel event' });
      return;
    }
    const input = parsed.data;
    if (!checkRateLimit(`pixel:${req.ip}`, PIXEL_RATE_LIMIT).allowed) {
      res.status(429).json({ success: false, error: 'Too many events' });
      return;
    }

    const db = getDatabaseClient();
    const store = await new MerchantRepository(db).getStoreByWidgetKey(input.widget_key);
    if (!store || store.status !== 'active') {
      res.status(401).json({ success: false, error: 'Unknown store' });
      return;
    }

    const visitorId = await resolvePixelVisitor(db, store.id, input.visitor_id, input.client_id);
    if (!visitorId) {
      res.status(202).json({ success: true, recorded: false });
      return;
    }

    const type = PIXEL_EVENT_TYPES[input.event];
    const payload = pixelPayload(input.event, input.data || {});
    if (await isDuplicatePixelEvent(db, store.id, visitorId, type, payload)) {
      await notePixelEvent(db, store.id, input.event).catch(() => undefined);
      res.status(202).json({ success: true, recorded: false, duplicate: true });
      return;
    }

    await new EventRepository(db).recordEvent(store.id, visitorId, type, payload, null);
    await notePixelEvent(db, store.id, input.event).catch(() => undefined);
    res.status(202).json({ success: true, recorded: true });
  } catch (err) {
    next(err);
  }
});
