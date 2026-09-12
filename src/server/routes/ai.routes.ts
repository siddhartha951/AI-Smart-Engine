import { Router, Request, Response } from 'express';
import { AiAnalysisService } from '../../modules/ai/ai-analysis.service';
import { enforceFeature } from '../middlewares/entitlement.middleware';
import { getDatabaseClient } from '../../database/client';

export const aiRouter = Router({ mergeParams: true });

// 1. Store Deep Audit
aiRouter.post('/store-analysis', enforceFeature('ai_store_analysis'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const forceRefresh = req.body?.forceRefresh === true;
    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.analyzeStore(storeId, forceRefresh);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 2. Overview AI Insights
aiRouter.get('/overview-insights', enforceFeature('overview'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const forceRefresh = req.query?.refresh === 'true';
    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.getOverviewInsights(storeId, forceRefresh);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 3. Catalogue AI Analysis
aiRouter.post('/catalogue-analysis', enforceFeature('catalogue'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const productId = req.body?.product_id as string | undefined;
    const forceRefresh = req.body?.forceRefresh === true;
    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.analyzeCatalogue(storeId, productId, forceRefresh);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 3.1 Product Improvements Generation
aiRouter.post('/product-improvements', enforceFeature('catalogue'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const productId = (req.body?.product_id || req.body?.productId) as string;
    if (!productId) {
      res.status(400).json({ success: false, error: 'Field "product_id" is required' });
      return;
    }

    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.generateProductImprovements(storeId, productId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 4. Funnel AI Analysis
aiRouter.get('/funnel-analysis', enforceFeature('funnel'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const forceRefresh = req.query?.refresh === 'true';
    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.analyzeFunnel(storeId, forceRefresh);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 4.1 Funnel Ask AI
aiRouter.post('/funnel-ask', enforceFeature('funnel'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const question = req.body?.question as string;
    if (!question || !question.trim()) {
      res.status(400).json({ success: false, error: 'Field "question" is required' });
      return;
    }

    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.askFunnelQuestion(storeId, question);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 5. Ad Intelligence AI Analysis
aiRouter.get('/ad-analysis', enforceFeature('ad_intelligence'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const forceRefresh = req.query?.refresh === 'true';
    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.analyzeAds(storeId, forceRefresh);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 5.1 Ad Ask AI
aiRouter.post('/ad-ask', enforceFeature('ad_intelligence'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const question = req.body?.question as string;
    if (!question || !question.trim()) {
      res.status(400).json({ success: false, error: 'Field "question" is required' });
      return;
    }

    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.askAdQuestion(storeId, question);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 6. Email Automation AI
aiRouter.post('/email-generate', enforceFeature('email_automation'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const email_type = req.body?.email_type || req.body?.emailType;
    const goal = req.body?.goal;
    const tone = req.body?.tone;
    const length = req.body?.length;
    const custom_instruction = req.body?.custom_instruction || req.body?.customContext || req.body?.customInstruction;
    const product_id = req.body?.product_id || req.body?.productId;

    if (!email_type || !goal || !tone || !length) {
      res.status(400).json({
        success: false,
        error: 'Missing required email generator fields: email_type, goal, tone, length',
      });
      return;
    }

    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.generateEmail(storeId, {
      email_type,
      goal,
      tone,
      length,
      custom_instruction,
      product_id,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// 7. Smart Reorder AI Recommendations
aiRouter.get('/reorder-recommendations', enforceFeature('smart_reorder'), async (req: Request, res: Response, next) => {
  try {
    const storeId = req.params.storeId as string;
    const db = getDatabaseClient();
    const service = new AiAnalysisService({ db });

    const result = await service.getReorderRecommendations(storeId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
