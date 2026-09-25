import { describe, it, expect } from 'vitest';
import {
  detectProductIntent,
  filterRelevantCards,
  isSellableProduct,
  selectCatalogForPrompt,
  tokenize,
  FULL_CATALOG_LIMIT,
  LARGE_CATALOG_PROMPT_LIMIT,
} from '../../src/modules/chat/product-relevance';
import { matchBoldProductMentions } from '../../src/providers/ai/ai.utils';
import { buildCatalogSummary } from '../../src/providers/ai/shopper-prompt';
import { ShopifyProduct } from '../../src/providers/shopify/shopify.adapter';

// A pet store catalogue shaped like a real Shopify export: brand name in every title, most
// descriptions empty, internal tags, service products mixed in.
function product(id: string, title: string, extra: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id, variant_id: `v_${id}`, title, price: 999, currency: 'INR', in_stock: true, category: '',
    image_url: '', product_url: `https://shop.example/products/${id}`, tags: [], description: '', ...extra,
  };
}

const CATALOG: ShopifyProduct[] = [
  product('itch_dog', 'Aniwell Itch Relief Formula: A Turmeric & Vitamin E Booster For Hot Spots, Dermatitis & Allergies', { tags: ['dog', 'recommended'] }),
  product('itch_cat', 'Aniwell Feline Itch Relief: A Natural Formula for Itching & Skin Discomfort in Cats', { tags: ['cat', 'show_bundle_popup'] }),
  product('kit_dog', 'Aniwell Canine Flea & Itch Care Kit - Itch Relief Formula + Flea Comb', { tags: ['dog'] }),
  product('fresh_food', 'Aniwell Fresh Food with Real Meat, Veggies & Natural Herbs', {
    tags: ['dog', 'fresh food'], is_bestseller: true, sales_rank: 1,
    description: 'Made with human-grade ingredients. Every ingredient is sourced fresh and cooked gently.',
  }),
  product('duck_toy', 'Aniwell Interactive Duck Toy - Treat Dispenser for Dogs & Cats', { is_bestseller: true, sales_rank: 2, description: 'Durable stitched fabric, switch between treat modes.' }),
  product('wishbone', 'Aniwell Wishbone - Bacon Flavored Dog Chew Toy', { is_bestseller: true, sales_rank: 3 }),
  product('gut_dog', 'Aniwell Probiotic Formula: Powered by Moringa, DE111, SeaMoss', { tags: ['dog'] }),
  product('hip_joint', 'Aniwell Hip & Joint Formula: Powered by Green Lipped Mussel, Glucosamine', { tags: ['dog'] }),
  product('hairball', 'Aniwell Hairball Formula - Omega-3s & Biotin for Cats', { tags: ['cat'] }),
  product('shipping', 'Premium Shipping Protection', { tags: ['hidden'], price: 99 }),
  product('refund', 'GET A $6 REFUND - RIGHT NOW', { price: 1 }),
  product('draft_out', 'Aniwell Dog Wipes - Plant-Based', { in_stock: false }),
];

const INGREDIENT_Q = 'What are the ingredient in your itch Formula';

describe('tokenize', () => {
  it('matches whole words and folds plurals', () => {
    expect(tokenize('Ingredients of your Itch formulas')).toEqual(['ingredient', 'itch', 'formula']);
    expect(tokenize('Durable stitched fabric')).not.toContain('itch');
    expect(tokenize('puppies kittens ladies')).toEqual(['puppy', 'kitten', 'lady']);
  });
});

describe('detectProductIntent', () => {
  it('separates questions about a product from requests for options', () => {
    expect(detectProductIntent(INGREDIENT_Q)).toBe('info');
    expect(detectProductIntent('How do I use it?')).toBe('info');
    expect(detectProductIntent('is it safe for puppies')).toBe('info');
    expect(detectProductIntent('isme kya hai, kaise use kare')).toBe('info');
    expect(detectProductIntent('Suggest something for my dog with itchy skin')).toBe('discovery');
    expect(detectProductIntent('something for allergies')).toBe('discovery');
  });
});

describe('isSellableProduct', () => {
  it('never offers service lines, hidden, unpriced or out-of-stock items', () => {
    const sellable = CATALOG.filter(isSellableProduct).map((p) => p.id);
    expect(sellable).not.toContain('shipping');
    expect(sellable).not.toContain('refund');
    expect(sellable).not.toContain('draft_out');
    expect(sellable).toContain('itch_dog');
  });
});

describe('selectCatalogForPrompt', () => {
  it('puts the itch formulas first for the ingredients question; food and toys fall behind', () => {
    const sel = selectCatalogForPrompt(CATALOG, { message: INGREDIENT_Q });
    const top3 = sel.products.slice(0, 3).map((p) => p.id);
    expect(top3).toEqual(expect.arrayContaining(['itch_dog', 'itch_cat', 'kit_dog']));
    expect(sel.products.findIndex((p) => p.id === 'fresh_food')).toBeGreaterThan(2);
    expect(sel.products.map((p) => p.id)).not.toContain('shipping');
    expect(sel.intent).toBe('info');
    expect(sel.focus).toBeGreaterThan(0);
    expect(sel.focusTitles.join(' ')).toMatch(/Itch Relief/);
  });

  it('small catalogues go to the model whole', () => {
    const sel = selectCatalogForPrompt(CATALOG, { message: 'hello' });
    expect(sel.products).toHaveLength(CATALOG.filter(isSellableProduct).length);
    expect(sel.detailed).toBe(0);
  });

  it('drops products for the other pet once the shopper names one', () => {
    const sel = selectCatalogForPrompt(CATALOG, { message: 'itch formula for my cat' });
    const ids = sel.products.map((p) => p.id);
    expect(ids[0]).toBe('itch_cat');
    expect(ids).not.toContain('itch_dog');
    expect(ids).toContain('duck_toy'); // "Dogs & Cats" fits both
    // A follow-up keeps the pet from earlier turns
    const follow = selectCatalogForPrompt(CATALOG, { message: 'what are the ingredients?', recentUserTurns: ['my dog keeps scratching, itch relief?'] });
    expect(follow.products.map((p) => p.id)).not.toContain('itch_cat');
    expect(follow.products[0].id).toBe('itch_dog');
  });

  it('honours budget and bestseller requests', () => {
    const cheap = [...CATALOG, product('cheap_itch', 'Aniwell Itch Relief Mini', { price: 199 })];
    expect(selectCatalogForPrompt(cheap, { message: 'itch relief under 300', budgetMax: 300 }).products.map((p) => p.id)).toEqual(['cheap_itch']);
    const best = selectCatalogForPrompt(CATALOG, { message: 'best sellers', bestsellerOnly: true });
    expect(best.products.map((p) => p.id)).toEqual(['fresh_food', 'duck_toy', 'wishbone']);
  });

  it('large catalogues: relevant products first, then bestsellers, capped', () => {
    const big = [...CATALOG];
    for (let i = 0; i < FULL_CATALOG_LIMIT + 20; i++) big.push(product(`filler_${i}`, `Aniwell Bowl Model ${i}`, { sales_rank: 100 + i }));
    const sel = selectCatalogForPrompt(big, { message: INGREDIENT_Q });
    expect(sel.products).toHaveLength(LARGE_CATALOG_PROMPT_LIMIT);
    expect(sel.products[0].id).toMatch(/itch|kit/);
  });
});

describe('filterRelevantCards', () => {
  const base = { products: CATALOG, message: INGREDIENT_Q, intent: 'discovery' as const };

  it('removes fresh food and toys picked for an itch formula question', () => {
    const ids = filterRelevantCards({ ...base, productIds: ['itch_dog', 'fresh_food', 'duck_toy', 'wishbone'], reply: 'Our itch formula contains turmeric and vitamin E.' });
    expect(ids).toEqual(['itch_dog']);
  });

  it('a product question shows at most the one product asked about', () => {
    const ids = filterRelevantCards({ ...base, intent: 'info', productIds: ['kit_dog', 'itch_dog'], reply: 'The **Aniwell Itch Relief Formula** has turmeric and vitamin E.' });
    expect(ids).toEqual(['itch_dog']);
  });

  it('keeps a card the reply names even when the question used other words', () => {
    const ids = filterRelevantCards({ ...base, message: 'my dog has a tummy problem', productIds: ['gut_dog', 'wishbone'], reply: 'Try the **Aniwell Probiotic Formula** for digestion.' });
    expect(ids).toEqual(['gut_dog']);
  });

  it('trusts the model when the question matches no product words at all', () => {
    const ids = filterRelevantCards({ ...base, message: 'my pup keeps limping after walks', productIds: ['hip_joint'], reply: 'This supports mobility.' });
    expect(ids).toEqual(['hip_joint']);
  });

  it('never shows a product made for the other pet, or a service line', () => {
    const ids = filterRelevantCards({ ...base, message: 'itch relief for my cat', productIds: ['itch_dog', 'itch_cat', 'shipping'], reply: 'Here you go.' });
    expect(ids).toEqual(['itch_cat']);
  });

  it('ignores ids the model invented', () => {
    expect(filterRelevantCards({ ...base, productIds: ['nope'], reply: '' })).toEqual([]);
  });
});

describe('bold product names', () => {
  it('a brand name or a phrase shared by many titles resolves to no card', () => {
    const sellable = CATALOG.filter(isSellableProduct);
    expect(matchBoldProductMentions('All **Aniwell** products are vet approved.', sellable)).toEqual([]);
    expect(matchBoldProductMentions('The **Aniwell Wishbone** is a chew toy.', sellable)).toEqual(['wishbone']);
  });
});

describe('prompt catalogue detail tiers', () => {
  it('focus product keeps a long description, the rest a short one', () => {
    const longDesc = 'x'.repeat(2000);
    const products = [product('a', 'A', { description: longDesc }), product('b', 'B', { description: longDesc }), product('c', 'C', { description: longDesc })];
    const ctx: any = { catalogSubset: products, catalogDetail: { detailed: 2, focus: 1 }, assistantSettings: {}, storePolicies: {} };
    const summary = buildCatalogSummary(ctx);
    expect(summary.map((p) => p.description.length)).toEqual([1500, 400, 140]);
    delete ctx.catalogDetail;
    expect(buildCatalogSummary(ctx).map((p) => p.description.length)).toEqual([400, 400, 400]);
  });
});
