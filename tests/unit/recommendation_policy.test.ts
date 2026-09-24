import { describe, it, expect } from 'vitest';
import {
  applyRecommendationPolicy,
  normalizeRecommendationSettings,
  recommendationExtras,
  shopperWantsProducts,
} from '../../src/modules/chat/recommendation-policy';
import { variantsFromAdminGraphql, variantsFromAdminRest, defaultVariant, describeVariantsForAi } from '../../src/providers/shopify/variants';

const askFirst = normalizeRecommendationSettings({});
const direct = normalizeRecommendationSettings({ product_suggestion_mode: 'direct', max_recommendations: 2 });

describe('recommendation settings', () => {
  it('defaults to ask first, cards, 3 per reply, variants and reasons on', () => {
    expect(askFirst).toEqual({ suggestionMode: 'ask_first', displayStyle: 'cards', maxRecommendations: 3, showVariants: true, showReason: true });
  });

  it('falls back safely on bad values', () => {
    const s = normalizeRecommendationSettings({ product_suggestion_mode: 'x', product_display_style: 'carousel', max_recommendations: 9, show_product_variants: 'false' });
    expect(s).toMatchObject({ suggestionMode: 'ask_first', displayStyle: 'cards', maxRecommendations: 3, showVariants: false });
  });
});

describe('ask first policy', () => {
  it('holds products back when the shopper only described a need, and offers instead', () => {
    const r = applyRecommendationPolicy({ settings: askFirst, latestUserMessage: 'My dog keeps scratching', productIds: ['p1'], aiText: 'Try **Dermaprex**.' });
    expect(r).toEqual({ productIds: [], productOffer: true, heldBack: true });
  });

  it('shows products once the shopper says yes to the offer', () => {
    expect(shopperWantsProducts('yes please', 'Would you like me to show a few options that fit?')).toBe(true);
    expect(shopperWantsProducts('haan', 'Would you like me to show a few options that fit?')).toBe(true);
    const r = applyRecommendationPolicy({ settings: askFirst, latestUserMessage: 'Yes', previousAssistantMessage: 'Would you like me to show a few options that fit?', productIds: ['p1', 'p2'], aiText: '' });
    expect(r.productIds).toEqual(['p1', 'p2']);
  });

  it('a plain "yes" without an offer is not consent; "no thanks" never is', () => {
    expect(shopperWantsProducts('yes', 'Our delivery takes 3 days.')).toBe(false);
    expect(shopperWantsProducts('no thanks, show later', 'Would you like me to show a few options?')).toBe(false);
  });

  it('explicit requests show products straight away', () => {
    for (const msg of ['show me something for itchy skin', 'which one should I buy?', 'recommend a joint supplement', 'best sellers?', 'kuch dikhao']) {
      expect(shopperWantsProducts(msg)).toBe(true);
    }
  });

  it('direct mode shows products and respects the per-reply limit', () => {
    const r = applyRecommendationPolicy({ settings: direct, latestUserMessage: 'my dog is itchy', productIds: ['a', 'b', 'c'], aiText: '' });
    expect(r).toEqual({ productIds: ['a', 'b'], productOffer: false, heldBack: false });
  });

  it('flags an offer when the model asked on its own', () => {
    const r = applyRecommendationPolicy({ settings: askFirst, latestUserMessage: 'my dog is itchy', productIds: [], aiText: 'That sounds uncomfortable. Would you like me to show a few options that fit?' });
    expect(r.productOffer).toBe(true);
    expect(r.heldBack).toBe(false);
  });
});

describe('recommendation extras', () => {
  const product = { variants: [{ id: '1' }, { id: '2' }], options: [{ name: 'Pack', values: ['1', '2'] }] };
  it('adds why + variants when enabled', () => {
    expect(recommendationExtras(product, askFirst, ' For itchy   skin ')).toEqual({ why: 'For itchy skin', variants: product.variants, options: product.options });
  });
  it('omits them when the merchant switched them off', () => {
    const off = normalizeRecommendationSettings({ show_product_variants: false, show_product_reason: false });
    expect(recommendationExtras(product, off, 'x')).toEqual({});
  });
});

describe('Shopify variant normalisation', () => {
  it('reads Admin GraphQL variants with options and images', () => {
    const { variants, options } = variantsFromAdminGraphql({
      options: [{ name: 'Pack', values: ['Pack of 1', 'Pack of 3'] }],
      variants: { edges: [
        { node: { id: 'gid://shopify/ProductVariant/11', title: 'Pack of 1', price: '499.00', compareAtPrice: '599.00', availableForSale: false, selectedOptions: [{ name: 'Pack', value: 'Pack of 1' }] } },
        { node: { id: 'gid://shopify/ProductVariant/13', title: 'Pack of 3', price: '1249.00', compareAtPrice: null, availableForSale: true, selectedOptions: [{ name: 'Pack', value: 'Pack of 3' }], image: { url: 'https://cdn/x.jpg' } } },
      ] },
    });
    expect(options).toEqual([{ name: 'Pack', values: ['Pack of 1', 'Pack of 3'] }]);
    expect(variants[1]).toEqual({ id: '13', title: 'Pack of 3', price: 1249, compare_at_price: 0, available: true, options: { Pack: 'Pack of 3' }, image_url: 'https://cdn/x.jpg' });
    expect(defaultVariant(variants)?.id).toBe('13');
    expect(describeVariantsForAi(variants, 'INR')).toBe('Pack of 1 (sold out) | Pack of 3 INR 1249');
  });

  it('drops Shopify\'s "Default Title" placeholder option', () => {
    const { variants, options } = variantsFromAdminRest({
      options: [{ name: 'Title', values: ['Default Title'] }],
      variants: [{ id: 5, title: 'Default Title', price: '99.00', option1: 'Default Title' }],
    });
    expect(options).toEqual([]);
    expect(variants).toHaveLength(1);
  });

  it('reads Admin REST option1..3 and inventory', () => {
    const { variants } = variantsFromAdminRest({
      options: [{ name: 'Color', values: ['Navy'] }, { name: 'Size', values: ['M', 'XL'] }],
      variants: [
        { id: 1, title: 'Navy / M', price: '1299', option1: 'Navy', option2: 'M', inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 4 },
        { id: 2, title: 'Navy / XL', price: '1299', option1: 'Navy', option2: 'XL', inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 0 },
      ],
    });
    expect(variants.map(v => [v.options, v.available])).toEqual([[{ Color: 'Navy', Size: 'M' }, true], [{ Color: 'Navy', Size: 'XL' }, false]]);
  });
});
