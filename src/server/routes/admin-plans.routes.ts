import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { verifyJwt, requireAdminOnly, requireSuperAdmin } from '../middlewares/auth.middleware';
import { PlanRepository } from '../../modules/plans/plan.repository';
import { buildStorePlanView } from '../../modules/plans/plan.service';
import {
  ALWAYS_INCLUDED_FEATURES,
  BILLING_CYCLES,
  FEATURE_LABELS,
  FEATURE_SECTIONS,
  Plan,
  SUBSCRIPTION_STATUSES,
  isFeatureKey,
  planListPrice,
} from '../../modules/plans/plan.types';

// Mounted at /api/v1/admin. Reading is open to every admin; changing prices or a store's
// plan needs a super admin, like the platform budget settings.
const router = Router();
router.use(verifyJwt);
router.use(requireAdminOnly);

const nullableInt = (max: number) => z.number().int().min(0).max(max).nullable();
const nullableMoney = z.number().min(0).max(100000000).nullable();
const dateField = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const planPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    tagline: z.string().trim().max(300).nullable().optional(),
    price_inr_monthly: nullableInt(10000000).optional(),
    price_usd_monthly: nullableInt(1000000).optional(),
    ai_budget_usd: z.number().min(0).max(100000).nullable().optional(),
    knowledge_doc_limit: nullableInt(500).optional(),
    features: z.array(z.string()).max(50).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const subscriptionSchema = z
  .object({
    plan_id: z.string().trim().min(1).max(40),
    billing_cycle: z.enum(BILLING_CYCLES).default('monthly'),
    price_amount: nullableMoney.optional().transform((v) => v ?? null),
    currency: z.enum(['INR', 'USD']).default('INR'),
    status: z.enum(SUBSCRIPTION_STATUSES).default('active'),
    started_at: dateField,
    renews_at: dateField,
    trial_ends_at: dateField,
    ai_budget_usd: z.number().min(0).max(100000).nullable().optional().transform((v) => v ?? null),
    knowledge_doc_limit: nullableInt(500).optional().transform((v) => v ?? null),
    notes: z.string().trim().max(1000).nullable().optional().transform((v) => v || null),
    apply_plan_features: z.boolean().optional(),
  })
  .strict();

function validationError(res: Response, err: z.ZodError): void {
  const first = err.issues[0];
  res.status(400).json({
    success: false,
    error: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request',
  });
}

function withPrices(plan: Plan, storeCount: number) {
  return {
    ...plan,
    store_count: storeCount,
    yearly_price_inr: planListPrice(plan, 'INR', 'yearly'),
    yearly_price_usd: planListPrice(plan, 'USD', 'yearly'),
  };
}

const sectionsForClient = FEATURE_SECTIONS.map((s) => ({
  id: s.id,
  name: s.name,
  features: s.features.map((key) => ({ key, label: FEATURE_LABELS[key] })),
}));

async function storeExists(storeId: string): Promise<{ brand_name: string | null; shop_domain: string | null } | null> {
  const res = await getDatabaseClient().query('SELECT brand_name, shop_domain FROM stores WHERE id = $1', [storeId]);
  return res.rows[0] || null;
}

// Plans catalogue with the feature matrix sections
router.get('/plans', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = new PlanRepository(getDatabaseClient());
    const [plans, counts] = await Promise.all([repo.listPlans(), repo.countStoresByPlan()]);
    res.json({
      success: true,
      data: {
        plans: plans.map((p) => withPrices(p, counts[p.id] || 0)),
        sections: sectionsForClient,
        // In every plan; the admin switches them per store instead
        always_included: ALWAYS_INCLUDED_FEATURES,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.put('/plans/:planId', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = planPatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const { features, ...rest } = parsed.data;
    if (features && features.some((f) => !isFeatureKey(f))) {
      res.status(400).json({ success: false, error: 'features: contains an unknown feature key' });
      return;
    }
    const repo = new PlanRepository(getDatabaseClient());
    const updated = await repo.updatePlan(
      req.params.planId as string,
      { ...rest, ...(features ? { features: features.filter(isFeatureKey) } : {}) },
      req.user!.id
    );
    if (!updated) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }
    const counts = await repo.countStoresByPlan();
    res.json({ success: true, data: withPrices(updated, counts[updated.id] || 0) });
  } catch (err) {
    next(err);
  }
});

// A store's plan, limits, usage and features grouped by section with In plan / Add-on / Removed
router.get('/stores/:storeId/plan', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const store = await storeExists(storeId);
    if (!store) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }
    const db = getDatabaseClient();
    const [view, plans] = await Promise.all([buildStorePlanView(db, storeId), new PlanRepository(db).listPlans()]);
    res.json({ success: true, data: { store_id: storeId, store_name: store.brand_name || store.shop_domain, ...view, plans } });
  } catch (err) {
    next(err);
  }
});

router.put('/stores/:storeId/plan', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    if (!(await storeExists(storeId))) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }
    const db = getDatabaseClient();
    const repo = new PlanRepository(db);
    const plan = await repo.getPlan(parsed.data.plan_id);
    if (!plan) {
      res.status(400).json({ success: false, error: 'plan_id: unknown plan' });
      return;
    }
    const { apply_plan_features, ...body } = parsed.data;
    const input = {
      plan_id: body.plan_id,
      billing_cycle: body.billing_cycle ?? 'monthly',
      price_amount: body.price_amount ?? null,
      currency: body.currency ?? 'INR',
      status: body.status ?? 'active',
      started_at: body.started_at ?? null,
      renews_at: body.renews_at ?? null,
      trial_ends_at: body.trial_ends_at ?? null,
      ai_budget_usd: body.ai_budget_usd ?? null,
      knowledge_doc_limit: body.knowledge_doc_limit ?? null,
      notes: body.notes ?? null,
    };
    const previous = await repo.getSubscription(storeId);
    // A new plan resets the switches to that plan; saving dates or price on the same plan keeps overrides
    const applyFeatures = apply_plan_features ?? (!previous || previous.plan_id !== input.plan_id);
    await repo.assignPlan(storeId, input, req.user!.id, applyFeatures);
    const view = await buildStorePlanView(db, storeId);
    res.json({ success: true, data: { store_id: storeId, features_reset: applyFeatures, ...view } });
  } catch (err) {
    next(err);
  }
});

router.post('/stores/:storeId/plan/reset-features', requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    if (!(await storeExists(storeId))) {
      res.status(404).json({ success: false, error: 'Store not found' });
      return;
    }
    const db = getDatabaseClient();
    const ok = await new PlanRepository(db).resetFeaturesToPlan(storeId, req.user!.id);
    if (!ok) {
      res.status(400).json({ success: false, error: 'This store has no plan yet. Assign a plan first.' });
      return;
    }
    res.json({ success: true, data: { store_id: storeId, ...(await buildStorePlanView(db, storeId)) } });
  } catch (err) {
    next(err);
  }
});

export default router;
