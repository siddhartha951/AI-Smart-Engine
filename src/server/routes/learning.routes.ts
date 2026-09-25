import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import {
  addMerchantNote,
  approveLearningItem,
  dismissLearningItem,
  feedbackSummary,
  listLearningItems,
  recordFeedback,
} from '../../modules/learning/learning.service';

/**
 * My Agent → Learning: questions the assistants could not answer, 👍/👎 counts, and the
 * answers / notes the merchant teaches. Mounted at /api/v1/dashboard/:storeId/learning.
 */
export const learningRouter = Router({ mergeParams: true });

const UUID = z.string().uuid();

function bad(res: Response, err: z.ZodError): void {
  res.status(400).json({ success: false, error: { message: err.issues[0]?.message || 'Invalid request' } });
}

learningRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const surface = req.query.surface === 'merchant' ? 'merchant' : req.query.surface === 'shopper' ? 'shopper' : undefined;
    const status = ['open', 'approved', 'dismissed'].includes(String(req.query.status)) ? (req.query.status as 'open') : undefined;
    const db = getDatabaseClient();
    const [items, feedback] = await Promise.all([
      listLearningItems(db, storeId, { surface, status }),
      feedbackSummary(db, storeId),
    ]);
    res.json({ success: true, data: { items, feedback } });
  } catch (err) {
    next(err);
  }
});

const ApproveSchema = z.object({ answer: z.string().trim().min(2, 'Write the correct answer first.').max(2000) }).strict();

learningRouter.post('/:itemId/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = UUID.safeParse(req.params.itemId);
    const body = ApproveSchema.safeParse(req.body);
    if (!id.success) return bad(res, id.error);
    if (!body.success) return bad(res, body.error);
    const item = await approveLearningItem(getDatabaseClient(), req.params.storeId as string, id.data, body.data.answer);
    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

learningRouter.post('/:itemId/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = UUID.safeParse(req.params.itemId);
    if (!id.success) return bad(res, id.error);
    await dismissLearningItem(getDatabaseClient(), req.params.storeId as string, id.data);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const NoteSchema = z.object({
  surface: z.enum(['shopper', 'merchant']),
  question: z.string().trim().max(1000).optional().default(''),
  answer: z.string().trim().min(2, 'Write what the assistant should know.').max(2000),
}).strict();

learningRouter.post('/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = NoteSchema.safeParse(req.body);
    if (!body.success) return bad(res, body.error);
    const item = await addMerchantNote(getDatabaseClient(), req.params.storeId as string, body.data.surface, body.data.question, body.data.answer);
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

const MerchantFeedbackSchema = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
  question: z.string().max(2000).optional(),
  answer: z.string().max(8000).optional(),
  comment: z.string().max(500).optional(),
}).strict();

// 👍 / 👎 on Ask AI answers
learningRouter.post('/feedback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = MerchantFeedbackSchema.safeParse(req.body);
    if (!body.success) return bad(res, body.error);
    await recordFeedback(getDatabaseClient(), req.params.storeId as string, { surface: 'merchant', ...body.data });
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});
