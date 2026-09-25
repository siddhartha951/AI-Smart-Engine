/**
 * Merchant AI Agent — in-dashboard chat assistant for store owners.
 *
 * The agent answers questions using ONLY live, tenant-scoped store data
 * (Shopify + Meta Ads) via tool calls. It never invents metrics.
 */

import type { StoreToolName } from './ai_agent.store-tools';

export type AgentToolName =
  | 'get_today_overview'
  | 'get_meta_performance'
  | 'get_shopify_summary'
  | 'get_ad_creatives'
  | 'get_attribution_summary'
  | StoreToolName;

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentChatRequest {
  message: string;
  history?: ChatHistoryMessage[];
}

export interface AgentChatResponse {
  answer: string;
  tools_used: AgentToolName[];
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
  };
}

/** A tool result is always either data or an honest, merchant-safe error note. */
export interface AgentToolResult {
  ok: boolean;
  data?: unknown;
  note?: string;
}

export interface ParsedDocument {
  fileName: string;
  mimeType: string;
  documentType: 'pdf' | 'csv' | 'xlsx';
  /** Extracted plain text, already token-capped. */
  text: string;
  truncated: boolean;
  rowCount?: number;
  sheetNames?: string[];
}

export interface DocumentVerdict {
  summary: string;
  key_findings: string[];
  risks_and_flags: string[];
  final_verdict: string;
  recommended_actions: string[];
}

export interface AgentDocumentResponse {
  verdict: DocumentVerdict;
  fileName: string;
  documentType: string;
  truncated: boolean;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
  };
}

import { AppError } from '../../utils/errors';

/** Thrown when no LLM key is configured — surfaces as an honest 503, never a fake answer. */
export class AgentNotConfiguredError extends AppError {
  constructor() {
    super(
      'The AI agent is not configured for this store yet. Please ask the store owner to set an OpenAI API key.',
      503,
      'AI_AGENT_NOT_CONFIGURED'
    );
    this.name = 'AgentNotConfiguredError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
