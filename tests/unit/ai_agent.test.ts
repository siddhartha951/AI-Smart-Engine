import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { AGENT_SYSTEM_PROMPT } from '../../src/modules/ai_agent/ai_agent.llm';
import { AGENT_TOOLS, executeAgentTool } from '../../src/modules/ai_agent/ai_agent.tools';
import {
  parseCsvText,
  parseDocument,
  isAllowedUpload,
  documentTypeFor,
  MAX_DOC_CHARS,
} from '../../src/modules/ai_agent/document.parser';
import {
  checkRateLimit,
  resetRateLimits,
} from '../../src/modules/ai_agent/rate_limiter';
import { ValidationError } from '../../src/utils/errors';

describe('Merchant AI Agent — grounding contract', () => {
  it('system prompt hard-requires numbers to come from tool results', () => {
    expect(AGENT_SYSTEM_PROMPT).toMatch(/MUST come from a tool result/i);
    expect(AGENT_SYSTEM_PROMPT).toMatch(/NEVER invent/i);
  });

  it('exposes exactly the expected tools (Meta/attribution + whole-store Shopify tools)', () => {
    const names = AGENT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_ad_creatives', 'get_attribution_summary', 'get_meta_performance', 'get_shopify_summary', 'get_today_overview',
        'get_sales_trend', 'search_orders', 'get_order_details', 'get_product_performance', 'get_customer_insights',
        'get_discount_performance', 'get_payments_summary', 'get_inventory_alerts', 'get_funnel_summary', 'get_growth_actions',
      ].sort()
    );
  });

  it('unknown tool returns an honest note instead of throwing', async () => {
    const res = await executeAgentTool('store-1', 'delete_everything', {});
    expect(res.ok).toBe(false);
    expect(res.note).toMatch(/unknown tool/i);
  });

  it('missing store id never throws to the caller — returns an honest note', async () => {
    const res = await executeAgentTool('', 'get_today_overview', {});
    expect(res.ok).toBe(false);
    expect(res.note).toBeTruthy();
  });
});

describe('Merchant AI Agent — CSV parser', () => {
  it('parses quoted fields containing commas and newlines', () => {
    const { rows, rowCount } = parseCsvText('name,note\n"a,b","line1\nline2"\nplain,ok');
    expect(rowCount).toBe(3);
    expect(rows[1]).toEqual(['a,b', 'line1\nline2']);
    expect(rows[2]).toEqual(['plain', 'ok']);
  });

  it('handles escaped quotes', () => {
    const { rows } = parseCsvText('"say ""hi""",x');
    expect(rows[0]).toEqual(['say "hi"', 'x']);
  });

  it('skips blank rows', () => {
    const { rowCount } = parseCsvText('a,b\n\n\nc,d\n');
    expect(rowCount).toBe(2);
  });
});

describe('Merchant AI Agent — document parsing', () => {
  it('parses a CSV buffer into capped text with row count', async () => {
    const doc = await parseDocument(
      Buffer.from('campaign,spend\nDiwali,1200\nHoli,800'),
      'report.csv',
      'text/csv'
    );
    expect(doc.documentType).toBe('csv');
    expect(doc.rowCount).toBe(3);
    expect(doc.text).toContain('Diwali | 1200');
    expect(doc.truncated).toBe(false);
  });

  it('parses an XLSX buffer across sheets', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ad', 'spend'], ['A1', 100]]), 'Ads');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['k', 'v'], ['x', 1]]), 'Meta');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const doc = await parseDocument(buf, 'data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(doc.documentType).toBe('xlsx');
    expect(doc.sheetNames).toEqual(['Ads', 'Meta']);
    expect(doc.text).toContain('[Sheet: Ads]');
    expect(doc.text).toContain('A1 | 100');
  });

  it('rejects unsupported file types with a merchant-safe error', async () => {
    await expect(parseDocument(Buffer.from('x'), 'evil.exe', 'application/x-msdownload')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('rejects unreadable PDFs with a merchant-safe error (never a stack trace)', async () => {
    await expect(
      parseDocument(Buffer.from('this is not a pdf at all'), 'x.pdf', 'application/pdf')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects empty CSVs', async () => {
    await expect(parseDocument(Buffer.from('\n\n'), 'empty.csv', 'text/csv')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('truncates very long documents and flags it', async () => {
    const big = 'a,b\n' + 'x,y\n'.repeat(20000);
    const doc = await parseDocument(Buffer.from(big), 'big.csv', 'text/csv');
    expect(doc.truncated).toBe(true);
    expect(doc.text.length).toBeLessThanOrEqual(MAX_DOC_CHARS);
  });

  it('allow-list accepts pdf/csv/xlsx/txt by extension or mime', () => {
    expect(isAllowedUpload('r.pdf', 'application/pdf')).toBe(true);
    expect(isAllowedUpload('r.csv', 'text/csv')).toBe(true);
    expect(isAllowedUpload('r.xlsx', 'application/octet-stream')).toBe(true);
    expect(isAllowedUpload('r.txt', 'text/plain')).toBe(true);
    expect(isAllowedUpload('r.exe', 'application/x-msdownload')).toBe(false);
  });

  it('documentTypeFor maps extensions and mimes', () => {
    expect(documentTypeFor('a.PDF', 'application/octet-stream')).toBe('pdf');
    expect(documentTypeFor('a.txt', 'text/plain')).toBe('csv');
    expect(documentTypeFor('a.xls', 'application/vnd.ms-excel')).toBe('xlsx');
  });
});

describe('Merchant AI Agent — rate limiter', () => {
  it('allows up to the max, then blocks with a retry hint', () => {
    resetRateLimits();
    const opts = { maxRequests: 3, windowMs: 60_000 };
    expect(checkRateLimit('k1', opts).allowed).toBe(true);
    expect(checkRateLimit('k1', opts).allowed).toBe(true);
    expect(checkRateLimit('k1', opts).allowed).toBe(true);
    const blocked = checkRateLimit('k1', opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('scopes buckets per key (per store)', () => {
    resetRateLimits();
    const opts = { maxRequests: 1, windowMs: 60_000 };
    expect(checkRateLimit('store-a', opts).allowed).toBe(true);
    expect(checkRateLimit('store-a', opts).allowed).toBe(false);
    expect(checkRateLimit('store-b', opts).allowed).toBe(true);
  });
});
