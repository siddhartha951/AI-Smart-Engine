import { IDatabaseClient } from '../../database/client';
import { KnowledgeDocumentRepository } from './knowledge-document.repository';

/**
 * Picks the knowledge passages that matter for the shopper's question instead of
 * dumping the whole knowledge base into every prompt. Keyword-overlap retrieval
 * (no embeddings needed): merchant-uploaded documents outrank website-scan text
 * because the merchant wrote them on purpose.
 */

export interface KnowledgeChunk {
  source: string;
  text: string;
  priority: number; // 2 = merchant document, 1 = knowledge base text
  order: number;
}

export const DEFAULT_KNOWLEDGE_BUDGET = 7000;
const CHUNK_TARGET = 900;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'has',
  'was', 'were', 'can', 'could', 'would', 'should', 'will', 'what', 'which', 'when', 'where', 'who', 'how',
  'why', 'does', 'did', 'any', 'all', 'our', 'out', 'about', 'into', 'more', 'some', 'than', 'then', 'them',
  'they', 'their', 'there', 'these', 'those', 'its', 'also', 'just', 'very', 'much', 'many', 'please', 'want',
  'need', 'like', 'tell', 'know', 'give', 'get', 'hai', 'hain', 'kya', 'mujhe', 'chahiye', 'batao', 'kaise',
  'liye', 'aur', 'nahi', 'hello', 'thanks', 'thank',
]);

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
    .map(t => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/** Splits text into roughly CHUNK_TARGET-sized passages on paragraph/heading boundaries. */
export function chunkText(text: string, source: string, priority: number, startOrder = 0): KnowledgeChunk[] {
  const paragraphs = (text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n|\n(?=---|#{1,4}\s|[A-Z][A-Za-z &/]{2,40}:\s*$)/m)
    .map(p => p.trim())
    .filter(Boolean);

  const chunks: KnowledgeChunk[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) {
      chunks.push({ source, text: current.trim(), priority, order: startOrder + chunks.length });
    }
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_TARGET * 1.5) {
      push();
      // Oversized paragraph: split on sentence boundaries
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if ((current + ' ' + sentence).length > CHUNK_TARGET) push();
        current = current ? `${current} ${sentence}` : sentence;
      }
      push();
      continue;
    }
    if ((current + '\n\n' + para).length > CHUNK_TARGET) push();
    current = current ? `${current}\n\n${para}` : para;
  }
  push();
  return chunks;
}

function scoreChunk(chunk: KnowledgeChunk, queryTokens: string[], docFreq: Map<string, number>, totalChunks: number): number {
  if (queryTokens.length === 0) return 0;
  const chunkTokens = new Set(tokenize(chunk.text + ' ' + chunk.source));
  let score = 0;
  for (const token of new Set(queryTokens)) {
    let hit = chunkTokens.has(token);
    if (!hit && token.length > 4) {
      // Cheap partial match: "allergies" vs "allergy", "shipping" vs "ship"
      const stem = token.slice(0, Math.max(4, token.length - 3));
      hit = [...chunkTokens].some(ct => ct.startsWith(stem));
    }
    if (hit) {
      const df = docFreq.get(token) || 1;
      score += Math.log(1 + totalChunks / df) + 1;
    }
  }
  return score * (chunk.priority === 2 ? 1.5 : 1);
}

export function selectRelevantKnowledge(
  chunks: KnowledgeChunk[],
  query: string,
  budget = DEFAULT_KNOWLEDGE_BUDGET
): KnowledgeChunk[] {
  const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
  if (total <= budget) return chunks;

  const queryTokens = tokenize(query);
  const docFreq = new Map<string, number>();
  for (const chunk of chunks) {
    for (const token of new Set(tokenize(chunk.text))) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const scored = chunks
    .map(chunk => ({ chunk, score: scoreChunk(chunk, queryTokens, docFreq, chunks.length) }))
    .sort((a, b) => b.score - a.score || b.chunk.priority - a.chunk.priority || a.chunk.order - b.chunk.order);

  const picked: KnowledgeChunk[] = [];
  let used = 0;
  // Always keep the brand overview (first knowledge-base passage) so general questions have grounding
  const overview = chunks.find(c => c.priority === 1);
  if (overview && overview.text.length <= budget / 3) {
    picked.push(overview);
    used += overview.text.length;
  }
  for (const { chunk, score } of scored) {
    if (picked.includes(chunk)) continue;
    if (score === 0 && picked.length >= 3) break;
    if (used + chunk.text.length > budget) continue;
    picked.push(chunk);
    used += chunk.text.length;
  }
  return picked.sort((a, b) => b.priority - a.priority || a.order - b.order);
}

export function formatKnowledge(chunks: KnowledgeChunk[]): string {
  const groups = new Map<string, string[]>();
  for (const chunk of chunks) {
    const list = groups.get(chunk.source) || [];
    list.push(chunk.text);
    groups.set(chunk.source, list);
  }
  return [...groups.entries()]
    .map(([source, texts]) => `[${source}]\n${texts.join('\n\n')}`)
    .join('\n\n');
}

/**
 * Loads the store's knowledge base + uploaded documents and returns only the
 * passages relevant to `query` (the shopper's recent messages), within budget.
 */
export async function buildKnowledgeContext(
  storeId: string,
  knowledgeBase: string,
  query: string,
  db: IDatabaseClient,
  budget = DEFAULT_KNOWLEDGE_BUDGET
): Promise<string> {
  let documents: Array<{ file_name: string; content: string }> = [];
  try {
    documents = await new KnowledgeDocumentRepository(db).listDocuments(storeId);
  } catch {
    // Table missing (migration not yet applied) must never break the chat
    documents = [];
  }

  const chunks: KnowledgeChunk[] = [];
  for (const doc of documents) {
    chunks.push(...chunkText(doc.content, `Merchant document: ${doc.file_name}`, 2, chunks.length));
  }
  if (knowledgeBase?.trim()) {
    chunks.push(...chunkText(knowledgeBase, 'Store knowledge base', 1, chunks.length));
  }
  if (chunks.length === 0) return '';

  return formatKnowledge(selectRelevantKnowledge(chunks, query, budget));
}
