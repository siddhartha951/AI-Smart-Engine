import { triageByRules } from './ticket-triage';

/**
 * Decides when the storefront assistant should hand a shopper to humans.
 *
 * Modes (merchant setting, assistant_settings.escalation_mode):
 *  - contact_only: never create tickets; show the store's contact details when needed.
 *  - smart:        AI resolves first; a ticket is offered only once the shopper is stuck or
 *                  frustrated (frustration score) or explicitly asks for a person.
 *  - instant:      legacy behaviour; offer a ticket as soon as the AI or shopper asks for one.
 * When the admin has not enabled support tickets, every mode behaves like contact_only.
 */

export const ESCALATION_MODES = ['contact_only', 'smart', 'instant'] as const;
export type EscalationMode = (typeof ESCALATION_MODES)[number];
export const ESCALATION_SENSITIVITIES = ['early', 'balanced', 'late'] as const;
export type EscalationSensitivity = (typeof ESCALATION_SENSITIVITIES)[number];

/** none: keep chatting · soft: show a small "Talk to our team" chip · offer: ask to create a ticket · contact: show contact card */
export type EscalationLevel = 'none' | 'soft' | 'offer' | 'contact';

export interface EscalationDecision {
  level: EscalationLevel;
  mode: EscalationMode;
  score: number;
  reasons: string[];
}

const THRESHOLDS: Record<EscalationSensitivity, { soft: number; offer: number }> = {
  early: { soft: 2, offer: 3 },
  balanced: { soft: 3, offer: 5 },
  late: { soft: 4, offer: 7 },
};

// Shopper explicitly wants a person: never trap them behind the bot
const HUMAN_REQUEST = /\b(human|real person|live (agent|chat|person)|talk to (someone|a person|an agent|your team|support)|speak (to|with) (someone|a person|an agent)|customer (care|service|support)|representative|executive|support ticket|(create|raise|open) (a )?ticket|call me|agent se baat|insaan se baat|kisi (insaan|banda|bande) se|team se baat|call karo)\b/i;
// Money taken but order/refund not right: needs staff quickly
const PAYMENT_PROBLEM = /\b(payment (deducted|failed|debited|stuck)|money (deducted|debited|taken)|charged (twice|double|two times)|double (charge|payment)|paisa (kat|cut) gaya|paise (kat|cut) gaye|amount debit|refund not (received|credited))\b/i;
const AI_UNSURE = /\b(i('m| am) not sure|i don'?t have (that|this|the) (information|detail)|i (can'?t|cannot|am unable to) (help|assist|check|access)|unable to (help|assist|find)|please contact (our )?(support|team)|reach out to (our )?(support|team))\b/i;

export function normalizeEscalationMode(value: unknown): EscalationMode {
  return ESCALATION_MODES.includes(value as EscalationMode) ? (value as EscalationMode) : 'smart';
}

export function normalizeEscalationSensitivity(value: unknown): EscalationSensitivity {
  return ESCALATION_SENSITIVITIES.includes(value as EscalationSensitivity) ? (value as EscalationSensitivity) : 'balanced';
}

function wordSet(text: string): Set<string> {
  return new Set((text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2));
}

/** Shopper rephrased a question they already asked: the answer did not help. */
function isRepeatQuestion(latest: string, earlier: string[]): boolean {
  const current = wordSet(latest);
  if (current.size < 3) return false;
  return earlier.some(prev => {
    const other = wordSet(prev);
    if (other.size < 3) return false;
    const shared = [...current].filter(w => other.has(w)).length;
    return shared / Math.min(current.size, other.size) >= 0.6;
  });
}

export interface EscalationInput {
  mode?: unknown;
  sensitivity?: unknown;
  ticketsEnabled: boolean;
  /** Shopper messages, oldest → newest; the last one is the message being answered. */
  userMessages: string[];
  /** Assistant replies before this turn, oldest → newest. */
  previousAssistantMessages?: string[];
  aiReply?: string;
  /** The model itself asked to escalate (tool call / JSON flag). */
  aiRequestedTicket?: boolean;
}

export function decideEscalation(input: EscalationInput): EscalationDecision {
  const configuredMode = normalizeEscalationMode(input.mode);
  const mode: EscalationMode = input.ticketsEnabled ? configuredMode : 'contact_only';
  const sensitivity = normalizeEscalationSensitivity(input.sensitivity);
  const thresholds = THRESHOLDS[sensitivity];

  const latest = input.userMessages[input.userMessages.length - 1] || '';
  const earlier = input.userMessages.slice(0, -1);
  const recent = input.userMessages.slice(-4);
  const reasons: string[] = [];
  let score = 0;

  const askedForHuman = HUMAN_REQUEST.test(latest);
  if (askedForHuman) reasons.push('asked_for_human');

  const triage = triageByRules(latest, recent.slice(0, -1).map(content => ({ role: 'user', content })));
  if (triage.sentiment === 'angry') { score += 3; reasons.push('angry'); }
  else if (triage.sentiment === 'negative') { score += 1; reasons.push('negative'); }

  if (triage.category === 'damaged_missing' || PAYMENT_PROBLEM.test(recent.join('\n'))) {
    score += 3; reasons.push('high_risk_issue');
  } else if (triage.category === 'return_refund') {
    score += 1; reasons.push('refund_or_return');
  }

  if (isRepeatQuestion(latest, earlier.slice(-4))) { score += 3; reasons.push('repeated_question'); }

  const unsureReplies = [...(input.previousAssistantMessages || []).slice(-3), input.aiReply || ''].filter(t => AI_UNSURE.test(t)).length;
  if (unsureReplies > 0) { score += Math.min(unsureReplies, 2) * 2; reasons.push('ai_could_not_answer'); }

  if (input.aiRequestedTicket) { score += 2; reasons.push('ai_suggested_team'); }

  if (input.userMessages.length >= 7) { score += 2; reasons.push('long_conversation'); }
  else if (input.userMessages.length >= 4) { score += 1; reasons.push('long_conversation'); }

  let level: EscalationLevel = 'none';
  if (mode === 'contact_only') {
    level = askedForHuman || score >= thresholds.soft ? 'contact' : 'none';
  } else if (mode === 'instant') {
    level = askedForHuman || input.aiRequestedTicket || score >= thresholds.offer ? 'offer' : 'none';
  } else if (askedForHuman || score >= thresholds.offer) {
    level = 'offer';
  } else if (score >= thresholds.soft) {
    level = 'soft';
  }

  return { level, mode, score, reasons };
}
