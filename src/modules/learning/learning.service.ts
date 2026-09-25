/**
 * How the assistants learn from their mistakes without ever learning something wrong:
 *
 *  - The storefront bot said "I'm not sure" or a shopper/merchant pressed 👎
 *      -> the question lands in the merchant's "To teach" list (status open)
 *  - The merchant writes the right answer (or a standing note for Ask AI)
 *      -> status approved; from then on it is part of that assistant's knowledge
 *
 * Nothing reaches shoppers until the merchant approves it. Emails and phone numbers
 * typed by shoppers are masked before a question is stored.
 */
import { IDatabaseClient } from '../../database/client';
import { TenantIsolationError, ValidationError } from '../../utils/errors';

export type LearningSurface = 'shopper' | 'merchant';
export type LearningStatus = 'open' | 'approved' | 'dismissed';

export interface LearningItem {
  id: string;
  surface: LearningSurface;
  source: 'unanswered' | 'thumbs_down' | 'merchant_note';
  question: string;
  bot_answer: string | null;
  correct_answer: string | null;
  status: LearningStatus;
  occurrences: number;
  created_at: string;
  updated_at: string;
}

const UNSURE_PATTERNS = [
  /\bnot (?:100% )?sure\b/i,
  /\b(?:don'?t|do not|doesn'?t) have (?:that|this|enough|any|the)? ?(?:specific )?(?:information|details|info)\b/i,
  /\bno (?:information|details) (?:about|on)\b/i,
  /\b(?:couldn'?t|could not|unable to|can'?t|cannot) (?:find|confirm|answer|verify)\b/i,
  /\bi don'?t know\b/i,
  /\b(?:pakka|pukka) nahi?\b/i,
  /\b(?:jaankari|jankari) nahi?\b/i,
  /\bpata nahi\b/i,
];

export function isUnsureAnswer(answer: string): boolean {
  const text = String(answer || '');
  return text.length > 0 && UNSURE_PATTERNS.some((re) => re.test(text));
}

/** Mask personal data a shopper might have typed */
export function maskPersonalData(text: string): string {
  return String(text || '')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s-]{8,16}\d/g, '[phone]')
    .slice(0, 1000);
}

const FILLER = new Set(['the', 'a', 'an', 'is', 'are', 'do', 'does', 'you', 'your', 'i', 'my', 'me', 'can', 'please', 'hi', 'hello', 'hey', 'what', 'kya', 'hai', 'ka', 'ki', 'ke', 'to', 'of', 'for', 'in', 'on', 'it']);

function tokens(text: string): string[] {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1 && !FILLER.has(t));
}

/** Groups repeats of the same question ("Do you ship to Dubai?" / "do u ship to dubai") */
export function questionKey(question: string): string {
  return tokens(question).join(' ').slice(0, 200) || String(question || '').toLowerCase().slice(0, 200);
}

function toItem(r: any): LearningItem {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v || ''));
  return {
    id: r.id,
    surface: r.surface,
    source: r.source,
    question: r.question,
    bot_answer: r.bot_answer || null,
    correct_answer: r.correct_answer || null,
    status: r.status,
    occurrences: Number(r.occurrences || 1),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

async function upsertOpen(
  db: IDatabaseClient,
  storeId: string,
  surface: LearningSurface,
  source: LearningItem['source'],
  question: string,
  botAnswer: string
): Promise<void> {
  const q = maskPersonalData(question).trim();
  if (q.length < 4) return;
  const key = questionKey(q);
  const existing = await db.query(
    `SELECT id, status FROM ai_learning_items WHERE store_id = $1 AND surface = $2 AND question_key = $3 ORDER BY updated_at DESC LIMIT 1`,
    [storeId, surface, key]
  );
  const row = existing.rows[0];
  if (row && row.status !== 'dismissed') {
    // Already known (open or approved): count the repeat; an approved answer stays approved
    await db.query(
      `UPDATE ai_learning_items SET occurrences = occurrences + 1, bot_answer = COALESCE($3, bot_answer), updated_at = NOW()
       WHERE store_id = $1 AND id = $2`,
      [storeId, row.id, row.status === 'open' ? String(botAnswer || '').slice(0, 2000) : null]
    );
    return;
  }
  await db.query(
    `INSERT INTO ai_learning_items (store_id, surface, source, question, question_key, bot_answer, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'open')`,
    [storeId, surface, source, q, key, String(botAnswer || '').slice(0, 2000)]
  );
}

/** Storefront chat: remember questions the bot could not answer. */
export async function noteShopperAnswer(db: IDatabaseClient, storeId: string, question: string, answer: string): Promise<void> {
  if (!storeId || !isUnsureAnswer(answer)) return;
  await upsertOpen(db, storeId, 'shopper', 'unanswered', question, answer);
}

export interface FeedbackInput {
  surface: LearningSurface;
  rating: 1 | -1;
  question?: string;
  answer?: string;
  comment?: string;
  sessionId?: string | null;
}

export async function recordFeedback(db: IDatabaseClient, storeId: string, input: FeedbackInput): Promise<void> {
  if (!storeId) throw new TenantIsolationError('store_id is required');
  await db.query(
    `INSERT INTO ai_feedback (store_id, surface, session_id, rating, question, answer, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      storeId,
      input.surface,
      input.sessionId ? String(input.sessionId).slice(0, 64) : null,
      input.rating,
      input.question ? maskPersonalData(input.question) : null,
      input.answer ? String(input.answer).slice(0, 4000) : null,
      input.comment ? maskPersonalData(input.comment).slice(0, 500) : null,
    ]
  );
  if (input.rating === -1 && input.question) {
    await upsertOpen(db, storeId, input.surface, 'thumbs_down', input.question, input.answer || '');
  }
}

export async function listLearningItems(
  db: IDatabaseClient,
  storeId: string,
  opts: { surface?: LearningSurface; status?: LearningStatus; limit?: number } = {}
): Promise<LearningItem[]> {
  const params: unknown[] = [storeId];
  let where = 'store_id = $1';
  if (opts.surface) {
    params.push(opts.surface);
    where += ` AND surface = $${params.length}`;
  }
  if (opts.status) {
    params.push(opts.status);
    where += ` AND status = $${params.length}`;
  }
  params.push(Math.max(1, Math.min(opts.limit || 100, 500)));
  const res = await db.query(
    `SELECT * FROM ai_learning_items WHERE ${where} ORDER BY occurrences DESC, updated_at DESC LIMIT $${params.length}`,
    params
  );
  return res.rows.map(toItem);
}

export async function feedbackSummary(db: IDatabaseClient, storeId: string): Promise<Record<LearningSurface, { up: number; down: number }>> {
  const res = await db.query(
    `SELECT surface, rating, COUNT(*) AS n FROM ai_feedback
     WHERE store_id = $1 AND created_at >= $2::timestamptz GROUP BY surface, rating`,
    [storeId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()]
  );
  const out: Record<LearningSurface, { up: number; down: number }> = { shopper: { up: 0, down: 0 }, merchant: { up: 0, down: 0 } };
  for (const r of res.rows) {
    const s = r.surface === 'merchant' ? 'merchant' : 'shopper';
    if (Number(r.rating) > 0) out[s].up += Number(r.n || 0);
    else out[s].down += Number(r.n || 0);
  }
  return out;
}

export async function approveLearningItem(db: IDatabaseClient, storeId: string, id: string, correctAnswer: string): Promise<LearningItem> {
  const answer = String(correctAnswer || '').trim();
  if (answer.length < 2) throw new ValidationError('Write the correct answer first.');
  const res = await db.query(
    `UPDATE ai_learning_items SET correct_answer = $3, status = 'approved', resolved_at = NOW(), updated_at = NOW()
     WHERE store_id = $1 AND id = $2 RETURNING *`,
    [storeId, id, answer.slice(0, 2000)]
  );
  if (!res.rows[0]) throw new ValidationError('That question was not found.');
  return toItem(res.rows[0]);
}

export async function dismissLearningItem(db: IDatabaseClient, storeId: string, id: string): Promise<void> {
  await db.query(
    `UPDATE ai_learning_items SET status = 'dismissed', resolved_at = NOW(), updated_at = NOW() WHERE store_id = $1 AND id = $2`,
    [storeId, id]
  );
}

/** A fact the merchant teaches directly ("We ship to UAE in 5-7 days", "Our margin target is 40%") */
export async function addMerchantNote(db: IDatabaseClient, storeId: string, surface: LearningSurface, question: string, answer: string): Promise<LearningItem> {
  const q = String(question || '').trim().slice(0, 1000);
  const a = String(answer || '').trim().slice(0, 2000);
  if (a.length < 2) throw new ValidationError('Write what the assistant should know.');
  const res = await db.query(
    `INSERT INTO ai_learning_items (store_id, surface, source, question, question_key, correct_answer, status, resolved_at)
     VALUES ($1, $2, 'merchant_note', $3, $4, $5, 'approved', NOW()) RETURNING *`,
    [storeId, surface, q || a.slice(0, 120), questionKey(q || a), a]
  );
  return toItem(res.rows[0]);
}

/**
 * Approved answers relevant to this message, as prompt text. Small stores send them all;
 * otherwise the ones sharing the most words with the question.
 */
export async function learningContext(db: IDatabaseClient, storeId: string, surface: LearningSurface, message: string, max = 8): Promise<string> {
  const items = await listLearningItems(db, storeId, { surface, status: 'approved', limit: 200 });
  if (!items.length) return '';
  let chosen = items;
  if (items.length > max) {
    const want = new Set(tokens(message));
    chosen = items
      .map((it) => ({ it, score: tokens(`${it.question} ${it.correct_answer}`).filter((t) => want.has(t)).length }))
      .filter((x) => x.score > 0 || x.it.source === 'merchant_note')
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((x) => x.it);
  }
  if (!chosen.length) return '';
  const header = surface === 'shopper'
    ? 'ANSWERS APPROVED BY THE STORE OWNER (use them exactly when the question matches; they override older knowledge):'
    : 'FACTS THE STORE OWNER TAUGHT YOU (treat as true for this store):';
  return `${header}\n${chosen.map((it) => `Q: ${it.question}\nA: ${it.correct_answer}`).join('\n')}`;
}
