import { z } from 'zod';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { getAiProvider } from '../../providers/ai';
import { MockAiProvider } from '../../providers/ai/mock.ai.provider';
import { logger } from '../../utils/logger';

export const TICKET_CATEGORIES = [
  'return_refund',
  'order_tracking',
  'product_inquiry',
  'discount_coupon',
  'damaged_missing',
  'general',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_SENTIMENTS = ['angry', 'negative', 'neutral', 'positive'] as const;
export type TicketSentiment = (typeof TICKET_SENTIMENTS)[number];

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  return_refund: '🔄 Return & Refund',
  order_tracking: '📦 Order Tracking & Delay',
  product_inquiry: '🧴 Product Recommendation',
  discount_coupon: '🏷️ Discount / Coupon Help',
  damaged_missing: '⚠️ Damaged / Missing Item',
  general: '💬 General Inquiry',
};

export interface TicketTriage {
  category: TicketCategory;
  sentiment: TicketSentiment;
  priority: TicketPriority;
  source: 'rules' | 'ai';
}

interface TranscriptMessage {
  role: string;
  content: string;
}

const PRIORITY_RANK: Record<TicketPriority, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

// Keyword rules cover English plus common Hinglish phrasing used by Indian shoppers.
// Order matters: the most specific / most severe category wins ties.
const CATEGORY_RULES: Array<{ category: TicketCategory; pattern: RegExp }> = [
  { category: 'damaged_missing', pattern: /\b(damaged|broken|leak(ed|ing)?|torn|crushed|missing item|item missing|wrong (item|product)|not in the (box|package)|expired|toota|tuta|kharab|galat (item|product|saman))\b/i },
  { category: 'return_refund', pattern: /\b(refund|return(ing)?|money back|exchange|replace(ment)?|cancel( my)? order|chargeback|paisa wapas|paise wapas|wapas (karo|chahiye|kar do)|lautana)\b/i },
  { category: 'order_tracking', pattern: /\b(track(ing)?|where is my (order|package|parcel)|not (yet )?(received|delivered|arrived)|delay(ed)?|late|still waiting|shipping status|dispatch(ed)?|courier|awb|order status|nahi aaya|nahi mila|abhi tak|kab aayega|kab milega)\b/i },
  { category: 'discount_coupon', pattern: /\b(coupon|discount|promo( code)?|voucher|offer code|code (is )?not working|invalid code|cashback)\b/i },
  { category: 'product_inquiry', pattern: /\b(recommend|suggest|which (product|one)|best for|suitable|ingredients?|dosage|size|variant|in stock|compatible|product (info|details)|kaunsa|konsa)\b/i },
];

const ANGRY_PATTERN = /\b(worst|pathetic|fraud|scam|cheat(ed|ing)?|ridiculous|unacceptable|disgusting|horrible|terrible|furious|angry|fed up|never (again|buying)|consumer (court|forum)|legal action|bakwas|bekar|bekaar|dhokha|chor|gussa|faltu|third class)\b/i;
const NEGATIVE_PATTERN = /\b(disappointed|unhappy|not happy|problem|issue|complaint|still waiting|not (received|delivered|working)|poor|bad|upset|frustrat(ed|ing)|nahi aaya|nahi mila|abhi tak|kharab)\b/i;
const POSITIVE_PATTERN = /\b(thank(s| you)|great|love|awesome|amazing|happy with|shukriya|dhanyavad)\b/i;
const URGENT_PATTERN = /\b(urgent(ly)?|asap|immediately|right now|today itself|jaldi|turant|abhi ke abhi)\b/i;

function customerText(subject: string, transcript: TranscriptMessage[]): string {
  const userLines = transcript.filter(m => m.role === 'user').map(m => m.content || '');
  return [subject, ...userLines].join('\n');
}

function shoutingRatio(text: string): number {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 12) return 0;
  return letters.replace(/[^A-Z]/g, '').length / letters.length;
}

export function triageByRules(subject: string, transcript: TranscriptMessage[] = []): TicketTriage {
  const text = customerText(subject, transcript);

  const category = CATEGORY_RULES.find(r => r.pattern.test(text))?.category ?? 'general';

  const isShouting = shoutingRatio(text) > 0.6 || /!{3,}/.test(text);
  let sentiment: TicketSentiment = 'neutral';
  if (ANGRY_PATTERN.test(text) || isShouting) sentiment = 'angry';
  else if (NEGATIVE_PATTERN.test(text)) sentiment = 'negative';
  else if (POSITIVE_PATTERN.test(text)) sentiment = 'positive';

  const isUrgentAsk = URGENT_PATTERN.test(text);
  const isOrderProblem = category === 'return_refund' || category === 'order_tracking' || category === 'damaged_missing';

  let priority: TicketPriority = 'medium';
  if (sentiment === 'angry' && (isOrderProblem || isUrgentAsk)) priority = 'urgent';
  else if (sentiment === 'angry' || category === 'damaged_missing' || (sentiment === 'negative' && isOrderProblem) || isUrgentAsk) priority = 'high';
  else if (sentiment === 'positive' && category === 'product_inquiry') priority = 'low';

  return { category, sentiment, priority, source: 'rules' };
}

const AiTriageSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  sentiment: z.enum(TICKET_SENTIMENTS),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
});

const AI_TRIAGE_TIMEOUT_MS = 6000;

/**
 * Classifies a ticket. Deterministic rules always run; when a real AI provider is available (and the
 * store is within budget) its classification refines the rules, but it can never lower the rule-based priority.
 */
export async function triageTicket(
  storeId: string,
  subject: string,
  transcript: TranscriptMessage[] = [],
  deps?: { orchestrator?: AiOrchestratorService }
): Promise<TicketTriage> {
  const rules = triageByRules(subject, transcript);

  // Without a real AI provider configured the keyword rules are the classification
  if (!deps?.orchestrator && getAiProvider() instanceof MockAiProvider) return rules;

  const conversation = transcript
    .slice(-12)
    .map(m => `${m.role === 'user' ? 'CUSTOMER' : 'ASSISTANT'}: ${(m.content || '').slice(0, 500)}`)
    .join('\n');

  const prompt = `ticket_triage task. Classify this e-commerce support ticket.
Return JSON with exactly these keys:
- "category": one of ${TICKET_CATEGORIES.join(', ')}
- "sentiment": one of ${TICKET_SENTIMENTS.join(', ')} (use "angry" for hostile, shouting or threatening customers)
- "priority": one of low, medium, high, urgent (urgent = angry customer with an order, refund or damaged-item problem)
The customer may write in English, Hindi or Hinglish.

SUBJECT: ${subject.slice(0, 300)}
CONVERSATION:
${conversation || '(no prior chat)'}`;

  let timer: NodeJS.Timeout | undefined;
  try {
    const orchestrator = deps?.orchestrator || new AiOrchestratorService();
    const ai = await Promise.race([
      orchestrator.generateStructuredJson(storeId, prompt, AiTriageSchema, { modelTier: 'fast', temperature: 0 }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI triage timed out')), AI_TRIAGE_TIMEOUT_MS);
      }),
    ]);

    const priority = PRIORITY_RANK[ai.priority] >= PRIORITY_RANK[rules.priority] ? ai.priority : rules.priority;
    // Keep the rules' category when the AI falls back to "general" but a keyword clearly matched
    const category = ai.category === 'general' && rules.category !== 'general' ? rules.category : ai.category;
    return { category, sentiment: ai.sentiment, priority, source: 'ai' };
  } catch (err: any) {
    logger.info(`Ticket triage using keyword rules for store ${storeId}: ${err?.message || err}`);
    return rules;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Converts the merchant's SLA wording ("within 4 hours", "within 1-2 business days") into minutes.
 * Ranges use the upper bound so the countdown never promises faster than the merchant committed to.
 */
export function parseSlaMinutes(duration: string | null | undefined): number {
  const text = (duration || '').toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?|(?:business\s+|working\s+)?days?)/);
  if (!match) return 24 * 60;

  const amount = parseFloat(match[2] || match[1]);
  const unit = match[3];
  if (unit.startsWith('min')) return Math.round(amount);
  if (unit.startsWith('h')) return Math.round(amount * 60);
  return Math.round(amount * 24 * 60);
}

export function computeSlaDueAt(createdAt: Date, duration: string | null | undefined): Date {
  return new Date(createdAt.getTime() + parseSlaMinutes(duration) * 60_000);
}
