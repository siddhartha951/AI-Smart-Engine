import { describe, it, expect } from 'vitest';
import { decideEscalation } from '../../src/modules/support_tickets/escalation';

const base = { ticketsEnabled: true, mode: 'smart', sensitivity: 'balanced' };

describe('smart escalation', () => {
  it('keeps chatting for a normal product question', () => {
    const d = decideEscalation({ ...base, userMessages: ['Which chew is best for itchy skin?'], aiReply: 'Try our Itch Relief chews.' });
    expect(d.level).toBe('none');
  });

  it('offers a ticket immediately when the shopper asks for a person', () => {
    const d = decideEscalation({ ...base, userMessages: ['I want to talk to a human'] });
    expect(d.level).toBe('offer');
    expect(d.reasons).toContain('asked_for_human');
  });

  it('understands Hinglish human requests', () => {
    expect(decideEscalation({ ...base, userMessages: ['kisi insaan se baat karao please'] }).level).toBe('offer');
  });

  it('does not offer a ticket on the first mild complaint, but does once the shopper is angry about damage', () => {
    expect(decideEscalation({ ...base, userMessages: ['my order is late'] }).level).toBe('none');
    const angry = decideEscalation({ ...base, userMessages: ['My order arrived DAMAGED and broken!!! This is the worst service'] });
    expect(angry.level).toBe('offer');
    expect(angry.reasons).toEqual(expect.arrayContaining(['angry', 'high_risk_issue']));
  });

  it('builds up: repeated question plus an unsure AI shows the soft chip, then an offer', () => {
    const soft = decideEscalation({
      ...base,
      userMessages: ['when will my order 1234 be delivered', 'when will my order 1234 get delivered'],
      aiReply: 'You can track it on our tracking page.',
    });
    expect(soft.level).toBe('soft');

    const offer = decideEscalation({
      ...base,
      userMessages: ['when will my order 1234 be delivered', 'when will my order 1234 get delivered', 'when will my order 1234 be delivered??'],
      previousAssistantMessages: ["I'm not sure about that order."],
      aiReply: "I'm not sure, please contact our support team.",
    });
    expect(offer.level).toBe('offer');
  });

  it('sensitivity changes how early the offer comes', () => {
    const input = { ticketsEnabled: true, mode: 'smart', userMessages: ['I want a refund for my order', 'I want refund for my order please', 'still waiting for my refund on the order'] };
    expect(decideEscalation({ ...input, sensitivity: 'early' }).level).toBe('offer');
    expect(decideEscalation({ ...input, sensitivity: 'late' }).level).not.toBe('offer');
  });
});

describe('other modes', () => {
  it('contact_only never offers a ticket, it shows contact details instead', () => {
    const d = decideEscalation({ ...base, mode: 'contact_only', userMessages: ['talk to a human now'] });
    expect(d.level).toBe('contact');
    expect(d.mode).toBe('contact_only');
  });

  it('admin-disabled tickets force contact_only whatever the merchant chose', () => {
    const d = decideEscalation({ ...base, mode: 'instant', ticketsEnabled: false, userMessages: ['create a ticket'] });
    expect(d.mode).toBe('contact_only');
    expect(d.level).toBe('contact');
  });

  it('instant offers as soon as the AI suggests the team', () => {
    const d = decideEscalation({ ...base, mode: 'instant', userMessages: ['my coupon does not work'], aiRequestedTicket: true });
    expect(d.level).toBe('offer');
  });

  it('unknown values fall back to smart + balanced', () => {
    const d = decideEscalation({ ticketsEnabled: true, mode: 'weird', sensitivity: 'x', userMessages: ['hello'] });
    expect(d.mode).toBe('smart');
    expect(d.level).toBe('none');
  });
});
