import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MetaAdsService } from '../../modules/meta_ads/meta_ads.service';
import { MetaDatePreset, MetaInsightLevel } from '../../providers/meta';
import { ValidationError } from '../../utils/errors';

/**
 * Meta Ads dashboard routes (mounted at /api/v1/dashboard/:storeId/meta-ads).
 * JWT + store-access + feature gating are applied by the parent dashboard router.
 */
export const metaAdsRouter = Router({ mergeParams: true });

function getService(): MetaAdsService {
  return new MetaAdsService();
}

const ConnectSchema = z.object({
  access_token: z.string().min(10, 'access_token is required'),
  ad_account_id: z.string().min(1).optional().nullable(),
});

const TestSchema = z.object({
  access_token: z.string().min(10, 'access_token is required'),
});

const InsightsQuerySchema = z.object({
  level: z.enum(['account', 'campaign', 'adset', 'ad']).optional().default('campaign'),
  date_preset: z
    .enum(['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d'])
    .optional()
    .default('last_30d'),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'since must be YYYY-MM-DD')
    .optional(),
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'until must be YYYY-MM-DD')
    .optional(),
  ad_account_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

// 1. Connection status (never includes the raw token)
metaAdsRouter.get('/config', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const status = await getService().getConnectionStatus(storeId);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

// 2. Connect / save credentials (token validated against Meta before saving)
metaAdsRouter.post('/config', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const input = ConnectSchema.parse(req.body);
    const status = await getService().connect(storeId, {
      accessToken: input.access_token,
      adAccountId: input.ad_account_id,
    });
    res.json({ success: true, message: 'Meta Ads connected successfully.', data: status });
  } catch (err) {
    next(err);
  }
});

// 3. Test a token without saving it
metaAdsRouter.post('/test', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = TestSchema.parse(req.body);
    const result = await getService().testToken(input.access_token);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 4. List ad accounts accessible with the connected token
metaAdsRouter.get('/accounts', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const accounts = await getService().listAdAccounts(storeId);
    res.json({ success: true, data: accounts });
  } catch (err) {
    next(err);
  }
});

// 5. Ads insights with performance metrics (+ store-side attribution)
metaAdsRouter.get('/insights', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const q = InsightsQuerySchema.parse(req.query);
    if ((q.since && !q.until) || (!q.since && q.until)) {
      throw new ValidationError('since and until must be provided together');
    }
    const data = await getService().getInsights(storeId, {
      level: q.level as MetaInsightLevel,
      datePreset: q.date_preset as MetaDatePreset,
      since: q.since,
      until: q.until,
      adAccountId: q.ad_account_id,
      limit: q.limit,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// 6. Disconnect (deletes stored credentials)
metaAdsRouter.delete('/config', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const result = await getService().disconnect(storeId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
