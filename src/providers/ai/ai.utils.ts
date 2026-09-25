import { logger } from '../../utils/logger';

/**
 * Extracts and parses JSON safely from LLM output, handling markdown fences,
 * leading/trailing banter, and common formatting anomalies.
 */
export function extractAndParseJson<T = any>(raw: string): T {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty or non-string AI output received');
  }

  let cleaned = raw.trim();

  // Strip markdown code block wrappers ```json ... ``` or ``` ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Attempt direct parse first
  try {
    return JSON.parse(cleaned) as T;
  } catch (_firstErr) {
    // Attempt to locate outermost JSON object or array
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let startIdx = -1;
    let endIdx = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = cleaned.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      endIdx = cleaned.lastIndexOf(']');
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const candidate = cleaned.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate) as T;
      } catch (_candErr) {
        // Remove trailing commas before closing braces/brackets
        const sanitized = candidate
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/[\u201C\u201D]/g, '"'); // Smart quotes
        try {
          return JSON.parse(sanitized) as T;
        } catch (finalErr: any) {
          logger.warn(`Failed to parse extracted JSON candidate: ${finalErr.message}`, { sample: candidate.slice(0, 200) });
        }
      }
    }

    throw new Error(`Failed to extract valid JSON from LLM response: ${cleaned.slice(0, 150)}...`);
  }
}

/**
 * Maps **bold** product names in an assistant reply to catalog ids, in the order
 * mentioned. Deliberately strict: a loose word overlap would attach cards for
 * products the assistant never recommended.
 */
export function matchBoldProductMentions(
  content: string,
  products: Array<{ id: string; title: string }>,
  max = 3
): string[] {
  const bolds = Array.from((content || '').matchAll(/\*\*([^*]{3,120})\*\*/g))
    .map(m => m[1].toLowerCase().trim())
    .filter(b => b.length > 3 && !b.includes('http'));
  const words = (t: string) => t.split(/[^a-z0-9]+/).filter(w => w.length > 2);

  const ids: string[] = [];
  for (const bold of bolds) {
    let best: { id: string; score: number } | null = null;
    let ties = 0;
    for (const p of products) {
      const title = p.title.toLowerCase();
      const shortTitle = title.split(/[:\-|–(]/)[0].trim();
      let score = 0;
      if (title === bold || shortTitle === bold) score = 3;
      else if (title.includes(bold) || (shortTitle.length > 3 && bold.includes(shortTitle))) score = 2;
      else {
        const boldWords = words(bold);
        const titleWords = new Set(words(title));
        const overlap = boldWords.filter(w => titleWords.has(w)).length;
        if (boldWords.length > 0 && overlap >= 2 && overlap / boldWords.length >= 0.6) score = 1;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { id: p.id, score };
        ties = 1;
      } else if (best && score === best.score) {
        ties += 1;
      }
    }
    // A bold phrase shared by several titles (the brand name, "Itch Relief Formula") names no
    // single product; picking the first match would attach an arbitrary card
    if (best && best.score < 3 && ties > 2) continue;
    if (best && !ids.includes(best.id)) ids.push(best.id);
    if (ids.length >= max) break;
  }
  return ids;
}

/** Keeps short "why this fits" lines for known product ids only. */
export function pickReasons(raw: unknown, validIds: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (validIds.has(id) && typeof value === 'string' && value.trim()) {
      out[id] = value.replace(/\s+/g, ' ').trim().slice(0, 120);
    }
  }
  return out;
}
