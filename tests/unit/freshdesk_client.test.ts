import { describe, it, expect } from 'vitest';
import {
  FreshdeskError,
  buildTicketDescription,
  createFreshdeskTicket,
  freshdeskPriority,
  normalizeFreshdeskDomain,
  testFreshdeskConnection,
} from '../../src/providers/helpdesk/freshdesk.client';

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { fn, calls };
}

const CREDS = { domain: 'acme.freshdesk.com', apiKey: 'abcdEFGHijkl1234' };

describe('normalizeFreshdeskDomain', () => {
  it('accepts the forms merchants paste', () => {
    expect(normalizeFreshdeskDomain('acme')).toBe('acme.freshdesk.com');
    expect(normalizeFreshdeskDomain(' ACME.freshdesk.com ')).toBe('acme.freshdesk.com');
    expect(normalizeFreshdeskDomain('https://acme-pets.freshdesk.com/a/tickets/12')).toBe('acme-pets.freshdesk.com');
  });

  it('refuses anything that is not a freshdesk.com subdomain (no requests to other hosts)', () => {
    for (const bad of ['evil.com', 'acme.freshdesk.com.evil.com', 'https://evil.com/acme.freshdesk.com', '127.0.0.1', 'a b.freshdesk.com', '-x.freshdesk.com', '', 42]) {
      expect(normalizeFreshdeskDomain(bad as any)).toBeNull();
    }
  });
});

describe('ticket payload', () => {
  it('maps priority and escapes the transcript', () => {
    expect([freshdeskPriority('low'), freshdeskPriority('medium'), freshdeskPriority('high'), freshdeskPriority('urgent'), freshdeskPriority(undefined)]).toEqual([1, 2, 3, 4, 2]);
    const html = buildTicketDescription({
      subject: 'Order <b>late</b>',
      category: 'order_tracking',
      priority: 'high',
      storeName: 'Acme',
      transcript: [
        { role: 'user', content: 'Where is my order? <script>alert(1)</script>' },
        { role: 'assistant', content: 'Let me check.\nOne moment.' },
      ],
    });
    expect(html).toContain('Order &lt;b&gt;late&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>Customer:</strong>');
    expect(html).toContain('<strong>AI assistant:</strong> Let me check.<br>One moment.');
    expect(html).toContain('order tracking');
  });

  it('keeps the newest messages when the history is very long', () => {
    const transcript = Array.from({ length: 400 }, (_, i) => ({ role: 'user', content: `message ${i} ${'x'.repeat(300)}` }));
    const html = buildTicketDescription({ subject: 's', transcript });
    expect(html.length).toBeLessThanOrEqual(60000);
    expect(html).toContain('message 399');
    expect(html).not.toContain('message 0 ');
    expect(html).toContain('Earlier messages omitted');
  });
});

describe('Freshdesk API calls', () => {
  it('creates an open chat ticket with basic auth', async () => {
    const { fn, calls } = fakeFetch(201, { id: 1234 });
    const res = await createFreshdeskTicket(CREDS, {
      email: 'shopper@example.com', name: 'Riya', subject: 'Help', descriptionHtml: '<p>x</p>', priority: 3, tags: ['ai-smart-engine', 'general'],
    }, fn);
    expect(res).toEqual({ id: '1234' });
    expect(calls[0].url).toBe('https://acme.freshdesk.com/api/v2/tickets');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('abcdEFGHijkl1234:X').toString('base64')}`);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      email: 'shopper@example.com', name: 'Riya', subject: 'Help', description: '<p>x</p>', priority: 3, status: 2, source: 7, tags: ['ai-smart-engine', 'general'],
    });
  });

  it('turns HTTP failures into clear, safe errors', async () => {
    const cases: Array<[number, any, Record<string, string>, string]> = [
      [401, { code: 'invalid_credentials' }, {}, 'auth'],
      [404, {}, {}, 'not_found'],
      [429, {}, { 'retry-after': '30' }, 'rate_limited'],
      [400, { errors: [{ field: 'email', message: 'invalid' }] }, {}, 'validation'],
      [503, 'down', {}, 'server'],
    ];
    for (const [status, body, headers, code] of cases) {
      const { fn } = fakeFetch(status, body, headers);
      const err = await createFreshdeskTicket(CREDS, { email: 'a@b.co', subject: 's', descriptionHtml: 'd', priority: 2 }, fn).catch((e) => e);
      expect(err).toBeInstanceOf(FreshdeskError);
      expect(err.code).toBe(code);
      expect(err.message).not.toContain(CREDS.apiKey);
    }
    const rate = await createFreshdeskTicket(CREDS, { email: 'a@b.co', subject: 's', descriptionHtml: 'd', priority: 2 }, fakeFetch(429, {}, { 'retry-after': '30' }).fn).catch((e) => e);
    expect(rate.retryAfterSeconds).toBe(30);
    const invalid = await createFreshdeskTicket(CREDS, { email: 'a@b.co', subject: 's', descriptionHtml: 'd', priority: 2 }, fakeFetch(400, { errors: [{ field: 'email', message: 'invalid' }] }).fn).catch((e) => e);
    expect(invalid.message).toContain('email: invalid');
  });

  it('network failures and bad domains never call other hosts', async () => {
    const failing = async () => { throw new Error('socket hang up'); };
    const err = await testFreshdeskConnection(CREDS, failing as any).catch((e) => e);
    expect(err.code).toBe('network');
    const { fn, calls } = fakeFetch(200, {});
    const bad = await testFreshdeskConnection({ domain: 'evil.com', apiKey: 'k'.repeat(12) }, fn).catch((e) => e);
    expect(bad.code).toBe('validation');
    expect(calls).toHaveLength(0);
  });

  it('connection test returns the agent behind the key', async () => {
    const { fn, calls } = fakeFetch(200, { contact: { name: 'Asha', email: 'asha@acme.com' } });
    expect(await testFreshdeskConnection(CREDS, fn)).toEqual({ agentName: 'Asha', agentEmail: 'asha@acme.com' });
    expect(calls[0].url).toBe('https://acme.freshdesk.com/api/v2/agents/me');
  });
});
