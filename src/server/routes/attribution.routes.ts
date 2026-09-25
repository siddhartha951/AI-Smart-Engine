import { Router, Request, Response, NextFunction } from 'express';
import { AttributionService } from '../../modules/attribution/attribution.service';
import { getDatabaseClient } from '../../database/client';
import { ValidationError } from '../../utils/errors';
import { AttributionModel } from '../../database/types';

export const attributionRouter = Router({ mergeParams: true });
export const publicAttributionRouter = Router();

// ==========================================
// 1. Merchant Dashboard Attribution Routes
// (Guarded by enforceStoreAccess)
// ==========================================

// GET /api/v1/dashboard/:storeId/attribution/overview
attributionRouter.get('/overview', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const model = (req.query.model as AttributionModel) || 'last_touch';
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    const db = (req as any).db || getDatabaseClient();
    const service = new AttributionService({ db });

    const overview = await service.getOverview(storeId, model, { fromDate, toDate });
    res.json({
      success: true,
      data: overview,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/:storeId/attribution/channels
attributionRouter.get('/channels', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const model = (req.query.model as AttributionModel) || 'last_touch';
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    const db = (req as any).db || getDatabaseClient();
    const service = new AttributionService({ db });

    const channels = await service.getChannelPerformance(storeId, model, { fromDate, toDate });
    res.json({
      success: true,
      data: { channels },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/:storeId/attribution/campaigns
attributionRouter.get('/campaigns', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const model = (req.query.model as AttributionModel) || 'last_touch';
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    const db = (req as any).db || getDatabaseClient();
    const service = new AttributionService({ db });

    const campaigns = await service.getCampaignPerformance(storeId, model, { fromDate, toDate });
    res.json({
      success: true,
      data: { campaigns },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/:storeId/attribution/orders?limit=20
// Most recent attributed orders for the "Attributed orders" table (each opens its journey)
attributionRouter.get('/orders', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const db = (req as any).db || getDatabaseClient();
    const result = await db.query(
      `SELECT order_id, order_number, order_revenue, currency, first_touch_source, first_touch_campaign,
              last_touch_source, last_touch_campaign, is_ai_assisted, touchpoint_count, order_created_at
       FROM order_attributions
       WHERE store_id = $1
       ORDER BY order_created_at DESC
       LIMIT $2`,
      [storeId, limit]
    );
    res.json({
      success: true,
      data: {
        orders: result.rows.map((r: any) => ({
          order_id: r.order_id,
          order_number: r.order_number,
          revenue: Number(r.order_revenue || 0),
          currency: r.currency,
          first_touch: r.first_touch_source || 'direct',
          first_touch_campaign: r.first_touch_campaign,
          last_touch: r.last_touch_source || 'direct',
          last_touch_campaign: r.last_touch_campaign,
          is_ai_assisted: r.is_ai_assisted === true,
          touchpoints: Number(r.touchpoint_count || 0),
          created_at: r.order_created_at,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/:storeId/attribution/journey/:orderId
attributionRouter.get('/journey/:orderId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const orderId = req.params.orderId as string;

    const db = (req as any).db || getDatabaseClient();
    const service = new AttributionService({ db });

    const journey = await service.getCustomerJourney(storeId, orderId);
    if (!journey) {
      res.status(404).json({ success: false, error: 'Journey or order not found' });
      return;
    }

    res.json({
      success: true,
      data: journey,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/:storeId/attribution/spend
attributionRouter.get('/spend', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const platform = req.query.platform as string | undefined;
    const campaign = req.query.campaign as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const db = (req as any).db || getDatabaseClient();
    const service = new AttributionService({ db });

    const spendData = await service.listAdSpend(storeId, {
      fromDate,
      toDate,
      platform,
      campaign,
      limit,
      offset,
    });

    res.json({
      success: true,
      data: spendData,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/dashboard/:storeId/attribution/spend
attributionRouter.post('/spend', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const service = new AttributionService({ db });

    const { spendDate, platform, campaign, spendAmount, currency, notes } = req.body;

    const created = await service.createAdSpend(storeId, {
      spendDate,
      platform,
      campaign: campaign || 'general',
      spendAmount: parseFloat(spendAmount),
      currency: currency || 'GBP',
      notes,
    });

    res.status(201).json({
      success: true,
      data: created,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/dashboard/:storeId/attribution/spend/:id
attributionRouter.delete('/spend/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const id = req.params.id as string;

    const db = (req as any).db || getDatabaseClient();
    const service = new AttributionService({ db });

    const deleted = await service.deleteAdSpend(storeId, id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Spend record not found' });
      return;
    }

    res.json({
      success: true,
      message: 'Ad spend record deleted',
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 2. Public Storefront Touchpoint Route
// ==========================================

// POST /api/v1/attribution/touchpoint
// Public storefront beacon. This endpoint must NEVER hard-fail on stale
// identifiers: merchants can embed an outdated store_id in their theme
// snippet, and the widget can send session/visitor ids restored from browser
// storage after a DB reset. Unknown references are dropped gracefully with a
// warning instead of a 403/500 that spams the server logs.
const TOUCHPOINT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

publicAttributionRouter.post('/touchpoint', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body || {};
    const {
      store_id,
      visitor_id,
      session_id,
      touchpoint_type,
      fbclid,
      gclid,
      ttclid,
    } = body;

    if (!store_id) {
      throw new ValidationError('store_id is required');
    }
    if (!visitor_id) {
      throw new ValidationError('visitor_id is required');
    }

    const db = (req as any).db || getDatabaseClient();

    // The storefront widget sends utm_* field names; accept both the
    // canonical names and the utm_* aliases so attribution data is not
    // silently recorded with null source/medium/campaign.
    const source = body.source ?? body.utm_source;
    const medium = body.medium ?? body.utm_medium;
    const campaign = body.campaign ?? body.utm_campaign;
    const content = body.content ?? body.utm_content;
    const term = body.term ?? body.utm_term;
    const landingPageUrl = body.landing_page_url ?? body.landing_page;
    const referrerUrl = body.referrer_url ?? body.referrer;

    // Verify store exists — drop gracefully on unknown/stale store ids
    if (!TOUCHPOINT_UUID_RE.test(String(store_id))) {
      console.warn(`[Attribution] Dropping touchpoint with malformed store_id ${store_id}`);
      res.status(200).json({ success: true, dropped: true, reason: 'unknown_store' });
      return;
    }
    const storeRes = await db.query('SELECT id FROM stores WHERE id = $1', [store_id]);
    if (storeRes.rows.length === 0) {
      console.warn(`[Attribution] Dropping touchpoint for unknown store_id ${store_id}`);
      res.status(200).json({ success: true, dropped: true, reason: 'unknown_store' });
      return;
    }

    // Verify visitor exists and belongs to the store — drop gracefully otherwise
    if (!TOUCHPOINT_UUID_RE.test(String(visitor_id))) {
      console.warn(`[Attribution] Dropping touchpoint with malformed visitor_id ${visitor_id} for store ${store_id}`);
      res.status(200).json({ success: true, dropped: true, reason: 'unknown_visitor' });
      return;
    }
    const visitorRes = await db.query('SELECT id FROM visitors WHERE id = $1 AND store_id = $2', [visitor_id, store_id]);
    if (visitorRes.rows.length === 0) {
      console.warn(`[Attribution] Dropping touchpoint for unknown visitor ${visitor_id} in store ${store_id}`);
      res.status(200).json({ success: true, dropped: true, reason: 'unknown_visitor' });
      return;
    }

    const service = new AttributionService({ db });
    const touchpoint = await service.recordTouchpoint(store_id, {
      visitorId: visitor_id,
      sessionId: session_id || null,
      touchpointType: touchpoint_type || 'landing',
      source,
      medium,
      campaign,
      content,
      term,
      fbclid,
      gclid,
      ttclid,
      landingPageUrl,
      referrerUrl,
    });

    res.status(201).json({
      success: true,
      data: touchpoint,
    });
  } catch (err) {
    next(err);
  }
});
