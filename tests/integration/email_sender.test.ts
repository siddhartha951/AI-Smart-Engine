import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { getTestEmailProvider } from '../../src/providers/email';
import { setDnsTxtResolver } from '../../src/modules/email/sender-identity';

describe('Email Automation: sending identity & custom sender domains', () => {
  let app: any;
  let db: InMemoryPostgresClient;
  let tokenA: string;
  let tokenB: string;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const asA = (req: request.Test) => req.set('Authorization', `Bearer ${tokenA}`);

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    getTestEmailProvider().sentEmails = [];
    // Migration 009 seeds verified domains for the demo stores; start each scenario from a new merchant's state
    await db.query(`DELETE FROM merchant_sender_domains WHERE store_id IN ($1, $2)`, [STORE_A_ID, STORE_B_ID]);
    // No real DNS in tests: pretend no DMARC record exists anywhere
    setDnsTxtResolver(async () => { throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' }); });

    tokenA = (await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' })).body.token;
    tokenB = (await request(app).post('/api/v1/auth/login').send({ email: 'merchantB@store.com', password: 'password123' })).body.token;
  });

  afterEach(async () => {
    setDnsTxtResolver(null);
    await db.close();
  });

  it('uses the store name on the platform default sender with Reply-To the support inbox', async () => {
    await db.query(`UPDATE assistant_settings SET support_contact = 'help@getaniwell.com' WHERE store_id = $1`, [STORE_A_ID]);

    const res = await asA(request(app).get(`/api/v1/dashboard/${STORE_A_ID}/email/sender-status`));
    expect(res.status).toBe(200);
    expect(res.body.data.identity.mode).toBe('platform_default');
    expect(res.body.data.identity.from_address).toMatch(/^London Eco Apparel </);
    expect(res.body.data.identity.reply_to).toBe('help@getaniwell.com');
    expect(res.body.data.domains).toEqual([]);
  });

  it('validates the domain and requires the sender email to be on that domain', async () => {
    const bad = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`)).send({ domain_name: 'not a domain' });
    expect(bad.status).toBe(400);

    const mismatch = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`))
      .send({ domain_name: 'getaniwell.com', sender_email: 'help@gmail.com' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toContain('getaniwell.com');

    // URLs are normalised to the bare domain
    const ok = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`))
      .send({ domain_name: 'https://www.getaniwell.com/', sender_name: 'Aniwell Support', sender_email: 'help@getaniwell.com' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.domain_name).toBe('getaniwell.com');
  });

  it('walks a merchant from pending DNS to a verified white-label sender', async () => {
    const created = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`))
      .send({ domain_name: 'getaniwell.com', sender_name: 'Aniwell Support', sender_email: 'help@getaniwell.com' });
    const domainId = created.body.data.id;

    const pending = await asA(request(app).get(`/api/v1/dashboard/${STORE_A_ID}/email/sender-status`));
    expect(pending.body.data.identity.mode).toBe('platform_default');
    const listed = pending.body.data.domains[0];
    expect(listed.status).toBe('pending');
    expect(listed.dns_records.some((r: any) => r.record === 'DKIM')).toBe(true);
    expect(listed.dns_records.some((r: any) => r.record === 'SPF')).toBe(true);
    expect(listed.dmarc).toMatchObject({ name: '_dmarc.getaniwell.com', type: 'TXT', status: 'not_found' });
    expect(listed.dmarc.value).toMatch(/^v=DMARC1; p=none/);

    const verified = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains/${domainId}/verify`));
    expect(verified.body.data.status).toBe('verified');

    const active = await asA(request(app).get(`/api/v1/dashboard/${STORE_A_ID}/email/sender-status`));
    expect(active.body.data.identity.mode).toBe('verified_domain');
    expect(active.body.data.identity.from_address).toBe('Aniwell Support <help@getaniwell.com>');
  });

  it('reports an existing DMARC record instead of asking the merchant to replace it', async () => {
    setDnsTxtResolver(async () => [['v=DMARC1; p=quarantine; rua=mailto:dmarc@getaniwell.com']]);
    await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`)).send({ domain_name: 'getaniwell.com' });

    const res = await asA(request(app).get(`/api/v1/dashboard/${STORE_A_ID}/email/sender-status`));
    expect(res.body.data.domains[0].dmarc.status).toBe('verified');
    expect(res.body.data.domains[0].dmarc.value).toBe('v=DMARC1; p=quarantine; rua=mailto:dmarc@getaniwell.com');
  });

  it('lets the merchant edit the sender name and email after adding the domain', async () => {
    const created = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`)).send({ domain_name: 'getaniwell.com' });
    const domainId = created.body.data.id;

    const wrong = await asA(request(app).put(`/api/v1/dashboard/${STORE_A_ID}/email/domains/${domainId}`))
      .send({ sender_name: 'Aniwell', sender_email: 'help@other.com' });
    expect(wrong.status).toBe(400);

    const ok = await asA(request(app).put(`/api/v1/dashboard/${STORE_A_ID}/email/domains/${domainId}`))
      .send({ sender_name: 'Aniwell Care', sender_email: 'care@getaniwell.com' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ sender_name: 'Aniwell Care', sender_email: 'care@getaniwell.com' });
  });

  it('prevents one store claiming a domain another store already connected, and isolates edits', async () => {
    const created = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`)).send({ domain_name: 'getaniwell.com' });
    const domainId = created.body.data.id;

    const claim = await request(app).post(`/api/v1/dashboard/${STORE_B_ID}/email/domains`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ domain_name: 'getaniwell.com' });
    expect(claim.status).toBe(409);

    const crossEdit = await request(app).put(`/api/v1/dashboard/${STORE_B_ID}/email/domains/${domainId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ sender_name: 'Hijack' });
    expect(crossEdit.status).toBe(404);

    const crossRead = await request(app).get(`/api/v1/dashboard/${STORE_A_ID}/email/sender-status`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossRead.status).toBe(403);
  });

  it('sends the test email through the store sending identity', async () => {
    await db.query(`UPDATE assistant_settings SET support_contact = 'help@getaniwell.com' WHERE store_id = $1`, [STORE_A_ID]);

    const res = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/test`)).send({ email: 'owner@getaniwell.com' });
    expect(res.status).toBe(200);

    const sent = getTestEmailProvider().sentEmails.find(e => e.campaignType === 'test_email');
    expect(sent?.to).toBe('owner@getaniwell.com');
    expect(sent?.from).toMatch(/^London Eco Apparel </);
    expect(sent?.replyTo).toBe('help@getaniwell.com');

    const invalid = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/test`)).send({ email: 'nope' });
    expect(invalid.status).toBe(400);
  });

  it('sends support ticket receipts from the verified domain once connected', async () => {
    const created = await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains`))
      .send({ domain_name: 'getaniwell.com', sender_name: 'Aniwell Support', sender_email: 'help@getaniwell.com' });
    await asA(request(app).post(`/api/v1/dashboard/${STORE_A_ID}/email/domains/${created.body.data.id}/verify`));

    await request(app).post('/api/v1/widget/tickets').send({
      widget_key: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      customer_email: 'rahul@gmail.com',
      subject: 'Need help',
    });

    const receipt = getTestEmailProvider().sentEmails.find(e => e.campaignType === 'ticket_confirmation_receipt');
    expect(receipt?.from).toBe('Aniwell Support <help@getaniwell.com>');
  });
});
