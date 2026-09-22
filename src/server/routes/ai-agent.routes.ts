import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { AiAgentService } from '../../modules/ai_agent/ai_agent.service';
import { parseDocument, isAllowedUpload } from '../../modules/ai_agent/document.parser';
import { isAgentConfigured } from '../../modules/ai_agent/ai_agent.llm';
import {
  checkRateLimit,
  CHAT_RATE_LIMIT,
  UPLOAD_RATE_LIMIT,
} from '../../modules/ai_agent/rate_limiter';
import { ValidationError } from '../../utils/errors';

/**
 * Merchant AI Agent routes (mounted at /api/v1/dashboard/:storeId/ai-agent).
 * JWT + store-access + feature gating are applied by the parent dashboard router.
 */
export const aiAgentRouter = Router({ mergeParams: true });

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedUpload(file.originalname, file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError('Only PDF, CSV, and XLSX documents are supported.'));
    }
  },
});

const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const ChatSchema = z.object({
  message: z.string().min(1, 'message is required').max(2000, 'message is too long (max 2000 characters)'),
  history: z.array(HistoryMessageSchema).max(20).optional(),
});

function getService(): AiAgentService {
  return new AiAgentService();
}

// 1. Agent status — is the LLM configured? (never leaks the key)
aiAgentRouter.get('/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: { configured: isAgentConfigured() } });
  } catch (err) {
    next(err);
  }
});

// 2. Chat with the merchant AI agent
aiAgentRouter.post('/chat', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const limit = checkRateLimit(`chat:${storeId}`, CHAT_RATE_LIMIT);
    if (!limit.allowed) {
      res.status(429).json({
        success: false,
        error: {
          code: 'AI_AGENT_RATE_LIMITED',
          message: 'You are asking too quickly. Please wait a moment and try again.',
        },
      });
      return;
    }
    const input = ChatSchema.parse(req.body);
    const data = await getService().chat(storeId, {
      message: input.message,
      history: input.history,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Multer errors (e.g. file too large) are raised by the middleware itself,
// so they need their own mapping before the main handler runs.
function uploadSingleDocument(req: Request, res: Response, next: NextFunction): void {
  upload.single('document')(req, res, (err: unknown) => {
    if (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        next(new ValidationError('Document is too large. Maximum size is 10MB.'));
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

// 3. Upload a document (PDF/CSV/XLSX) and get a structured AI verdict
aiAgentRouter.post('/upload', uploadSingleDocument, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const storeId = req.params.storeId as string;
    const limit = checkRateLimit(`upload:${storeId}`, UPLOAD_RATE_LIMIT);
    if (!limit.allowed) {
      res.status(429).json({
        success: false,
        error: {
          code: 'AI_AGENT_RATE_LIMITED',
          message: 'Too many document uploads. Please wait a few minutes and try again.',
        },
      });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      throw new ValidationError('No document uploaded. Attach a PDF, CSV, or XLSX file.');
    }
    // Parse to capped text server-side; contents are never logged.
    const parsed = await parseDocument(file.buffer, file.originalname, file.mimetype);
    const data = await getService().analyzeDocument(storeId, parsed);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
