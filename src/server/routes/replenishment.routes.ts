import { Router, Request, Response, NextFunction } from 'express';
import { ReplenishmentService } from '../../modules/replenishment/replenishment.service';
import { ReplenishmentRepository } from '../../modules/replenishment/replenishment.repository';
import { getDatabaseClient } from '../../database/client';
import { ValidationError } from '../../utils/errors';

export const replenishmentRouter = Router({ mergeParams: true });
export const reorderClickRouter = Router();

// ==========================================
// 1. Replenishment Product Settings
// ==========================================

// GET /api/v1/dashboard/:storeId/replenishment/products
replenishmentRouter.get('/products', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const service = new ReplenishmentService({ db });

    const products = await service.listProductsWithSettings(storeId);
    res.json({
      success: true,
      data: { products },
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/dashboard/:storeId/replenishment/products/:productId
replenishmentRouter.put('/products/:productId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const productId = req.params.productId as string;
    const db = (req as any).db || getDatabaseClient();
    const service = new ReplenishmentService({ db });

    const { variantId, replenishable, cycleDays, reminderDaysBefore, enabled } = req.body;

    if (cycleDays === undefined || cycleDays === null) {
      throw new ValidationError('cycleDays is required');
    }

    const updated = await service.configureProduct(storeId, productId, {
      variantId: variantId || '',
      replenishable: Boolean(replenishable),
      cycleDays: Number(cycleDays),
      reminderDaysBefore: reminderDaysBefore !== undefined ? Number(reminderDaysBefore) : 5,
      enabled: enabled !== undefined ? Boolean(enabled) : true,
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/dashboard/:storeId/replenishment/product-settings (Manual selection & config)
replenishmentRouter.post('/product-settings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const service = new ReplenishmentService({ db });

    const { productId, variantId, replenishable, cycleDays, reminderDaysBefore, enabled } = req.body;
    if (!productId) {
      throw new ValidationError('productId is required');
    }
    if (cycleDays === undefined || cycleDays === null) {
      throw new ValidationError('cycleDays is required');
    }

    const updated = await service.configureProduct(storeId, productId, {
      variantId: variantId || '',
      replenishable: Boolean(replenishable),
      cycleDays: Number(cycleDays),
      reminderDaysBefore: reminderDaysBefore !== undefined ? Number(reminderDaysBefore) : 5,
      enabled: enabled !== undefined ? Boolean(enabled) : true,
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/dashboard/:storeId/replenishment/ai-recommendations
replenishmentRouter.get('/ai-recommendations', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const { AiAnalysisService } = await import('../../modules/ai/ai-analysis.service');
    const aiService = new AiAnalysisService({ db });

    const recommendations = await aiService.getReorderRecommendations(storeId);
    res.json({
      success: true,
      data: { recommendations },
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 2. Replenishment Channel Settings
// ==========================================

// GET /api/v1/dashboard/:storeId/replenishment/channel-settings
replenishmentRouter.get('/channel-settings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const repo = new ReplenishmentRepository(db);

    const settings = await repo.getChannelSettings(storeId);
    res.json({
      success: true,
      data: settings,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/dashboard/:storeId/replenishment/channel-settings
replenishmentRouter.put('/channel-settings', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const repo = new ReplenishmentRepository(db);

    const { emailEnabled, whatsappEnabled, discountCode, discountPercentage } = req.body;

    const updated = await repo.upsertChannelSettings(storeId, {
      emailEnabled,
      whatsappEnabled,
      discountCode,
      discountPercentage,
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 3. Replenishment Schedules
// ==========================================

// GET /api/v1/dashboard/:storeId/replenishment/schedules
replenishmentRouter.get('/schedules', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const repo = new ReplenishmentRepository(db);

    const status = req.query.status as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = await repo.listSchedules(storeId, { status, limit, offset });
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. Analytics & Manual Processing
// ==========================================

// GET /api/v1/dashboard/:storeId/replenishment/analytics
replenishmentRouter.get('/analytics', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const db = (req as any).db || getDatabaseClient();
    const repo = new ReplenishmentRepository(db);

    const analytics = await repo.getAnalytics(storeId);
    res.json({
      success: true,
      data: analytics,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/dashboard/:storeId/replenishment/process-due
replenishmentRouter.post('/process-due', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = (req as any).db || getDatabaseClient();
    const service = new ReplenishmentService({ db });

    // Merchant action: only this store's due reminders (the worker handles all stores)
    const result = await service.processDueReminders(50, req.params.storeId as string);
    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 5. Public Reorder Click Tracking
// ==========================================

// GET /api/v1/reorder/:storeId/:scheduleId/click
reorderClickRouter.get('/:storeId/:scheduleId/click', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const scheduleId = req.params.scheduleId as string;
    const db = (req as any).db || getDatabaseClient();
    const service = new ReplenishmentService({ db });

    const destinationUrl = await service.trackReorderClick(storeId, scheduleId);
    res.redirect(302, destinationUrl);
  } catch (err) {
    next(err);
  }
});
