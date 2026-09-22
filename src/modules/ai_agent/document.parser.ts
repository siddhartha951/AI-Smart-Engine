/**
 * Document parser for the Merchant AI Agent upload endpoint.
 *
 * Supports PDF, CSV, and XLSX. Everything is parsed in-memory from the
 * uploaded buffer; extracted text is token-capped (with a truncation flag)
 * before it ever reaches the LLM. Document contents are never logged.
 *
 * NOTE: pdf-parse is loaded lazily (never at module top-level). pdf-parse v2
 * requires Node >= 20.16, and a parser load failure must never crash the
 * server at boot — it degrades to an honest per-upload error instead.
 */
import * as XLSX from 'xlsx';
import { ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { ParsedDocument } from './ai_agent.types';

/** pdf-parse's callable signature: buffer in, extracted text out. */
type PdfParseFn = (buffer: Buffer) => Promise<{ text?: string }>;

async function loadPdfParser(): Promise<PdfParseFn> {
  const mod = (await import('pdf-parse')) as unknown as
    | { default?: unknown }
    | PdfParseFn;
  const candidate =
    typeof mod === 'function'
      ? mod
      : (mod as { default?: unknown }).default;
  if (typeof candidate !== 'function') {
    throw new Error('pdf-parse module did not export a parser function');
  }
  return candidate as PdfParseFn;
}

/** Max characters of extracted text forwarded to the LLM (~3k tokens). */
export const MAX_DOC_CHARS = 12000;

export const ALLOWED_UPLOAD_MIMES = new Set([
  'application/pdf',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.csv', '.xlsx', '.xls', '.txt']);

export function isAllowedUpload(fileName: string, mimeType: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) || ALLOWED_UPLOAD_MIMES.has(mimeType.toLowerCase());
}

export function documentTypeFor(fileName: string, mimeType: string): ParsedDocument['documentType'] {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const mime = mimeType.toLowerCase();
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.csv' || ext === '.txt' || mime.includes('csv') || mime === 'text/plain') return 'csv';
  return 'xlsx';
}

function capText(text: string): { text: string; truncated: boolean } {
  const cleaned = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned.length <= MAX_DOC_CHARS) {
    return { text: cleaned, truncated: false };
  }
  return { text: cleaned.slice(0, MAX_DOC_CHARS), truncated: true };
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields). No dependency needed. */
export function parseCsvText(raw: string): { rows: string[][]; rowCount: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  return { rows, rowCount: rows.length };
}

function csvRowsToText(rows: string[][], maxRows = 500): { text: string; dropped: boolean } {
  const dropped = rows.length > maxRows;
  const text = rows
    .slice(0, maxRows)
    .map((r) => r.join(' | '))
    .join('\n');
  return { text, dropped };
}

async function parsePdf(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  let pdfParse: PdfParseFn;
  try {
    pdfParse = await loadPdfParser();
  } catch {
    logger.warn('AI agent: PDF parser failed to load', { fileName });
    throw new ValidationError(
      'PDF reading is temporarily unavailable. Please try again later or upload a CSV/XLSX instead.'
    );
  }
  let result;
  try {
    result = await pdfParse(buffer);
  } catch {
    logger.warn('AI agent: PDF parse failed', { fileName });
    throw new ValidationError('Could not read this PDF. Please upload a text-based PDF (not a scanned image).');
  }
  const { text, truncated } = capText(result.text || '');
  if (!text) {
    throw new ValidationError('This PDF contains no readable text. Please upload a text-based PDF.');
  }
  return { fileName, mimeType: 'application/pdf', documentType: 'pdf', text, truncated };
}

function parseCsv(buffer: Buffer, fileName: string, mimeType: string): ParsedDocument {
  const raw = buffer.toString('utf-8');
  const { rows, rowCount } = parseCsvText(raw);
  if (rowCount === 0) {
    throw new ValidationError('This CSV appears to be empty.');
  }
  const { text: rowText, dropped } = csvRowsToText(rows);
  const { text, truncated } = capText(rowText);
  return { fileName, mimeType, documentType: 'csv', text, truncated: truncated || dropped, rowCount };
}

function parseXlsx(buffer: Buffer, fileName: string, mimeType: string): ParsedDocument {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    logger.warn('AI agent: XLSX parse failed', { fileName });
    throw new ValidationError('Could not read this spreadsheet. Please upload a valid .xlsx file.');
  }
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new ValidationError('This spreadsheet has no sheets.');
  }
  const sections: string[] = [];
  let totalRows = 0;
  let dropped = false;
  for (const name of sheetNames.slice(0, 5)) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    totalRows += nonEmpty.length;
    if (nonEmpty.length > 0) {
      const { text: sheetText, dropped: sheetDropped } = csvRowsToText(
        nonEmpty.map((r) => r.map(String)),
        300
      );
      dropped = dropped || sheetDropped;
      sections.push(`[Sheet: ${name}]\n${sheetText}`);
    }
  }
  if (sheetNames.length > 5) dropped = true;
  const { text, truncated } = capText(sections.join('\n\n'));
  if (!text) {
    throw new ValidationError('This spreadsheet contains no readable data.');
  }
  return { fileName, mimeType, documentType: 'xlsx', text, truncated: truncated || dropped, rowCount: totalRows, sheetNames };
}

/**
 * Parses an uploaded document buffer into capped plain text.
 * Throws ValidationError for unsupported or unreadable files.
 */
export async function parseDocument(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<ParsedDocument> {
  if (!isAllowedUpload(fileName, mimeType)) {
    throw new ValidationError('Only PDF, CSV, and XLSX documents are supported.');
  }
  const docType = documentTypeFor(fileName, mimeType);
  if (docType === 'pdf') return parsePdf(buffer, fileName);
  if (docType === 'csv') return parseCsv(buffer, fileName, mimeType);
  return parseXlsx(buffer, fileName, mimeType);
}
