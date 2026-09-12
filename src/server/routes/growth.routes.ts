import { Router, Request, Response, NextFunction } from 'express';
import { GrowthService } from '../../modules/growth/growth.service';
import { ValidationError } from '../../utils/errors';

export const growthRouter = Router({ mergeParams: true });

function getService(): GrowthService {
  return new GrowthService();
}

// 1. Growth Overview
growthRouter.get('/overview', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const service = getService();
    const overview = await service.getOverview(storeId);
    res.json({ success: true, data: overview });
  } catch (err) {
    next(err);
  }
});

// 2. Today's Growth Actions
growthRouter.get('/actions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const service = getService();
    const actions = await service.getTodayActions(storeId);
    res.json({ success: true, data: actions });
  } catch (err) {
    next(err);
  }
});

// 3. Update Action Status (completed / dismissed)
growthRouter.post('/actions/:id/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const actionId = req.params.id as string;
    const { status, notes } = req.body;

    if (!status || !['pending', 'in_progress', 'completed', 'dismissed'].includes(status)) {
      throw new ValidationError('Invalid status. Must be pending, in_progress, completed, or dismissed');
    }

    const service = getService();
    const updated = await service.updateActionStatus(storeId, actionId, status, (req as any).user?.id, notes);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// 4. Action History
growthRouter.get('/history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const service = getService();
    const history = await service.getActionHistory(storeId);
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
});

// 5. Merchant Goal
growthRouter.get('/goal', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const service = getService();
    const goal = await service.getGoal(storeId);
    res.json({ success: true, data: goal });
  } catch (err) {
    next(err);
  }
});

growthRouter.put('/goal', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const { primary_goal, target_metric, target_value } = req.body;

    if (!primary_goal) {
      throw new ValidationError('primary_goal is required');
    }

    const service = getService();
    const updatedGoal = await service.setGoal(storeId, primary_goal, target_metric, target_value);
    res.json({ success: true, data: updatedGoal });
  } catch (err) {
    next(err);
  }
});

// 6. Weekly Growth Summary
growthRouter.get('/weekly-summary', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const service = getService();
    const summary = await service.getWeeklySummary(storeId);
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

// 7. AI Growth Explanation
growthRouter.post('/explain', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const service = getService();
    const explanation = await service.explainGrowth(storeId);
    res.json({ success: true, data: explanation });
  } catch (err) {
    next(err);
  }
});
