/**
 * Merchant-controlled product recommendation behaviour (My Agent -> Product recommendations).
 *
 * suggestion mode
 *  - ask_first: the assistant asks before showing products; cards/links are only sent once the
 *               shopper says yes or explicitly asks for products. Enforced here on the server, so
 *               the rule holds even when the model forgets its instructions.
 *  - direct:    products are shown as soon as the need is clear.
 * display style: cards | compact | links (links = clickable text links, never Add to cart)
 */

export const SUGGESTION_MODES = ['ask_first', 'direct'] as const;
export type SuggestionMode = (typeof SUGGESTION_MODES)[number];
export const DISPLAY_STYLES = ['cards', 'compact', 'links'] as const;
export type DisplayStyle = (typeof DISPLAY_STYLES)[number];

export interface RecommendationSettings {
  suggestionMode: SuggestionMode;
  displayStyle: DisplayStyle;
  maxRecommendations: 1 | 2 | 3;
  showVariants: boolean;
  showReason: boolean;
}

export function normalizeRecommendationSettings(row: any): RecommendationSettings {
  const max = parseInt(String(row?.max_recommendations ?? '3'), 10);
  return {
    suggestionMode: SUGGESTION_MODES.includes(row?.product_suggestion_mode) ? row.product_suggestion_mode : 'ask_first',
    displayStyle: DISPLAY_STYLES.includes(row?.product_display_style) ? row.product_display_style : 'cards',
    maxRecommendations: (max >= 1 && max <= 3 ? max : 3) as 1 | 2 | 3,
    showVariants: !(row?.show_product_variants === false || row?.show_product_variants === 'false'),
    showReason: !(row?.show_product_reason === false || row?.show_product_reason === 'false'),
  };
}

/** Public shape sent to the widget config */
export function widgetRecommendationConfig(s: RecommendationSettings) {
  return {
    suggestion_mode: s.suggestionMode,
    display_style: s.displayStyle,
    max: s.maxRecommendations,
    show_variants: s.showVariants,
    show_reason: s.showReason,
  };
}

// The shopper asks to see products outright
const EXPLICIT_PRODUCT_REQUEST = /\b(show( me)?|recommend|suggest|options?|which (one|product|pack|size)|what should i (buy|get|order)|best (one|seller|sellers|product|option)|bestsellers?|link|buy|add to cart|price of|how much (is|does)|compare|dikhao|dikhaiye|dikha do|batao kaunsa|kaunsa (lu|lena|product)|suggest karo|recommend karo)\b/i;
// Assistant offered to show products in its previous turn
const OFFER_IN_REPLY = /(would you like (me )?to (see|show)|shall i show|should i show|want me to show|show you (a few|some) (options|products)|i can show you)/i;
// Short consent after an offer
const CONSENT = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|please|go ahead|show|haan|han|ha|ji|haan ji|bilkul|dikhao)\b/i;
const DECLINE = /^\s*(no|nope|not now|no thanks|nahi|nhi|mat)\b/i;

export function shopperWantsProducts(latestUserMessage: string, previousAssistantMessage = ''): boolean {
  const latest = latestUserMessage || '';
  if (DECLINE.test(latest)) return false;
  if (EXPLICIT_PRODUCT_REQUEST.test(latest)) return true;
  return OFFER_IN_REPLY.test(previousAssistantMessage || '') && CONSENT.test(latest);
}

export function replyOffersProducts(aiText: string): boolean {
  return OFFER_IN_REPLY.test(aiText || '');
}

export interface PolicyInput {
  settings: RecommendationSettings;
  latestUserMessage: string;
  previousAssistantMessage?: string;
  productIds: string[];
  aiText: string;
}

export interface PolicyResult {
  productIds: string[];
  /** Show "Yes, show me / No thanks" chips under the reply */
  productOffer: boolean;
  /** Products were held back because the shopper has not asked for them yet */
  heldBack: boolean;
}

export function applyRecommendationPolicy(input: PolicyInput): PolicyResult {
  const { settings } = input;
  const ids = [...new Set(input.productIds)].slice(0, settings.maxRecommendations);
  if (settings.suggestionMode === 'direct') {
    return { productIds: ids, productOffer: false, heldBack: false };
  }
  if (shopperWantsProducts(input.latestUserMessage, input.previousAssistantMessage)) {
    return { productIds: ids, productOffer: false, heldBack: false };
  }
  const heldBack = ids.length > 0;
  return { productIds: [], productOffer: heldBack || replyOffersProducts(input.aiText), heldBack };
}

/** Appended when the model showed products too early and they were held back */
export const PRODUCT_OFFER_QUESTION = 'Would you like me to show a few options that fit?';

/**
 * Extra fields on a recommendation sent to the widget: the AI's one-line "why this fits"
 * and the variant picker data, each only when the merchant has it switched on.
 */
export function recommendationExtras(
  product: { variants?: unknown[]; options?: unknown[] },
  settings: RecommendationSettings,
  reason?: string
): { why?: string; variants?: unknown[]; options?: unknown[] } {
  const extras: { why?: string; variants?: unknown[]; options?: unknown[] } = {};
  const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (settings.showReason && why) extras.why = why;
  if (settings.showVariants && Array.isArray(product.variants) && product.variants.length > 1) {
    extras.variants = product.variants.slice(0, 25);
    extras.options = Array.isArray(product.options) ? product.options : [];
  }
  return extras;
}
