import { Router, Request, Response, NextFunction } from 'express';
import { AttributionService } from '../../modules/attribution/attribution.service';
import { getDatabaseClient } from '../../database/client';
import { ValidationError, TenantIsolationError } from '../../utils/errors';
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
publicAttributionRouter.post('/touchpoint', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      store_id,
      visitor_id,
      session_id,
      touchpoint_type,
      source,
      medium,
      campaign,
      content,
      term,
      fbclid,
      gclid,
      ttclid,
      landing_page_url,
      referrer_url,
    } = req.body;

    if (!store_id) {
      throw new ValidationError('store_id is required');
    }
    if (!visitor_id) {
      throw new ValidationError('visitor_id is required');
    }

    const db = (req as any).db || getDatabaseClient();

    // Verify store exists
    const storeRes = await db.query('SELECT id FROM stores WHERE id = $1', [store_id]);
    if (storeRes.rows.length === 0) {
      throw new TenantIsolationError(`Store not found: ${store_id}`);
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
      landingPageUrl: landing_page_url,
      referrerUrl: referrer_url,
    });

    res.status(201).json({
      success: true,
      data: touchpoint,
    });
  } catch (err) {
    next(err);
  }
});
