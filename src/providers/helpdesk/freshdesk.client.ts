/**
 * Minimal Freshdesk v2 API client (https://developers.freshdesk.com/api/).
 *
 * - Only `<subdomain>.freshdesk.com` hosts are ever called (the merchant types the domain,
 *   so anything else is refused rather than fetched).
 * - Auth is HTTP Basic with the agent's API key as the user and "X" as the password.
 * - The API key is never logged or returned.
 */

export interface FreshdeskCredentials {
  domain: string; // normalized, e.g. "acme.freshdesk.com"
  apiKey: string;
}

export type FreshdeskErrorCode = 'auth' | 'not_found' | 'rate_limited' | 'validation' | 'server' | 'network';

export class FreshdeskError extends Error {
  constructor(
    public readonly code: FreshdeskErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'FreshdeskError';
  }
}

export const FRESHDESK_TIMEOUT_MS = 10000;
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * "acme", "acme.freshdesk.com", "https://acme.freshdesk.com/a/tickets" → "acme.freshdesk.com".
 * Returns null for anything that is not a plain freshdesk.com subdomain.
 */
export function normalizeFreshdeskDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let host = input.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].split('@').pop() || '';
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host.includes('.')) host = `${host}.freshdesk.com`;
  if (!host.endsWith('.freshdesk.com')) return null;
  const sub = host.slice(0, -'.freshdesk.com'.length);
  return SUBDOMAIN_RE.test(sub) ? host : null;
}

export function freshdeskTicketUrl(domain: string, ticketId: string | number): string {
  return `https://${domain}/a/tickets/${ticketId}`;
}

/** Our triage priority → Freshdesk priority (1 Low, 2 Medium, 3 High, 4 Urgent). */
export function freshdeskPriority(priority: string | undefined): 1 | 2 | 3 | 4 {
  switch (priority) {
    case 'low': return 1;
    case 'high': return 3;
    case 'urgent': return 4;
    default: return 2;
  }
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ROLE_LABELS: Record<string, string> = { user: 'Customer', assistant: 'AI assistant', system: 'System' };
const MAX_DESCRIPTION_CHARS = 60000;

export interface TicketDescriptionInput {
  subject: string;
  category?: string;
  priority?: string;
  sentiment?: string;
  storeName?: string;
  transcript: Array<{ role: string; content: string }>;
}

/** HTML description: the request, triage labels and the full chat history (all text escaped). */
export function buildTicketDescription(input: TicketDescriptionInput): string {
  const labels = [
    input.category && `<strong>Category:</strong> ${escapeHtml(input.category.replace(/_/g, ' '))}`,
    input.priority && `<strong>Priority:</strong> ${escapeHtml(input.priority)}`,
    input.sentiment && `<strong>Sentiment:</strong> ${escapeHtml(input.sentiment)}`,
  ].filter(Boolean).join(' &middot; ');

  const head = [
    `<p><strong>Customer request:</strong> ${escapeHtml(input.subject)}</p>`,
    labels ? `<p>${labels}</p>` : '',
    '<h3>Chat history</h3>',
  ].join('');
  const footer = `<p><em>Created by the ${escapeHtml(input.storeName || 'store')} AI shopping assistant (AI Smart Engine).</em></p>`;

  const lines = (input.transcript || [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => `<p><strong>${escapeHtml(ROLE_LABELS[m.role] || m.role)}:</strong> ${escapeHtml(m.content.trim()).replace(/\r?\n/g, '<br>')}</p>`);
  if (lines.length === 0) lines.push('<p><em>No chat messages were attached.</em></p>');

  // Keep the newest messages when the history is too long for one ticket
  let body = lines.join('');
  while (head.length + body.length + footer.length > MAX_DESCRIPTION_CHARS && lines.length > 1) {
    lines.shift();
    body = `<p><em>Earlier messages omitted.</em></p>${lines.join('')}`;
  }
  return head + body + footer;
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

async function request<T>(
  creds: FreshdeskCredentials,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<T> {
  const domain = normalizeFreshdeskDomain(creds.domain);
  if (!domain) throw new FreshdeskError('validation', 'Freshdesk domain must look like yourcompany.freshdesk.com');
  if (!creds.apiKey) throw new FreshdeskError('auth', 'Freshdesk API key is missing');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FRESHDESK_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(`https://${domain}/api/v2${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.apiKey}:X`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError';
    throw new FreshdeskError('network', timedOut ? 'Freshdesk did not respond in time' : 'Could not reach Freshdesk');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (res.ok) return json as T;

  if (res.status === 401 || res.status === 403) {
    throw new FreshdeskError('auth', 'Freshdesk rejected the API key. Copy it again from Profile settings in Freshdesk.', res.status);
  }
  if (res.status === 404) {
    throw new FreshdeskError('not_found', 'Freshdesk account not found. Check the domain.', res.status);
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    throw new FreshdeskError('rate_limited', 'Freshdesk rate limit reached. It will be retried.', res.status, retryAfter);
  }
  if (res.status >= 400 && res.status < 500) {
    const detail = Array.isArray(json?.errors)
      ? json.errors.map((e: any) => [e.field, e.message].filter(Boolean).join(': ')).join('; ')
      : json?.description || json?.message || '';
    throw new FreshdeskError('validation', `Freshdesk refused the ticket${detail ? `: ${String(detail).slice(0, 300)}` : ''}`, res.status);
  }
  throw new FreshdeskError('server', `Freshdesk error (${res.status}). It will be retried.`, res.status);
}

/** Confirms the domain and API key work; returns the agent the key belongs to. */
export async function testFreshdeskConnection(
  creds: FreshdeskCredentials,
  fetchImpl?: FetchLike
): Promise<{ agentName: string | null; agentEmail: string | null }> {
  const me = await request<any>(creds, 'GET', '/agents/me', undefined, fetchImpl);
  return {
    agentName: me?.contact?.name ?? null,
    agentEmail: me?.contact?.email ?? null,
  };
}

export interface CreateFreshdeskTicketInput {
  email: string;
  name?: string | null;
  subject: string;
  descriptionHtml: string;
  priority: 1 | 2 | 3 | 4;
  tags?: string[];
}

/**
 * Creates an open "Chat" ticket for the shopper. Freshdesk emails the requester when an
 * agent replies, and the shopper's email replies thread back into the same ticket.
 */
export async function createFreshdeskTicket(
  creds: FreshdeskCredentials,
  input: CreateFreshdeskTicketInput,
  fetchImpl?: FetchLike
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = {
    email: input.email,
    subject: (input.subject || 'Support request').slice(0, 250),
    description: input.descriptionHtml,
    priority: input.priority,
    status: 2, // Open
    source: 7, // Chat
    tags: (input.tags || []).filter(Boolean).slice(0, 10),
  };
  if (input.name && input.name.trim()) payload.name = input.name.trim().slice(0, 200);
  const created = await request<any>(creds, 'POST', '/tickets', payload, fetchImpl);
  if (!created || created.id === undefined || created.id === null) {
    throw new FreshdeskError('server', 'Freshdesk did not return a ticket id');
  }
  return { id: String(created.id) };
}
