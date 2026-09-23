import { describe, it, expect } from 'vitest';
import { triageByRules, triageTicket, parseSlaMinutes, computeSlaDueAt } from '../../src/modules/support_tickets/ticket-triage';

describe('Support ticket triage rules', () => {
  it('marks an angry Hinglish refund demand about a missing order as urgent', () => {
    const t = triageByRules('Customer requested human support via header button', [
      { role: 'user', content: 'Mera order abhi tak nahi aaya, refund karo. Bakwas service!' },
    ]);
    expect(t.category).toBe('return_refund');
    expect(t.sentiment).toBe('angry');
    expect(t.priority).toBe('urgent');
  });

  it('treats shouting as angry', () => {
    const t = triageByRules('Help', [{ role: 'user', content: 'WHERE IS MY ORDER I PAID TEN DAYS AGO' }]);
    expect(t.sentiment).toBe('angry');
    expect(t.category).toBe('order_tracking');
    expect(t.priority).toBe('urgent');
  });

  it('classifies each category from customer messages only', () => {
    const cases: Array<[string, string]> = [
      ['The bottle arrived broken and leaking', 'damaged_missing'],
      ['I want to return this and get my money back', 'return_refund'],
      ['Where is my order? Please share tracking', 'order_tracking'],
      ['My coupon code is not working at checkout', 'discount_coupon'],
      ['Which product do you recommend for itchy skin?', 'product_inquiry'],
      ['Do you have a physical store in London?', 'general'],
    ];
    for (const [text, category] of cases) {
      expect(triageByRules('Support', [{ role: 'user', content: text }]).category, text).toBe(category);
    }

    // The assistant's own words must not drive classification
    const t = triageByRules('Support', [
      { role: 'assistant', content: 'You can request a refund or track your order anytime.' },
      { role: 'user', content: 'Do you have a physical store?' },
    ]);
    expect(t.category).toBe('general');
  });

  it('keeps calm product questions at medium or low priority', () => {
    expect(triageByRules('Question', [{ role: 'user', content: 'Which size is best for a small dog?' }]).priority).toBe('medium');
    expect(triageByRules('Question', [{ role: 'user', content: 'Thanks! Which product do you recommend?' }]).priority).toBe('low');
  });

  it('raises damaged items and upset order problems to high', () => {
    expect(triageByRules('Help', [{ role: 'user', content: 'Item was damaged in the box' }]).priority).toBe('high');
    expect(triageByRules('Help', [{ role: 'user', content: 'Still waiting, my order is delayed' }]).priority).toBe('high');
  });
});

describe('AI-assisted triage', () => {
  const fakeOrchestrator = (result: any) => ({ generateStructuredJson: async () => result }) as any;

  it('uses the AI classification but never lowers the rule-based priority', async () => {
    const t = await triageTicket('store-1', 'Help', [{ role: 'user', content: 'Mera order abhi tak nahi aaya, bakwas!' }], {
      orchestrator: fakeOrchestrator({ category: 'order_tracking', sentiment: 'negative', priority: 'low' }),
    });
    expect(t.source).toBe('ai');
    expect(t.category).toBe('order_tracking');
    expect(t.priority).toBe('urgent');
  });

  it('keeps the keyword category when the AI falls back to general', async () => {
    const t = await triageTicket('store-1', 'Help', [{ role: 'user', content: 'My coupon code is not working' }], {
      orchestrator: fakeOrchestrator({ category: 'general', sentiment: 'neutral', priority: 'medium' }),
    });
    expect(t.category).toBe('discount_coupon');
  });

  it('falls back to rules when the AI fails', async () => {
    const t = await triageTicket('store-1', 'Help', [{ role: 'user', content: 'Item arrived broken' }], {
      orchestrator: { generateStructuredJson: async () => { throw new Error('budget exceeded'); } } as any,
    });
    expect(t.source).toBe('rules');
    expect(t.category).toBe('damaged_missing');
  });
});

describe('SLA duration parsing', () => {
  it('parses the dashboard SLA options', () => {
    expect(parseSlaMinutes('within 2 hours')).toBe(120);
    expect(parseSlaMinutes('within 4 hours')).toBe(240);
    expect(parseSlaMinutes('within 12 hours')).toBe(720);
    expect(parseSlaMinutes('within 24 hours')).toBe(1440);
    expect(parseSlaMinutes('within 1-2 business days')).toBe(2880);
    expect(parseSlaMinutes('within 30 minutes')).toBe(30);
  });

  it('falls back to 24 hours for unknown wording', () => {
    expect(parseSlaMinutes(undefined)).toBe(1440);
    expect(parseSlaMinutes('as soon as possible')).toBe(1440);
  });

  it('computes the due time from creation', () => {
    const created = new Date('2026-09-24T10:00:00Z');
    expect(computeSlaDueAt(created, 'within 4 hours').toISOString()).toBe('2026-09-24T14:00:00.000Z');
  });
});
