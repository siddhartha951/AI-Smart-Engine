/**
 * Order tracking inside the storefront chat, decided before the AI is called:
 *
 *  1. Shopper asks about an order        -> we ask for order number + email/phone (no AI cost)
 *  2. Shopper gives both                 -> live Shopify lookup; contact must match the order
 *  3. Verified                           -> order card in the chat + order facts for the AI,
 *                                           so "kab aayega?" is answered from the real order
 *  4. Later turns in the same chat       -> the verified order stays available (refreshed
 *                                           from Shopify at most every 5 minutes)
 *
 * Wrong details are limited to MAX_FAILED_ATTEMPTS per chat, so nobody can guess orders.
 * Nothing personal is stored: only the order reference and the (address-free) card.
 */
import { IDatabaseClient } from '../../database/client';
import { classifyMessageLanguage } from '../ai_agent/language';
import { extractEmail, extractOrderRef, extractPhone, isOrderQuestion } from './order-intent';
import { LookupOutcome, OrderCard, fetchOrderCardById, lookupOrderForShopper, orderContextText } from './order-lookup.service';

export const MAX_FAILED_ATTEMPTS = 5;
const VERIFIED_TTL_MS = 3 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 5 * 60 * 1000;

export type OrderTurn =
  | { kind: 'none' }
  /** Answer directly, without the AI */
  | { kind: 'reply'; text: string; order?: OrderCard }
  /** Let the AI answer, with these verified order facts (and show the card when asked) */
  | { kind: 'context'; context: string; order: OrderCard | null };

interface LookupRow {
  id: string;
  status: 'awaiting' | 'verified' | 'failed';
  order_ref: string | null;
  shopify_order_id: string | null;
  snapshot: OrderCard | null;
  failed_attempts: number;
  fetched_at: Date | null;
  updated_at: Date;
}

function parseSnapshot(v: unknown): OrderCard | null {
  if (!v) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v as OrderCard;
}

async function latestRow(db: IDatabaseClient, storeId: string, sessionId: string): Promise<LookupRow | null> {
  const res = await db.query(
    `SELECT * FROM chat_order_lookups WHERE store_id = $1 AND session_id = $2 ORDER BY updated_at DESC LIMIT 1`,
    [storeId, sessionId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    order_ref: r.order_ref,
    shopify_order_id: r.shopify_order_id,
    snapshot: parseSnapshot(r.snapshot),
    failed_attempts: Number(r.failed_attempts || 0),
    fetched_at: r.fetched_at ? new Date(r.fetched_at) : null,
    updated_at: new Date(r.updated_at),
  };
}

async function saveRow(
  db: IDatabaseClient,
  storeId: string,
  sessionId: string,
  existing: LookupRow | null,
  patch: { status: LookupRow['status']; order_ref?: string | null; shopify_order_id?: string | null; snapshot?: OrderCard | null; failed_attempts?: number; fetched?: boolean }
): Promise<void> {
  const snapshot = patch.snapshot === undefined ? existing?.snapshot ?? null : patch.snapshot;
  const values = [
    patch.status,
    patch.order_ref === undefined ? existing?.order_ref ?? null : patch.order_ref,
    patch.shopify_order_id === undefined ? existing?.shopify_order_id ?? null : patch.shopify_order_id,
    snapshot ? JSON.stringify(snapshot) : null,
    patch.failed_attempts ?? existing?.failed_attempts ?? 0,
    patch.fetched ? new Date().toISOString() : existing?.fetched_at?.toISOString() ?? null,
  ];
  if (existing) {
    await db.query(
      `UPDATE chat_order_lookups SET status = $3, order_ref = $4, shopify_order_id = $5, snapshot = $6::jsonb,
         failed_attempts = $7, fetched_at = $8::timestamptz, updated_at = NOW()
       WHERE store_id = $1 AND id = $2`,
      [storeId, existing.id, ...values]
    );
  } else {
    await db.query(
      `INSERT INTO chat_order_lookups (store_id, session_id, status, order_ref, shopify_order_id, snapshot, failed_attempts, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz)`,
      [storeId, sessionId, ...values]
    );
  }
}

function hinglish(message: string): boolean {
  return classifyMessageLanguage(message) !== 'english';
}

const TEXT = {
  askBoth: {
    en: 'I can check that for you. Please share your **order number** (for example #1234) and the **email or phone number** used for the order.',
    hi: 'Main aapka order check kar deta hoon. Kripya apna **order number** (jaise #1234) aur order mein diya gaya **email ya phone number** bhejiye.',
  },
  askContact: {
    en: 'Thanks! To keep your order private, please also share the **email or phone number** used when placing order {ref}.',
    hi: 'Shukriya! Aapke order ki privacy ke liye, order {ref} mein diya gaya **email ya phone number** bhi bhejiye.',
  },
  askNumber: {
    en: 'Thanks! Now please share your **order number** (you will find it in the order confirmation email, for example #1234).',
    hi: 'Shukriya! Ab apna **order number** bhejiye (yeh order confirmation email mein milega, jaise #1234).',
  },
  notFound: {
    en: 'I could not find order {ref}. Please check the number in your confirmation email and send it again.',
    hi: 'Order {ref} nahi mila. Kripya confirmation email mein order number check karke dobara bhejiye.',
  },
  mismatch: {
    en: 'The email or phone number does not match order {ref}. Please use the same email or phone you gave at checkout.',
    hi: 'Yeh email ya phone number order {ref} se match nahi hua. Kripya wahi email ya phone bhejiye jo checkout par diya tha.',
  },
  locked: {
    en: 'For your security I cannot check more order details in this chat. Please use the link in your order confirmation email, or contact us{contact}.',
    hi: 'Security ke liye is chat mein aur order details check nahi ho sakti. Kripya order confirmation email ka link use kijiye, ya humse sampark kijiye{contact}.',
  },
  unavailable: {
    en: 'I cannot open order details right now. Please use the order status link in your confirmation email, or contact us{contact} and our team will help.',
    hi: 'Abhi order details nahi khul pa rahi. Kripya confirmation email ka order status link dekhiye, ya humse sampark kijiye{contact}, hamari team madad karegi.',
  },
  found: {
    en: 'Here are the latest details for order {ref}.',
    hi: 'Order {ref} ki latest details yeh rahi.',
  },
};

function say(key: keyof typeof TEXT, message: string, vars: Record<string, string> = {}): string {
  let text = hinglish(message) ? TEXT[key].hi : TEXT[key].en;
  for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(v);
  return text;
}

export interface OrderTurnInput {
  db: IDatabaseClient;
  storeId: string;
  sessionId: string;
  message: string;
  /** e.g. "support@store.com" – shown when we cannot look the order up */
  supportContact?: string;
  lookup?: typeof lookupOrderForShopper;
  refresh?: typeof fetchOrderCardById;
}

export async function resolveOrderTurn(input: OrderTurnInput): Promise<OrderTurn> {
  const { db, storeId, sessionId, message } = input;
  const lookup = input.lookup || lookupOrderForShopper;
  const refresh = input.refresh || fetchOrderCardById;
  const contactNote = input.supportContact ? ` at ${input.supportContact}` : '';

  let row: LookupRow | null = null;
  try {
    row = await latestRow(db, storeId, sessionId);
  } catch {
    return { kind: 'none' }; // table missing before migration 040: chat works as before
  }

  const asking = isOrderQuestion(message);
  const awaiting = row?.status === 'awaiting' && Date.now() - row.updated_at.getTime() < 30 * 60 * 1000;
  const email = extractEmail(message);
  const phone = extractPhone(message);
  // A bare number counts as the order number only when we asked for it (or in an order question)
  const typedRef = extractOrderRef(message, (awaiting && message.length <= 80) || asking);
  const ref = typedRef || (awaiting ? row?.order_ref || null : null);
  const verifiedFresh = row?.status === 'verified' && row.snapshot && Date.now() - row.updated_at.getTime() < VERIFIED_TTL_MS;

  // Follow-up about an order already verified in this chat ("kab aayega?", "can I return it?")
  if (verifiedFresh && !email && !phone && (!typedRef || typedRef.replace(/^#/, '') === String(row!.order_ref || '').replace(/^#/, ''))) {
    let card = row!.snapshot!;
    const stale = !row!.fetched_at || Date.now() - row!.fetched_at.getTime() > REFRESH_AFTER_MS;
    if (stale && asking) {
      // Status may have changed (shipped / delivered): refresh quietly, keep the old card on failure
      const again = row!.shopify_order_id
        ? await refresh(storeId, row!.shopify_order_id, { db }).catch(() => null)
        : null;
      if (again) {
        card = again;
        await saveRow(db, storeId, sessionId, row, { status: 'verified', snapshot: again, fetched: true });
      }
    }
    return { kind: 'context', context: orderContextText(card), order: asking ? card : null };
  }

  // While we wait for details, an unrelated question ("show me dog food") goes to the AI as usual
  const givesDetails = Boolean(typedRef || email || phone);
  const touchesOrders = asking || (awaiting && givesDetails) || Boolean((email || phone) && typedRef);
  if (!touchesOrders) return { kind: 'none' };

  if ((row?.failed_attempts || 0) >= MAX_FAILED_ATTEMPTS) {
    return { kind: 'reply', text: say('locked', message, { contact: contactNote }) };
  }

  if (!ref && !email && !phone) {
    await saveRow(db, storeId, sessionId, row, { status: 'awaiting', order_ref: null });
    return { kind: 'reply', text: say('askBoth', message) };
  }
  if (!ref) {
    await saveRow(db, storeId, sessionId, row, { status: 'awaiting', order_ref: row?.order_ref ?? null });
    return { kind: 'reply', text: say('askNumber', message) };
  }
  if (!email && !phone) {
    await saveRow(db, storeId, sessionId, row, { status: 'awaiting', order_ref: ref });
    return { kind: 'reply', text: say('askContact', message, { ref: `#${ref.replace(/^#/, '')}` }) };
  }

  const outcome: LookupOutcome = await lookup(storeId, ref, { email, phone }, { db });
  const shownRef = `#${ref.replace(/^#/, '')}`;
  if (outcome.status === 'verified') {
    await saveRow(db, storeId, sessionId, row, {
      status: 'verified',
      order_ref: ref,
      shopify_order_id: outcome.shopifyOrderId,
      snapshot: outcome.card,
      failed_attempts: 0,
      fetched: true,
    });
    // A message that only carries the details gets a direct answer; a real question goes to the AI with the facts
    const onlyDetails = message.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ' ').replace(/[#\d\s+\-,.:]/g, '').replace(/\b(order|no|number|email|phone|mobile|id|and|aur|hai|my|mera|is)\b/gi, '').trim().length < 4;
    if (onlyDetails) return { kind: 'reply', text: say('found', message, { ref: outcome.card.name || shownRef }), order: outcome.card };
    return { kind: 'context', context: orderContextText(outcome.card), order: outcome.card };
  }
  if (outcome.status === 'not_found' || outcome.status === 'mismatch') {
    await saveRow(db, storeId, sessionId, row, {
      status: 'awaiting',
      order_ref: outcome.status === 'mismatch' ? ref : null,
      failed_attempts: (row?.failed_attempts || 0) + 1,
    });
    return { kind: 'reply', text: say(outcome.status === 'mismatch' ? 'mismatch' : 'notFound', message, { ref: shownRef }) };
  }
  // blocked (missing read_orders), not connected, unverifiable or Shopify down: never guess
  await saveRow(db, storeId, sessionId, row, { status: 'failed', order_ref: ref });
  return { kind: 'reply', text: say('unavailable', message, { contact: contactNote }) };
}
