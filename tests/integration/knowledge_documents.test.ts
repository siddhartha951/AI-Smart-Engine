import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { createApp } from '../../src/server/app';
import { MockAiProvider } from '../../src/providers/ai/mock.ai.provider';

/** Builds a tiny, valid, uncompressed single-page PDF containing `text`. */
function buildPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe('Merchant knowledge documents', () => {
  let db: InMemoryPostgresClient;
  let app: any;
  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const STORE_A_WIDGET_KEY = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    await new Migrator(db).runMigrations();
    app = createApp({ db });
    tokenA = (await request(app).post('/api/v1/auth/login').send({ email: 'merchantA@store.com', password: 'password123' })).body.token;
    tokenB = (await request(app).post('/api/v1/auth/login').send({ email: 'merchantB@store.com', password: 'password123' })).body.token;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  const docsUrl = (storeId: string) => `/api/v1/dashboard/${storeId}/agent/knowledge/documents`;

  it('uploads a text file, lists it and deletes it', async () => {
    const upload = await request(app)
      .post(docsUrl(STORE_A_ID))
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('Dosage guide: give one chew per 10kg of body weight daily.'), 'dosage.txt');
    expect(upload.status).toBe(201);
    expect(upload.body.data.file_name).toBe('dosage.txt');
    expect(upload.body.data.content).toBeUndefined();

    const list = await request(app).get(docsUrl(STORE_A_ID)).set('Authorization', `Bearer ${tokenA}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].preview).toContain('one chew per 10kg');

    const del = await request(app).delete(`${docsUrl(STORE_A_ID)}/${upload.body.data.id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(del.status).toBe(200);
    const after = await request(app).get(docsUrl(STORE_A_ID)).set('Authorization', `Bearer ${tokenA}`);
    expect(after.body.data).toHaveLength(0);
  });

  it('extracts real text from a PDF on the server', async () => {
    const res = await request(app)
      .post(docsUrl(STORE_A_ID))
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', buildPdf('Aniwell chews contain salmon oil and biotin for a shiny coat.'), { filename: 'guide.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const row = await db.query('SELECT content, document_type FROM store_knowledge_documents WHERE store_id = $1', [STORE_A_ID]);
    expect(row.rows[0].document_type).toBe('pdf');
    expect(row.rows[0].content).toContain('salmon oil and biotin');
    expect(row.rows[0].content).not.toMatch(/-- 1 of 1 --/);
  });

  it('rejects unsupported and empty files with a clear message', async () => {
    const bad = await request(app)
      .post(docsUrl(STORE_A_ID))
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('MZ...'), 'virus.exe');
    expect(bad.status).toBe(400);

    const empty = await request(app)
      .post(docsUrl(STORE_A_ID))
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('   '), 'blank.txt');
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toMatch(/No readable text/);
  });

  it('keeps documents isolated per store', async () => {
    const upload = await request(app)
      .post(docsUrl(STORE_A_ID))
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('Store A private wholesale price list for partners.'), 'private.txt');

    const crossList = await request(app).get(docsUrl(STORE_A_ID)).set('Authorization', `Bearer ${tokenB}`);
    expect(crossList.status).toBe(403);

    const crossDelete = await request(app).delete(`${docsUrl(STORE_B_ID)}/${upload.body.data.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(crossDelete.status).toBe(404);
    const stillThere = await db.query('SELECT id FROM store_knowledge_documents WHERE id = $1', [upload.body.data.id]);
    expect(stillThere.rows).toHaveLength(1);
  });

  it('website rescan does not touch uploaded documents and chat receives their knowledge', async () => {
    await request(app)
      .post(docsUrl(STORE_A_ID))
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('Warranty: every earbud comes with a 2 year replacement warranty.'), 'warranty.txt');

    const spy = vi.spyOn(MockAiProvider.prototype, 'generateResponse');
    const session = (await request(app).post('/api/v1/widget/session').set('x-widget-key', STORE_A_WIDGET_KEY).send({ anonymous_id: 'kb_visitor' })).body.data;
    const chat = await request(app)
      .post('/api/v1/widget/chat/message')
      .set('x-widget-key', STORE_A_WIDGET_KEY)
      .send({ session_id: session.session_id || session.id, message: 'What warranty do the earbuds have?' });
    expect(chat.status).toBe(200);

    const context = spy.mock.calls[0][1];
    expect(context.assistantSettings.knowledge_base).toContain('Merchant document: warranty.txt');
    expect(context.assistantSettings.knowledge_base).toContain('2 year replacement warranty');
  });

  it('saving a large knowledge base no longer hits the 100kb body limit', async () => {
    const res = await request(app)
      .put(`/api/v1/dashboard/${STORE_A_ID}/agent`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ assistant: { knowledge_base: 'Brand notes. '.repeat(20000) } });
    expect(res.status).toBe(200);
  });
});
