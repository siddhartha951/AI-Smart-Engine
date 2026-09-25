/**
 * Reading a shopper's order question: is it about an order, which order number,
 * and which email / phone they gave to prove it is theirs. English + Hinglish.
 */

const ORDER_WORDS = /\b(order|orders|ordr|oder|track|tracking|shipment|shipped|shipping|dispatch(ed)?|deliver(y|ed)?|parcel|package|courier|awb|consignment)\b/i;
const STATUS_WORDS = /\b(where|status|when|kab|kaha|kahan|kidhar|abhi tak|nahi aaya|nhi aaya|nahi aya|not (yet )?(received|arrived|delivered)|late|delay(ed)?|arrive|reach|pahunch|aayega|ayega|aaega|milega|cancel|refund|return)\b/i;

/** "Where is my order", "track my order", "mera order kab aayega", "#1234 status" */
export function isOrderQuestion(message: string): boolean {
  const text = (message || '').toLowerCase();
  if (!text.trim()) return false;
  if (/\btrack\b/.test(text) && /\b(order|parcel|package|shipment)\b/.test(text)) return true;
  if (/(^|\s)#\s?[a-z]{0,6}-?\d{3,}/i.test(text) && (ORDER_WORDS.test(text) || STATUS_WORDS.test(text))) return true;
  return ORDER_WORDS.test(text) && STATUS_WORDS.test(text);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export function extractEmail(message: string): string | null {
  const m = (message || '').match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

/** 10-13 digit phone number (spaces, dashes and +country code allowed) */
export function extractPhone(message: string): string | null {
  const withoutEmail = (message || '').replace(EMAIL_RE, ' ');
  const candidates = withoutEmail.match(/\+?\d[\d\s-]{8,16}\d/g) || [];
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) return digits;
  }
  return null;
}

/**
 * Order number: "#1234", "#ANW1234", "order 1234", "order no. 1234", "order id: 1234",
 * or (when we just asked for it) a bare 3-9 digit number. Never a phone number.
 */
export function extractOrderRef(message: string, expectingNumber = false): string | null {
  const text = (message || '').replace(EMAIL_RE, ' ');
  const hash = text.match(/#\s?([a-z]{0,6}-?\d{3,10})\b/i);
  if (hash) return hash[1].toUpperCase();
  const labelled = text.match(/\border\s*(?:no\.?|number|num|id|#)?\s*[:\-]?\s*([a-z]{0,6}-?\d{3,10})\b/i);
  if (labelled && labelled[1].replace(/\D/g, '').length <= 9) return labelled[1].toUpperCase();
  if (expectingNumber) {
    for (const m of text.match(/\b[a-z]{0,6}-?\d{3,10}\b/gi) || []) {
      const digits = m.replace(/\D/g, '');
      if (digits.length >= 3 && digits.length <= 9) return m.toUpperCase();
    }
  }
  return null;
}

/** Digits of an order reference, for matching "#1234" with "1234" or "AN1234" */
export function refDigits(ref: string): string {
  return String(ref || '').replace(/\D/g, '');
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Last 10 digits, so +91 98765 43210 matches 9876543210 */
export function normalizePhone(phone: unknown): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}
