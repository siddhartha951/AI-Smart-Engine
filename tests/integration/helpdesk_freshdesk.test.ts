import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { getTestEmailProvider } from '../../src/providers/email';

const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
const API_KEY = 'fdKey_abcdefghij9876';

type Reply = { status: number; body: unknown };

/** Stands in for Freshdesk: records every request and answers from the queue (or 200). */
function stubFreshdesk(replies: Record<string, Reply[]> = {}) {
  const calls: Array<{ url: string; method: string; headers: any; body: any }> = [];
  const fetchStub = vi.fn(async (url: string, init: any = {}) => {
    const path = new URL(url).pathname;
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const queue = replies[path];
    const reply = queue && queue.length > 0 ? queue.shift()! : path.endsWith('/agents/me')
      ? { status: 200, body: { contact: { name: 'Asha', email: 'asha@acme.com' } } }
      : { status: 201, body: { id: 555 } };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchStub);
  return { calls };
}

describe('Freshdesk helpdesk integration', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  let merchantToken: string;
  let adminToken: string;

  const login = async (email: string) =>
    (await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' })).body.token;
  const helpdesk = (method: 'get' | 'put' | 'post' | 'delete', suffix = '', storeId = STORE_A_ID) =>
    (request(app) as any)[method](`/api/v1/dashboard/${storeId}/helpdesk${suffix}`).set('Authorization', `Bearer ${merchantToken}`);
  const setFeature = (key: string, enabled: boolean) =>
    request(app).put(`/api/v1/admin/stores/${STORE_A_ID}/features/${key}`).set('Authorization', `Bearer ${adminToken}`).send({ enabled });
  const createTicket = (extra: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/widget/tickets').send({
      widget_key: STORE_A_WIDGET_KEY,
      customer_email: 'Shopper@Example.com',
      customer_name: 'Riya',
      subject: 'My order has not arrived',
      chat_transcript: [
        { role: 'user', content: 'Where is my order? <script>alert(1)</script>' },
        { role: 'assistant', content: 'Let me connect you with the team.' },
      ],
      ...extra,
    });
  const ticketRow = async (id: string) => (await db.query('SELECT * FROM support_tickets WHERE id = $1', [id])).rows[0];
  const emailsOf = (type: string) => getTestEmailProvider().sentEmails.filter((e: any) => e.campaignType === type);

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    merchantToken = await login('merchantA@store.com');
    adminToken = await login('admin@platform.com');
    getTestEmailProvider().sentEmails = [];
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.close();
  });

  async function connect() {
    await setFeature('freshdesk', true);
    stubFreshdesk();
    const res = await helpdesk('put').send({ provider: 'freshdesk', domain: 'https://acme.freshdesk.com/a/', api_key: API_KEY });
    expect(res.status).toBe(200);
    return res;
  }

  it('is off until the admin enables it for the store', async () => {
    const res = await helpdesk('get');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    await setFeature('freshdesk', true);
    const on = await helpdesk('get');
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ provider: 'built_in', active: false, has_api_key: false, tickets_enabled: true });
  });

  it('only a working key connects Freshdesk, and the key is never returned', async () => {
    await setFeature('freshdesk', true);
    expect((await helpdesk('put').send({ provider: 'freshdesk', domain: 'evil.com', api_key: API_KEY })).status).toBe(400);
    expect((await helpdesk('put').send({ provider: 'freshdesk', domain: 'acme' })).status).toBe(400); // no key yet
    expect((await helpdesk('put').send({ provider: 'freshdesk', domain: 'acme', api_key: API_KEY, extra: 1 })).status).toBe(400);

    stubFreshdesk({ '/api/v2/agents/me': [{ status: 401, body: { code: 'invalid_credentials' } }] });
    const bad = await helpdesk('put').send({ provider: 'freshdesk', domain: 'acme', api_key: API_KEY });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/API key/);
    expect((await helpdesk('get')).body.data.provider).toBe('built_in');

    const { calls } = stubFreshdesk();
    const ok = await helpdesk('put').send({ provider: 'freshdesk', domain: 'https://acme.freshdesk.com/a/', api_key: API_KEY });
    expect(ok.status).toBe(200);
    expect(calls[0].url).toBe('https://acme.freshdesk.com/api/v2/agents/me');
    expect(ok.body.data).toMatchObject({ provider: 'freshdesk', freshdesk_domain: 'acme.freshdesk.com', has_api_key: true, api_key_last4: '9876', status: 'connected', active: true });
    expect(JSON.stringify(ok.body)).not.toContain(API_KEY);
    const stored = (await db.query('SELECT encrypted_api_key FROM store_helpdesk_settings WHERE store_id = $1', [STORE_A_ID])).rows[0];
    expect(stored.encrypted_api_key).not.toContain(API_KEY);

    const features = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/features`).set('Authorization', `Bearer ${merchantToken}`);
    expect(features.body.data.helpdesk).toEqual({ provider: 'freshdesk' });
  });

  it('a new ticket goes to Freshdesk with the chat history; our emails are skipped', async () => {
    await connect();
    const { calls } = stubFreshdesk({ '/api/v2/tickets': [{ status: 201, body: { id: 9001 } }] });
    const res = await createTicket();
    expect(res.status).toBe(201);

    const post = calls.find((c) => c.url.endsWith('/api/v2/tickets'))!;
    expect(post.method).toBe('POST');
    expect(post.headers.Authorization).toBe(`Basic ${Buffer.from(`${API_KEY}:X`).toString('base64')}`);
    expect(post.body).toMatchObject({ email: 'shopper@example.com', name: 'Riya', subject: 'My order has not arrived', status: 2, source: 7 });
    expect(post.body.tags).toContain('ai-smart-engine');
    expect([1, 2, 3, 4]).toContain(post.body.priority);
    expect(post.body.description).toContain('&lt;script&gt;');
    expect(post.body.description).toContain('Let me connect you with the team.');

    const row = await ticketRow(res.body.data.ticket_id);
    expect(row).toMatchObject({ external_provider: 'freshdesk', external_sync_status: 'synced', external_ticket_id: '9001', external_url: 'https://acme.freshdesk.com/a/tickets/9001' });
    expect(emailsOf('ticket_confirmation_receipt')).toHaveLength(0);
    expect(emailsOf('ticket_merchant_alert')).toHaveLength(0);
  });

  it('if Freshdesk fails the ticket is kept, the shopper still gets our email, and a retry sends it', async () => {
    await connect();
    stubFreshdesk({ '/api/v2/tickets': [{ status: 503, body: {} }] });
    const res = await createTicket();
    expect(res.status).toBe(201);
    const row = await ticketRow(res.body.data.ticket_id);
    expect(row.external_sync_status).toBe('failed');
    expect(row.external_sync_error).toMatch(/Freshdesk error \(503\)/);
    expect(emailsOf('ticket_confirmation_receipt')).toHaveLength(1);

    const status = await helpdesk('get');
    expect(status.body.data.sync).toEqual({ synced: 0, failed: 1, pending: 0 });

    stubFreshdesk({ '/api/v2/tickets': [{ status: 201, body: { id: 42 } }] });
    const retry = await helpdesk('post', '/retry');
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ attempted: 1, synced: 1, failed: 0 });
    expect((await ticketRow(res.body.data.ticket_id)).external_ticket_id).toBe('42');
  });

  it('a revoked key marks the connection as needing attention', async () => {
    await connect();
    stubFreshdesk({ '/api/v2/tickets': [{ status: 401, body: {} }] });
    await createTicket();
    const status = await helpdesk('get');
    expect(status.body.data.status).toBe('error');
    expect(status.body.data.last_error).toMatch(/API key/);
  });

  it('built-in mode, disconnect and admin switch-off all route tickets back to the inbox', async () => {
    await connect();
    const builtIn = await helpdesk('put').send({ provider: 'built_in' });
    expect(builtIn.body.data).toMatchObject({ provider: 'built_in', active: false, has_api_key: true });
    const { calls } = stubFreshdesk();
    await createTicket();
    expect(calls.filter((c) => c.url.endsWith('/tickets'))).toHaveLength(0);
    expect(emailsOf('ticket_confirmation_receipt')).toHaveLength(1);

    await connect();
    await setFeature('freshdesk', false);
    const features = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/features`).set('Authorization', `Bearer ${merchantToken}`);
    expect(features.body.data.helpdesk).toEqual({ provider: 'built_in' });
    const again = stubFreshdesk();
    await createTicket();
    expect(again.calls.filter((c) => c.url.endsWith('/tickets'))).toHaveLength(0);

    await setFeature('freshdesk', true);
    const off = await helpdesk('delete');
    expect(off.body.data).toMatchObject({ provider: 'built_in', has_api_key: false, status: 'not_connected' });
  });

  it('merchants cannot reach another store\'s helpdesk settings', async () => {
    await setFeature('freshdesk', true);
    expect((await helpdesk('get', '', STORE_B_ID)).status).toBe(403);
  });

  it('every plan includes Freshdesk; assigning a plan switches it on', async () => {
    const plans = await request(app).get('/api/v1/admin/plans').set('Authorization', `Bearer ${adminToken}`);
    expect(plans.body.data.always_included).toEqual(['freshdesk']);
    for (const p of plans.body.data.plans) expect(p.features).toContain('freshdesk');

    const starter = plans.body.data.plans.find((p: any) => p.id === 'starter');
    const edited = await request(app).put('/api/v1/admin/plans/starter').set('Authorization', `Bearer ${adminToken}`)
      .send({ features: starter.features.filter((f: string) => f !== 'freshdesk') });
    expect(edited.body.data.features).toContain('freshdesk');

    await request(app).put(`/api/v1/admin/stores/${STORE_A_ID}/plan`).set('Authorization', `Bearer ${adminToken}`).send({ plan_id: 'starter' });
    expect((await helpdesk('get')).status).toBe(200);
  });
});
