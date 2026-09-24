import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getDatabaseClient } from '../../database/client';
import { parseDocument } from '../../modules/ai_agent/document.parser';
import {
  KnowledgeDocumentRepository,
  MAX_KNOWLEDGE_DOCUMENTS,
} from '../../modules/knowledge/knowledge-document.repository';
import { AuditRepository } from '../../modules/merchant/audit.repository';
import { ValidationError } from '../../utils/errors';
import { safeEffectiveLimits } from '../../modules/plans/plan.repository';

// Mounted at /api/v1/dashboard/:storeId/agent/knowledge (store access enforced by the parent router)
export const knowledgeRouter = Router({ mergeParams: true });

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** ~15k tokens per document; retrieval only sends the relevant passages to the AI. */
export const MAX_KNOWLEDGE_DOC_CHARS = 60000;

const PARSED_EXTENSIONS = new Set(['.pdf', '.csv', '.xlsx', '.xls']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json']);

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = extensionOf(file.originalname);
    if (PARSED_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(ext)) cb(null, true);
    else cb(new ValidationError('Supported files: PDF, TXT, MD, CSV, XLSX.'));
  },
});

function uploadSingle(req: Request, res: Response, next: NextFunction): void {
  upload.single('document')(req, res, (err: unknown) => {
    if (err && typeof err === 'object' && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
      next(new ValidationError('File is too large. Maximum size is 10MB.'));
      return;
    }
    next(err || undefined);
  });
}

function cleanText(raw: string): { text: string; truncated: boolean } {
  const text = raw
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > MAX_KNOWLEDGE_DOC_CHARS
    ? { text: text.slice(0, MAX_KNOWLEDGE_DOC_CHARS), truncated: true }
    : { text, truncated: false };
}

async function ensureCapacity(repo: KnowledgeDocumentRepository, storeId: string) {
  // Plan limit when the store has a plan, otherwise the platform default
  const limit = (await safeEffectiveLimits(getDatabaseClient(), storeId)).knowledge_doc_limit ?? MAX_KNOWLEDGE_DOCUMENTS;
  if ((await repo.countDocuments(storeId)) >= limit) {
    throw new ValidationError(`Your plan includes up to ${limit} knowledge documents. Remove one to add another.`);
  }
}

knowledgeRouter.get('/documents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const documents = await new KnowledgeDocumentRepository(getDatabaseClient()).listSummaries(storeId);
    res.json({ success: true, data: documents });
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.post('/documents', uploadSingle, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const file = req.file;
    if (!file) throw new ValidationError('No file uploaded. Choose a PDF, TXT, MD, CSV or XLSX file.');

    const fileName = file.originalname.slice(0, 255);
    const ext = extensionOf(fileName);
    let content: string;
    let truncated: boolean;
    let documentType: string;

    if (TEXT_EXTENSIONS.has(ext)) {
      ({ text: content, truncated } = cleanText(file.buffer.toString('utf-8')));
      documentType = ext.slice(1);
    } else {
      const parsed = await parseDocument(file.buffer, fileName, file.mimetype, { maxChars: MAX_KNOWLEDGE_DOC_CHARS });
      ({ text: content, truncated } = cleanText(parsed.text));
      truncated = truncated || parsed.truncated;
      documentType = parsed.documentType;
    }

    if (content.length < 20) {
      throw new ValidationError('No readable text found in this file. If it is a scanned PDF, upload a text-based version.');
    }

    const db = getDatabaseClient();
    const repo = new KnowledgeDocumentRepository(db);
    await ensureCapacity(repo, storeId);
    const doc = await repo.createDocument(storeId, { fileName, documentType, content, truncated });
    await new AuditRepository(db).logAction(req.user!.id, storeId, 'ADD_KNOWLEDGE_DOCUMENT', 'store_knowledge_documents', {}, {
      file_name: fileName,
      char_count: doc.char_count,
    });

    const { content: _omit, ...summary } = doc;
    res.status(201).json({
      success: true,
      message: truncated
        ? `${fileName} added. It was long, so the first ${MAX_KNOWLEDGE_DOC_CHARS.toLocaleString()} characters were kept.`
        : `${fileName} added to your agent's knowledge.`,
      data: { ...summary, preview: content.slice(0, 240) },
    });
  } catch (err) {
    next(err);
  }
});

const textDocSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(20, 'Add at least a sentence of knowledge').max(MAX_KNOWLEDGE_DOC_CHARS),
});

// Paste-in knowledge (FAQ answers, brand story) stored the same way as uploaded files
knowledgeRouter.post('/documents/text', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const { title, content } = textDocSchema.parse(req.body || {});
    const db = getDatabaseClient();
    const repo = new KnowledgeDocumentRepository(db);
    await ensureCapacity(repo, storeId);
    const doc = await repo.createDocument(storeId, { fileName: title, documentType: 'note', content: cleanText(content).text, truncated: false });
    await new AuditRepository(db).logAction(req.user!.id, storeId, 'ADD_KNOWLEDGE_DOCUMENT', 'store_knowledge_documents', {}, { file_name: title });
    const { content: _omit, ...summary } = doc;
    res.status(201).json({ success: true, data: { ...summary, preview: doc.content.slice(0, 240) } });
  } catch (err) {
    next(err);
  }
});

knowledgeRouter.delete('/documents/:documentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const documentId = req.params.documentId as string;
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }
    const db = getDatabaseClient();
    const deleted = await new KnowledgeDocumentRepository(db).deleteDocument(storeId, documentId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Document not found' });
    await new AuditRepository(db).logAction(req.user!.id, storeId, 'REMOVE_KNOWLEDGE_DOCUMENT', 'store_knowledge_documents', { id: documentId }, {});
    res.json({ success: true, deleted: true });
  } catch (err) {
    next(err);
  }
});
