import { describe, it, expect } from 'vitest';
import {
  chunkText,
  selectRelevantKnowledge,
  formatKnowledge,
  tokenize,
} from '../../src/modules/knowledge/knowledge-retrieval';
import { matchBoldProductMentions } from '../../src/providers/ai/ai.utils';
import { buildShopperSystemPrompt } from '../../src/providers/ai/shopper-prompt';

const filler = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${topic} paragraph ${i}: general brand story text about our company values and mission.`).join('\n\n');

describe('knowledge retrieval', () => {
  it('tokenize drops stop words and folds simple plurals', () => {
    expect(tokenize('What are the shipping charges for dogs? less')).toEqual(['shipping', 'charge', 'dog', 'less']);
  });

  it('returns everything when the knowledge fits the budget', () => {
    const chunks = chunkText('Short FAQ.\n\nWe ship in 3 days.', 'KB', 1);
    expect(selectRelevantKnowledge(chunks, 'anything', 5000)).toHaveLength(chunks.length);
  });

  it('picks the passage that answers the question when knowledge is large', () => {
    const kb = `${filler('About us', 40)}\n\nShipping Policy: Orders ship within 48 hours. Free shipping above Rs 999.\n\n${filler('Careers', 40)}`;
    const chunks = chunkText(kb, 'Store knowledge base', 1);
    const picked = selectRelevantKnowledge(chunks, 'how much is shipping?', 1500);
    const text = formatKnowledge(picked);
    expect(text).toContain('Free shipping above Rs 999');
    expect(text.length).toBeLessThan(2200);
  });

  it('ranks merchant documents above scraped knowledge for the same topic', () => {
    const chunks = [
      ...chunkText('Allergy supplement dosage: consult the label.', 'Merchant document: guide.pdf', 2),
      ...chunkText(`${filler('Intro', 30)}\n\nAllergy supplement is popular.`, 'Store knowledge base', 1, 10),
    ];
    const picked = selectRelevantKnowledge(chunks, 'allergy supplement dosage', 400);
    expect(picked[0].source).toBe('Merchant document: guide.pdf');
  });
});

describe('matchBoldProductMentions', () => {
  const products = [
    { id: 'p1', title: 'Aniwell Itch Relief Formula - 60 Chews' },
    { id: 'p2', title: 'Aniwell Joint Care Chews' },
    { id: 'p3', title: 'Rope Chew Toy' },
  ];

  it('maps bold names to products in mention order', () => {
    const ids = matchBoldProductMentions('Try **Joint Care Chews** or **Aniwell Itch Relief Formula**.', products);
    expect(ids).toEqual(['p2', 'p1']);
  });

  it('ignores unbolded mentions and loose single-word overlaps', () => {
    expect(matchBoldProductMentions('Our chews are great, like the rope toy.', products)).toEqual([]);
    expect(matchBoldProductMentions('**Great chews**', products)).toEqual([]);
  });
});

describe('shopper system prompt', () => {
  it('caps recommendations, handles follow-ups and puts merchant knowledge first', () => {
    const prompt = buildShopperSystemPrompt({
      storeId: 's',
      sessionId: 'x',
      catalogSubset: [{ id: 'p1', variant_id: '', title: 'Itch Relief', price: 499, currency: 'INR', in_stock: true, category: 'health', image_url: '', product_url: '', description: '<p>Soothes <b>skin</b></p>' }],
      storePolicies: { delivery_policy: 'Ships in 2 days', returns_policy: '', faq_content: '' },
      assistantSettings: { assistant_name: 'Ani', allowed_topics: ['products'], knowledge_base: '[Merchant document: faq.pdf]\nDosage: 1 chew daily' },
    }, 'json');
    expect(prompt).toContain('Dosage: 1 chew daily');
    expect(prompt).toContain('ONE best match');
    expect(prompt).toContain('"it/this/that" refers to the product discussed before');
    expect(prompt).toContain('Soothes skin');
    expect(prompt).not.toContain('<p>');
    expect(prompt).not.toContain('Returns:');
  });
});
