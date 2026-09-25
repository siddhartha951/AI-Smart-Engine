/**
 * Merchant AI Agent LLM layer.
 *
 * Uses the OpenAI chat-completions API with function/tool calling, reusing the
 * same env/config approach as the existing providers (getEnvConfig()).
 *
 * Honesty contract:
 * - If OPENAI_API_KEY is missing/empty -> AgentNotConfiguredError (HTTP 503).
 *   NEVER fabricate an answer when the key is absent — in any environment.
 * - The system prompt hard-requires that every number in the final answer
 *   comes from a tool result. Missing data is stated plainly, never invented.
 */
import OpenAI from 'openai';
import { getEnvConfig } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  AGENT_TOOLS,
  TOOL_FEATURES,
  ToolDefinition,
  executeAgentTool,
  getAllowedAgentTools,
} from './ai_agent.tools';
import {
  AgentChatResponse,
  AgentNotConfiguredError,
  AgentToolName,
  ChatHistoryMessage,
} from './ai_agent.types';
import { decideReplyLanguage, languageInstruction } from './language';

/** Hard ceiling on LLM output per agent turn (cost safety). */
export const AGENT_MAX_OUTPUT_TOKENS = 1200;
/** Hard ceiling on tool-call iterations per user message (loop safety). */
export const AGENT_MAX_TOOL_ITERATIONS = 6;
/** Rough USD cost model for the default chat model (gpt-4o-mini class). */
const INPUT_COST_PER_1M = 0.15;
const OUTPUT_COST_PER_1M = 0.6;

export const AGENT_SYSTEM_PROMPT = `You are the merchant's AI business analyst inside the AI Smart Engine dashboard. You answer the store owner's questions about THEIR store using live data tools.

HARD RULES — never break these:
1. EVERY number, metric, or factual claim in your answer MUST come from a tool result in this conversation. If you did not call a tool, you do not know the number.
2. If a tool says a connection is missing (Shopify / Meta Ads not connected) or data is unavailable, say so plainly and tell the merchant what to connect. NEVER invent revenue, spend, ROAS, order counts, or any metric.
3. NEVER reveal API keys, access tokens, or any other store's data. You only ever see this one store.
4. If the merchant's question is not about their store data (greetings, general advice), answer briefly without tools — but never attach numbers to such answers.
5. Keep answers concise and skimmable. Use short bullet lists for multiple findings.
6. Write in professional English by default. Follow the REPLY LANGUAGE instruction below exactly; do not switch language because of a single Hindi word.

You can see the whole store: sales trends, orders (and single orders), products, customers, coupons, payments, inventory, the storefront funnel, Meta ads and the Growth Copilot's actions. For "how is my store doing" style questions, call several tools and combine them.

Think like a senior e-commerce advisor: compare with the previous period, spot what changed and why, and point out risks (stock-outs, refunds, discount dependence, unshipped paid orders).

End every answer about the store with a short "What to do next" list: 1-3 specific actions, each tied to a number you reported and where to do it (e.g. "Growth Copilot", "Email Automation", "Shopify admin → Discounts"). If data is missing, the first action is how to connect it.`;

function getClient(): OpenAI {
  const env = getEnvConfig();
  const key = (env.OPENAI_API_KEY || '').trim();
  if (!key) {
    throw new AgentNotConfiguredError();
  }
  return new OpenAI({ apiKey: key });
}

/** Public check used by routes/services: is the agent actually configured? */
export function isAgentConfigured(): boolean {
  try {
    const env = getEnvConfig();
    return Boolean((env.OPENAI_API_KEY || '').trim());
  } catch {
    return false;
  }
}

function toOpenAiTools(defs: ToolDefinition[] = AGENT_TOOLS): OpenAI.Chat.ChatCompletionTool[] {
  return defs.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return parseFloat(
    ((inputTokens * INPUT_COST_PER_1M) / 1000000 + (outputTokens * OUTPUT_COST_PER_1M) / 1000000).toFixed(6)
  );
}

export interface RunAgentChatOptions {
  storeId: string;
  message: string;
  history?: ChatHistoryMessage[];
  /** Injectable OpenAI client (tests). Defaults to the env-configured client. */
  client?: OpenAI;
  /** Injectable tool executor (tests). Defaults to executeAgentTool. */
  toolExecutor?: typeof executeAgentTool;
  /** Extra system context: facts the merchant taught, data freshness */
  extraContext?: string;
}

/**
 * Runs one merchant chat turn: tool-calling loop followed by a grounded answer.
 * Throws AgentNotConfiguredError when no LLM key is configured.
 */
export async function runAgentChat(opts: RunAgentChatOptions): Promise<AgentChatResponse> {
  const { storeId, message, history = [] } = opts;
  const client = opts.client || getClient(); // throws AgentNotConfiguredError when key missing
  const runTool = opts.toolExecutor || executeAgentTool;
  const env = getEnvConfig();
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';

  const recentHistory = history.slice(-20);
  const replyLanguage = decideReplyLanguage([
    ...recentHistory.filter((m) => m.role === 'user').map((m) => m.content),
    message,
  ]);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: [AGENT_SYSTEM_PROMPT, opts.extraContext || '', languageInstruction(replyLanguage)].filter(Boolean).join('\n\n'),
    },
    ...recentHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  // Only offer tools for modules this store is entitled to (fail closed to core Shopify tools)
  let allowedTools: ToolDefinition[];
  try {
    allowedTools = await getAllowedAgentTools(storeId);
  } catch {
    allowedTools = AGENT_TOOLS.filter((t) => !TOOL_FEATURES[t.name]);
  }
  const tools = toOpenAiTools(allowedTools);
  const toolsUsed: AgentToolName[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < AGENT_MAX_TOOL_ITERATIONS; i++) {
    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: AGENT_MAX_OUTPUT_TOKENS,
        temperature: 0.3,
      });
    } catch (err: unknown) {
      logger.warn('AI agent LLM call failed', { storeId });
      throw err;
    }

    const choice = response.choices[0];
    inputTokens += response.usage?.prompt_tokens || 0;
    outputTokens += response.usage?.completion_tokens || 0;

    const toolCalls = choice.message.tool_calls || [];
    if (toolCalls.length === 0) {
      return {
        answer: (choice.message.content || '').trim() || 'I could not generate an answer. Please try again.',
        tools_used: toolsUsed,
        model,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost_usd: estimateCost(inputTokens, outputTokens),
        },
      };
    }

    // Append the assistant's tool-call message, then execute each tool.
    const functionCalls = toolCalls.filter(
      (tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === 'function'
    );
    messages.push({
      role: 'assistant',
      content: choice.message.content,
      tool_calls: functionCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    for (const tc of functionCalls) {
      const name = tc.function.name as AgentToolName;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      if (!toolsUsed.includes(name)) toolsUsed.push(name);
      // Never let a tool failure kill the turn: surface the honest note instead.
      let result;
      try {
        result = await runTool(storeId, name, args);
      } catch {
        result = { ok: false, note: 'This data is temporarily unavailable.' };
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  // Loop ceiling hit — ask the model for a final grounded summary without more tools.
  const final = await client.chat.completions.create({
    model,
    messages: [
      ...messages,
      {
        role: 'user',
        content: 'Summarize what you found so far in a short answer. Only use numbers from the tool results above.',
      },
    ],
    max_tokens: AGENT_MAX_OUTPUT_TOKENS,
    temperature: 0.3,
  });
  const finalChoice = final.choices[0];
  inputTokens += final.usage?.prompt_tokens || 0;
  outputTokens += final.usage?.completion_tokens || 0;

  return {
    answer: (finalChoice.message.content || '').trim() || 'I could not generate an answer. Please try again.',
    tools_used: toolsUsed,
    model,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCost(inputTokens, outputTokens),
    },
  };
}
