import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { InMemoryPostgresClient, setDatabaseClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { resetEnvConfig } from '../../src/config/env';
import { resetRateLimits } from '../../src/modules/ai_agent/rate_limiter';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function chatCompletion(content: string | null, toolCalls?: Array<{ id: string; name: string; args: string }>) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          tool_calls: toolCalls?.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args },
          })),
        },
        finish_reason: toolCalls?.length ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/** Scripted OpenAI stub: each chat-completions call consumes the next responder. */
function openAiStub(responders: Array<(body: Record<string, unknown>) => unknown>) {
  let call = 0;
  return vi.fn(async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions')) {
      const body = JSON.parse(init?.body || '{}') as Record<string, unknown>;
      const responder = responders[Math.min(call, responders.length - 1)];
      call++;
      return jsonResponse(responder(body));
    }
    return jsonResponse({ error: { message: 'Not stubbed', type: 'Exception', code: 1 } }, 500);
  });
}

const VERDICT_JSON = {
  summary: 'Q3 ad spend report for the test store.',
  key_findings: ['Spend was concentrated in one campaign', 'CTR improved week over week'],
  risks_and_flags: ['Single-campaign dependency is risky'],
  final_verdict: 'Healthy spend pattern, but diversify campaigns.',
  recommended_actions: ['Launch a second prospecting campaign'],
};

describe('Merchant AI Agent', () => {
  let app: any;
  let db: InMemoryPostgresClient;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  let tokenA: string;

  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  function setAgentKey(key: string | undefined) {
    if (key === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = key;
    }
    resetEnvConfig();
  }

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    setDatabaseClient(db);
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    app = createApp({ db });
    resetRateLimits();

    const resA = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantA@store.com', password: 'password123' });
    tokenA = resA.body.token;

    const resB = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'merchantB@store.com', password: 'password123' });
    expect(resB.body.token).toBeTruthy();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimits();
    // Restore ambient env for other test files.
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    resetEnvConfig();
    await db.close();
  });

  it('1. GET /status reports configured=false when no key is set (honest)', async () => {
    setAgentKey(undefined);
    const res = await request(app)
      .get(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/status`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
  });

  it('2. POST /chat without a key returns honest 503 — never a fake answer', async () => {
    setAgentKey(undefined);
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/chat`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'aaj kitni sale hui?' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_AGENT_NOT_CONFIGURED');
    expect(res.body.error.message).toMatch(/not configured/i);
  });

  it('3. POST /upload without a key returns honest 503 — never a fake verdict', async () => {
    setAgentKey(undefined);
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/upload`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('campaign,spend\nA,100'), 'r.csv');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_AGENT_NOT_CONFIGURED');
  });

  it('4. chat runs the tool loop and returns a grounded answer (no invented numbers)', async () => {
    setAgentKey('test-key');
    vi.stubGlobal(
      'fetch',
      openAiStub([
        // Turn 1: model asks for today's overview via tool.
        () =>
          chatCompletion(null, [
            { id: 'call_1', name: 'get_today_overview', args: '{}' },
          ]),
        // Turn 2: model answers from the tool result. No stores are connected
        // in this test DB, so the honest answer contains no metrics at all.
        () => chatCompletion('Aaj ka data uplabdh nahi hai — Shopify aur Meta Ads dono connected nahi hain. Pehle dono connect karo, phir mai exact sales aur spend bataunga.'),
      ])
    );

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/chat`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'aaj kitni sale hui?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tools_used).toContain('get_today_overview');
    // Grounding: with no connections, the answer must not contain any digits
    // (no invented revenue / spend / order counts).
    expect(res.body.data.answer).not.toMatch(/\d/);
    expect(res.body.data.usage.input_tokens).toBeGreaterThan(0);
  });

  it('5. tenant isolation: store A merchant cannot chat as store B', async () => {
    setAgentKey('test-key');
    vi.stubGlobal('fetch', openAiStub([() => chatCompletion('hi')]));
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_B_ID}/ai-agent/chat`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'hello' });
    expect(res.status).toBe(403);
  });

  it('6. chat validates input (empty message -> 400, not a 500)', async () => {
    setAgentKey('test-key');
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/chat`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('7. rate limiting: 21st rapid chat request is rejected with 429', async () => {
    setAgentKey('test-key');
    vi.stubGlobal('fetch', openAiStub([() => chatCompletion('ok')]));
    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/chat`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: `ping ${i}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('8. upload CSV -> structured verdict with all required sections', async () => {
    setAgentKey('test-key');
    vi.stubGlobal('fetch', openAiStub([() => chatCompletion(JSON.stringify(VERDICT_JSON))]));

    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/upload`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('campaign,spend\nDiwali,1200\nHoli,800'), 'spend.csv');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const v = res.body.data.verdict;
    expect(v.summary).toBeTruthy();
    expect(Array.isArray(v.key_findings) && v.key_findings.length).toBeTruthy();
    expect(Array.isArray(v.risks_and_flags)).toBe(true);
    expect(v.final_verdict).toBeTruthy();
    expect(Array.isArray(v.recommended_actions)).toBe(true);
    expect(res.body.data.fileName).toBe('spend.csv');
    expect(res.body.data.documentType).toBe('csv');
  });

  it('9. upload rejects unsupported file types with a clean 400', async () => {
    setAgentKey('test-key');
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/upload`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', Buffer.from('MZ...'), 'evil.exe');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/PDF, CSV/i);
  });

  it('10. upload rejects oversized documents with a clean 400', async () => {
    setAgentKey('test-key');
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 'a');
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/upload`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('document', big, 'big.csv');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/10MB/i);
  });

  it('11. tool grounding: get_meta_performance with no connection returns honest note, not zeros-as-facts', async () => {
    setAgentKey('test-key');
    vi.stubGlobal(
      'fetch',
      openAiStub([
        () => chatCompletion(null, [{ id: 'call_1', name: 'get_meta_performance', args: '{"level":"campaign"}' }]),
        (body) => {
          // Inspect the tool result the model received: it must be an honest
          // not-connected note, never fabricated KPIs.
          const msgs = (body.messages || []) as Array<{ role?: string; content?: string }>;
          const toolMsg = msgs.find((m) => m.role === 'tool');
          expect(toolMsg?.content).toMatch(/not connected/i);
          return chatCompletion('Meta Ads connected nahi hai, isliye performance data nahi de sakta.');
        },
      ])
    );
    const res = await request(app)
      .post(`/api/v1/dashboard/${STORE_A_ID}/ai-agent/chat`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ message: 'campaign performance batao' });
    expect(res.status).toBe(200);
    expect(res.body.data.tools_used).toContain('get_meta_performance');
  });
});
