/**
 * Merchant AI Agent service — orchestrates chat turns and document verdicts.
 *
 * Design notes:
 * - Chat: delegates to runAgentChat (tool-calling loop over live store data).
 * - Documents: parsed to capped text, then a single structured-JSON LLM call
 *   produces the verdict. Findings must be grounded in the document text;
 *   the schema + prompt forbid inventing figures.
 * - No chat history is persisted server-side (stateless; client sends history).
 * - Dependency injection points (llmRunner, verdictRunner) exist for tests.
 */
import OpenAI from 'openai';
import { z } from 'zod';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';
import { TenantIsolationError } from '../../utils/errors';
import { runAgentChat, isAgentConfigured, AGENT_MAX_OUTPUT_TOKENS } from './ai_agent.llm';
import { executeAgentTool } from './ai_agent.tools';
import {
  AgentChatRequest,
  AgentChatResponse,
  AgentDocumentResponse,
  AgentNotConfiguredError,
  DocumentVerdict,
  ParsedDocument,
} from './ai_agent.types';

const VerdictSchema = z.object({
  summary: z.string().min(1),
  key_findings: z.array(z.string()).min(1),
  risks_and_flags: z.array(z.string()),
  final_verdict: z.string().min(1),
  recommended_actions: z.array(z.string()),
});

const VERDICT_SYSTEM_PROMPT = `You are a senior e-commerce analyst. You read a merchant-uploaded business document and return a structured verdict as JSON.

HARD RULES:
1. Every finding, number, and claim MUST be grounded in the document text provided. NEVER invent figures, dates, or facts that are not in the document.
2. If the document is vague or incomplete, say so in the verdict instead of guessing.
3. Write the verdict in professional English, unless the document itself is written mainly in Hindi.
4. Respond with a single JSON object matching this schema:
{
  "summary": "2-3 sentence overview of what the document is about",
  "key_findings": ["concrete finding 1", "concrete finding 2", ...],
  "risks_and_flags": ["risk or red flag 1", ...],
  "final_verdict": "your overall verdict in 2-4 sentences",
  "recommended_actions": ["specific next action 1", ...]
}`;

export interface ServiceDeps {
  llmRunner?: typeof runAgentChat;
  verdictRunner?: (doc: ParsedDocument) => Promise<{
    verdict: DocumentVerdict;
    usage: { input_tokens: number; output_tokens: number; model: string };
  }>;
}

function requireStore(storeId: string): void {
  if (!storeId) throw new TenantIsolationError('store_id is required');
}

async function defaultVerdictRunner(doc: ParsedDocument): Promise<{
  verdict: DocumentVerdict;
  usage: { input_tokens: number; output_tokens: number; model: string };
}> {
  if (!isAgentConfigured()) {
    throw new AgentNotConfiguredError();
  }
  const env = getEnvConfig();
  const client = new OpenAI({ apiKey: (env.OPENAI_API_KEY || '').trim() });
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';

  const truncationNote = doc.truncated
    ? '\n\nNOTE: The document was truncated for analysis (very long file). Mention this limitation in your verdict.'
    : '';
  const userPrompt =
    `Analyze the following ${doc.documentType.toUpperCase()} document ("${doc.fileName}") and return your verdict as JSON.\n\n` +
    `--- DOCUMENT START ---\n${doc.text}\n--- DOCUMENT END ---${truncationNote}`;

  let raw = '{}';
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: VERDICT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: AGENT_MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_object' },
    });
    raw = response.choices[0]?.message?.content || '{}';
    inputTokens = response.usage?.prompt_tokens || 0;
    outputTokens = response.usage?.completion_tokens || 0;
  } catch (err) {
    logger.warn('AI agent document verdict LLM call failed');
    throw err;
  }

  // Store token usage for the response envelope (set by caller via closure below).
  const usage = { input_tokens: inputTokens, output_tokens: outputTokens, model };

  let parsed: unknown;
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch {
    throw new Error('The AI returned an unreadable analysis. Please try again.');
  }
  const validated = VerdictSchema.safeParse(parsed);
  if (!validated.success) {
    logger.warn('AI agent verdict schema mismatch');
    throw new Error('The AI returned an incomplete analysis. Please try again.');
  }
  return { verdict: validated.data, usage };
}

export class AiAgentService {
  private readonly deps: ServiceDeps;

  constructor(deps: ServiceDeps = {}) {
    this.deps = deps;
  }

  /** One chat turn. Throws AgentNotConfiguredError (503) when no LLM key exists. */
  async chat(storeId: string, req: AgentChatRequest): Promise<AgentChatResponse> {
    requireStore(storeId);
    if (!isAgentConfigured()) {
      throw new AgentNotConfiguredError();
    }
    const runner = this.deps.llmRunner || runAgentChat;
    return runner({
      storeId,
      message: req.message,
      history: req.history || [],
      toolExecutor: executeAgentTool,
    });
  }

  /** Structured verdict for an already-parsed document. */
  async analyzeDocument(storeId: string, doc: ParsedDocument): Promise<AgentDocumentResponse> {
    requireStore(storeId);
    if (!isAgentConfigured()) {
      throw new AgentNotConfiguredError();
    }
    const runner = this.deps.verdictRunner || defaultVerdictRunner;
    const { verdict, usage } = await runner(doc);
    const input = usage.input_tokens;
    const output = usage.output_tokens;
    const model = usage.model;
    return {
      verdict,
      fileName: doc.fileName,
      documentType: doc.documentType,
      truncated: doc.truncated,
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        estimated_cost_usd: parseFloat(((input * 0.15) / 1000000 + (output * 0.6) / 1000000).toFixed(6)),
      },
    };
  }
}
