import { ShopifyProduct } from '../../providers/shopify/shopify.adapter';

/**
 * Which products the shopping assistant sees, and which product cards it may show.
 *
 * Works for any store's catalogue: word weights come from the catalogue itself (a word in
 * every title, such as the brand name, counts for little), matches are whole words (so
 * "itch" never matches "stitch"), and a card must relate to what the shopper asked or be
 * named in the reply. Nothing here is specific to one merchant.
 */

/** Catalogues up to this size go to the model whole, most relevant first. */
export const FULL_CATALOG_LIMIT = 120;
/** Larger catalogues: this many products (relevant first, then bestsellers). */
export const LARGE_CATALOG_PROMPT_LIMIT = 60;
/** How many rows the adapter should load before ranking. */
export const CATALOG_SCAN_LIMIT = 500;
/** Top relevant products that keep a longer description in the prompt. */
export const DETAILED_PRODUCTS = 6;
/** A card must score at least this share of the best match (unless the reply names it). */
export const CARD_RELEVANCE_SHARE = 0.35;

export type ProductIntent = 'info' | 'discovery';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'without', 'from', 'into', 'onto', 'of', 'to', 'in', 'on', 'at',
  'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'have', 'has', 'had',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must', 'what', 'which', 'who', 'whom', 'whose',
  'when', 'where', 'why', 'how', 'this', 'that', 'these', 'those', 'there', 'here', 'it', 'its', 'you', 'your',
  'yours', 'we', 'our', 'ours', 'they', 'their', 'them', 'he', 'she', 'his', 'her', 'me', 'my', 'mine', 'i', 'us',
  'any', 'some', 'all', 'more', 'most', 'very', 'just', 'also', 'too', 'than', 'then', 'so', 'if', 'not', 'no',
  'yes', 'ok', 'okay', 'please', 'thanks', 'thank', 'hi', 'hello', 'hey', 'want', 'need', 'looking', 'show', 'tell',
  'give', 'get', 'got', 'know', 'like', 'about', 'buy', 'good', 'best', 'new', 'one', 'ones', 'thing', 'things',
  'option', 'options', 'product', 'products', 'item', 'items', 'something', 'anything', 'suggest', 'recommend',
  // Hinglish / Hindi in Latin script
  'hai', 'hain', 'ho', 'hota', 'hoti', 'kya', 'kaun', 'kaunsa', 'kaunsi', 'ko', 'ke', 'ki', 'ka', 'liye', 'karo',
  'kare', 'mujhe', 'hum', 'chahiye', 'batao', 'dikhao', 'dikhaye', 'aur', 'nahi', 'nhi', 'mein', 'me', 'se', 'bhi',
  'isme', 'yeh', 'ye', 'woh', 'wo', 'kaise', 'kitna', 'kitne',
]);

/** Plural and "-ing" endings folded so "ingredients" matches "ingredient". */
export function normalizeToken(raw: string): string {
  let w = raw.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map(normalizeToken)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

interface IndexedProduct {
  product: ShopifyProduct;
  title: Set<string>;
  tags: Set<string>;
  desc: Set<string>;
}

export interface CatalogIndex {
  items: IndexedProduct[];
  /** Inverse document frequency per token (higher = rarer = more telling). */
  idf: Map<string, number>;
  /** Share of products whose TITLE contains the token. */
  titleShare: Map<string, number>;
}

export function buildCatalogIndex(products: ShopifyProduct[]): CatalogIndex {
  const items: IndexedProduct[] = products.map((product) => ({
    product,
    title: new Set(tokenize(product.title)),
    tags: new Set(tokenize(`${(product.tags || []).join(' ')} ${product.category || ''}`)),
    desc: new Set(tokenize(product.description || '')),
  }));
  const df = new Map<string, number>();
  const titleDf = new Map<string, number>();
  for (const item of items) {
    for (const t of new Set([...item.title, ...item.tags, ...item.desc])) df.set(t, (df.get(t) || 0) + 1);
    for (const t of item.title) titleDf.set(t, (titleDf.get(t) || 0) + 1);
  }
  const n = Math.max(1, items.length);
  const idf = new Map<string, number>();
  for (const [t, count] of df) idf.set(t, Math.log(1 + n / (1 + count)));
  const titleShare = new Map<string, number>();
  for (const [t, count] of titleDf) titleShare.set(t, count / n);
  return { items, idf, titleShare };
}

/** Whole-word match, plus prefix match for longer words ("itchy" ~ "itch", "itching" ~ "itch"). */
function fieldHas(field: Set<string>, q: string): boolean {
  if (field.has(q)) return true;
  if (q.length < 4) return false;
  for (const t of field) {
    if (t.length >= 4 && (t.startsWith(q) || q.startsWith(t))) return true;
  }
  return false;
}

export function scoreItem(item: IndexedProduct, queryTokens: string[], idf: Map<string, number>): number {
  let score = 0;
  for (const q of new Set(queryTokens)) {
    // "dog" / "women" say who it is for, not what it is: handled by the audience filter instead
    if (AUDIENCE_WORDS.has(q)) continue;
    const weight = fieldHas(item.title, q) ? 3 : fieldHas(item.tags, q) ? 2 : fieldHas(item.desc, q) ? 1 : 0;
    if (weight === 0) continue;
    // Prefix matches borrow the idf of the exact token when the query word itself is unseen
    const w = idf.get(q) ?? Math.log(2);
    score += w * weight;
  }
  return score;
}

// Audiences a shopper can name that rule out products made for the other one.
const AUDIENCES: string[][][] = [
  [['dog', 'puppy', 'pup', 'canine', 'k9'], ['cat', 'kitten', 'kitty', 'feline']],
  [['men', 'man', 'male', 'boy', 'gent'], ['women', 'woman', 'female', 'lady', 'girl']],
];

const AUDIENCE_WORDS = new Set(AUDIENCES.flat(2));

function audienceOf(tokens: Set<string>): Array<number | null> {
  return AUDIENCES.map((options) => {
    const hits = options.map((words) => words.some((w) => tokens.has(w)));
    const count = hits.filter(Boolean).length;
    return count === 1 ? hits.indexOf(true) : null; // both or neither = no preference
  });
}

/** True when the shopper named one audience (e.g. "dog") and the product is only for another ("cat"). */
function audienceConflict(item: IndexedProduct, queryAudience: Array<number | null>): boolean {
  const productAudience = audienceOf(new Set([...item.title, ...item.tags]));
  return queryAudience.some((q, i) => q !== null && productAudience[i] !== null && productAudience[i] !== q);
}

const UTILITY_TITLE = /\b(shipping|package|order|parcel)\s+(protection|insurance)\b|\bgift\s*cards?\b|\brefund\b|\bdonations?\b/i;

/** Service lines such as shipping protection, gift cards or hidden items are never recommended. */
export function isSellableProduct(p: ShopifyProduct): boolean {
  if (!p || !p.title) return false;
  if ((p.tags || []).some((t) => String(t).trim().toLowerCase() === 'hidden')) return false;
  if (UTILITY_TITLE.test(p.title)) return false;
  return p.in_stock !== false && Number(p.price) > 0;
}

const INFO_PATTERN = new RegExp(
  [
    'ingredient', 'ingrediant', 'composition', 'contains?', 'made (?:of|from|with)', 'what(?:\'s| is) (?:in|inside)',
    'how (?:do|to|should|can) (?:i |we )?(?:use|give|apply|feed|store)', 'how (?:much|many) (?:to|should|per)',
    'dosage', 'dose', 'side[- ]?effects?', 'safe (?:for|to)', 'suitable for', 'expiry', 'shelf life',
    'price of', 'how much (?:is|does|for)', 'kitne ka', 'kitna', 'kaise use', 'kya (?:hai|hota) (?:isme|is me)',
  ].map((p) => `\\b${p}`).join('|'),
  'i'
);

/** "What are the ingredients in X" / "how do I use it" = a question about a product, not a request for options. */
export function detectProductIntent(message: string): ProductIntent {
  return INFO_PATTERN.test(message || '') ? 'info' : 'discovery';
}

export interface CatalogSelectionInput {
  message: string;
  recentUserTurns?: string[];
  budgetMax?: number;
  bestsellerOnly?: boolean;
}

export interface CatalogSelection {
  products: ShopifyProduct[];
  /** The first `detailed` products keep a longer description; the first `focus` a full one. */
  detailed: number;
  focus: number;
  /** Titles of the products the question is clearly about (feeds knowledge retrieval). */
  focusTitles: string[];
  intent: ProductIntent;
}

function rankValue(p: ShopifyProduct): number {
  return p.sales_rank && p.sales_rank < 999 ? p.sales_rank : 9999;
}

/** Orders the store's catalogue for one chat turn and trims it to what the model should see. */
export function selectCatalogForPrompt(catalog: ShopifyProduct[], input: CatalogSelectionInput): CatalogSelection {
  const intent = detectProductIntent(input.message);
  let pool = (catalog || []).filter(isSellableProduct);
  if (input.budgetMax && input.budgetMax > 0) pool = pool.filter((p) => Number(p.price) <= input.budgetMax!);
  if (input.bestsellerOnly && pool.some((p) => p.is_bestseller)) pool = pool.filter((p) => p.is_bestseller);

  const index = buildCatalogIndex(pool);
  const messageTokens = tokenize(input.message);
  const contextTokens = tokenize((input.recentUserTurns || []).join(' '));
  const queryAudience = audienceOf(new Set([...messageTokens, ...contextTokens]));

  const scored = index.items
    .filter((item) => !audienceConflict(item, queryAudience))
    .map((item) => ({
      item,
      // The latest message decides; earlier turns only carry the topic of short follow-ups
      score: scoreItem(item, messageTokens, index.idf) + 0.5 * scoreItem(item, contextTokens, index.idf),
    }));

  scored.sort((a, b) => {
    if (input.bestsellerOnly) return rankValue(a.item.product) - rankValue(b.item.product);
    if (b.score !== a.score) return b.score - a.score;
    if (Boolean(b.item.product.is_bestseller) !== Boolean(a.item.product.is_bestseller)) {
      return b.item.product.is_bestseller ? 1 : -1;
    }
    return rankValue(a.item.product) - rankValue(b.item.product);
  });

  let chosen = scored;
  if (scored.length > FULL_CATALOG_LIMIT) {
    const relevant = scored.filter((s) => s.score > 0).slice(0, LARGE_CATALOG_PROMPT_LIMIT);
    const fill = scored
      .filter((s) => s.score <= 0)
      .sort((a, b) => rankValue(a.item.product) - rankValue(b.item.product))
      .slice(0, Math.max(0, LARGE_CATALOG_PROMPT_LIMIT - relevant.length));
    chosen = [...relevant, ...fill];
  }

  const best = chosen[0]?.score || 0;
  const relevantCount = best > 0 ? chosen.filter((s) => s.score > 0).length : 0;
  const focus = best > 0 ? chosen.filter((s) => s.score >= best * 0.6).slice(0, 2) : [];
  return {
    products: chosen.map((s) => s.item.product),
    detailed: Math.min(DETAILED_PRODUCTS, relevantCount),
    focus: intent === 'info' ? focus.length : 0,
    focusTitles: focus.map((s) => s.item.product.title),
    intent,
  };
}

/** Title words that tell products apart (not the brand name or words in half the titles). */
function distinctiveTitleWords(item: IndexedProduct, index: CatalogIndex): string[] {
  return [...item.title].filter((t) => t.length >= 3 && (index.titleShare.get(t) ?? 0) < 0.4);
}

/** The reply really talks about this product: its short name, or most of its distinctive title words. */
export function isNamedInReply(product: ShopifyProduct, reply: string, index: CatalogIndex): boolean {
  const item = index.items.find((i) => i.product.id === product.id);
  if (!item || !reply) return false;
  const replyLower = reply.toLowerCase();
  const shortTitle = product.title.toLowerCase().split(/[:|–—(]| - /)[0].trim();
  const shortDistinct = [...new Set(tokenize(shortTitle))].filter((t) => (index.titleShare.get(t) ?? 0) < 0.4);
  if (shortTitle.length >= 6 && shortDistinct.length > 0 && replyLower.includes(shortTitle)) return true;
  const words = distinctiveTitleWords(item, index);
  if (words.length === 0) return false;
  const replyTokens = new Set(tokenize(reply));
  const present = words.filter((w) => fieldHas(replyTokens, w)).length;
  return present >= Math.min(2, words.length) && present / words.length >= 0.6;
}

export interface CardFilterInput {
  productIds: string[];
  /** Products the model could pick from (the prompt catalogue plus any resolved by name). */
  products: ShopifyProduct[];
  message: string;
  recentUserTurns?: string[];
  reply: string;
  intent: ProductIntent;
}

/**
 * Last check before product cards reach the shopper. A card stays when the reply names it,
 * or when it relates to the conversation about as well as the best match does. Product
 * questions ("what are the ingredients in X") show at most the one product asked about.
 */
export function filterRelevantCards(input: CardFilterInput): string[] {
  const ids = [...new Set(input.productIds || [])];
  if (ids.length === 0) return [];
  const index = buildCatalogIndex(input.products || []);
  const byId = new Map(index.items.map((i) => [i.product.id, i]));
  const messageTokens = tokenize(input.message);
  const contextTokens = tokenize((input.recentUserTurns || []).join(' '));
  const queryAudience = audienceOf(new Set([...messageTokens, ...contextTokens]));
  const scoreOf = (item: IndexedProduct) =>
    scoreItem(item, messageTokens, index.idf) + 0.5 * scoreItem(item, contextTokens, index.idf);
  const best = Math.max(0, ...index.items.map(scoreOf));

  const candidates = ids
    .map((id) => byId.get(id))
    .filter((item): item is IndexedProduct => Boolean(item) && isSellableProduct(item!.product))
    .filter((item) => !audienceConflict(item, queryAudience))
    .map((item) => ({ item, score: scoreOf(item), named: isNamedInReply(item.product, input.reply, index) }));
  const anyNamed = candidates.some((c) => c.named);
  const kept = candidates.filter((c) => {
    if (c.named) return true;
    // No question word matches any product (a purely descriptive ask): the reply's named picks
    // decide; when it names none, trust the model's choice
    if (best === 0) return !anyNamed;
    return c.score >= best * CARD_RELEVANCE_SHARE;
  });

  if (input.intent === 'info' && kept.length > 1) {
    const top = [...kept].sort((a, b) => Number(b.named) - Number(a.named) || b.score - a.score)[0];
    return [top.item.product.id];
  }
  return kept.map((c) => c.item.product.id);
}
