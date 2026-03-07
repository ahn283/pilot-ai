import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export interface Chunk {
  id: string;
  source: string;
  content: string;
  tokens: string[];
}

export interface SearchIndex {
  chunks: Chunk[];
  idf: Record<string, number>;
  updatedAt: string;
}

function getIndexPath(): string {
  return path.join(getPilotDir(), 'search-index.json');
}

// --- Tokenization ---

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// --- Chunking ---

export function splitIntoChunks(content: string, source: string, maxLines: number = 20): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let idx = 0;

  for (let i = 0; i < lines.length; i += maxLines) {
    const slice = lines.slice(i, i + maxLines).join('\n').trim();
    if (!slice) continue;
    const tokens = tokenize(slice);
    if (tokens.length === 0) continue;
    chunks.push({
      id: `${source}:${idx++}`,
      source,
      content: slice,
      tokens,
    });
  }

  return chunks;
}

// --- TF-IDF ---

function computeTf(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) {
    tf[t] = (tf[t] ?? 0) + 1;
  }
  const max = Math.max(...Object.values(tf));
  for (const t of Object.keys(tf)) {
    tf[t] /= max;
  }
  return tf;
}

function computeIdf(chunks: Chunk[]): Record<string, number> {
  const df: Record<string, number> = {};
  for (const chunk of chunks) {
    const seen = new Set(chunk.tokens);
    for (const t of seen) {
      df[t] = (df[t] ?? 0) + 1;
    }
  }
  const N = chunks.length;
  const idf: Record<string, number> = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log(N / count);
  }
  return idf;
}

function tfidfVector(tokens: string[], idf: Record<string, number>): Record<string, number> {
  const tf = computeTf(tokens);
  const vec: Record<string, number> = {};
  for (const [term, tfVal] of Object.entries(tf)) {
    vec[term] = tfVal * (idf[term] ?? 0);
  }
  return vec;
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of allKeys) {
    const va = a[key] ?? 0;
    const vb = b[key] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// --- Index management ---

export async function loadIndex(): Promise<SearchIndex> {
  try {
    const data = await fs.readFile(getIndexPath(), 'utf-8');
    return JSON.parse(data) as SearchIndex;
  } catch {
    return { chunks: [], idf: {}, updatedAt: '' };
  }
}

export async function saveIndex(index: SearchIndex): Promise<void> {
  await fs.writeFile(getIndexPath(), JSON.stringify(index), 'utf-8');
}

/**
 * Rebuilds the search index from memory and history files.
 */
export async function rebuildIndex(): Promise<SearchIndex> {
  const memoryDir = path.join(getPilotDir(), 'memory');
  const allChunks: Chunk[] = [];

  // Index MEMORY.md
  try {
    const content = await fs.readFile(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
    allChunks.push(...splitIntoChunks(content, 'MEMORY.md'));
  } catch {}

  // Index project memories
  const projectsDir = path.join(memoryDir, 'projects');
  try {
    const files = await fs.readdir(projectsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(path.join(projectsDir, file), 'utf-8');
      allChunks.push(...splitIntoChunks(content, `projects/${file}`));
    }
  } catch {}

  // Index history
  const historyDir = path.join(memoryDir, 'history');
  try {
    const files = await fs.readdir(historyDir);
    for (const file of files.slice(-30)) { // Last 30 days
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(path.join(historyDir, file), 'utf-8');
      allChunks.push(...splitIntoChunks(content, `history/${file}`));
    }
  } catch {}

  const idf = computeIdf(allChunks);
  const index: SearchIndex = {
    chunks: allChunks,
    idf,
    updatedAt: new Date().toISOString(),
  };

  await saveIndex(index);
  return index;
}

/**
 * Searches the index for chunks relevant to the query.
 * Returns top-k results sorted by similarity.
 */
export async function search(query: string, topK: number = 5): Promise<Array<{ chunk: Chunk; score: number }>> {
  let index = await loadIndex();
  if (index.chunks.length === 0) {
    index = await rebuildIndex();
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const queryVec = tfidfVector(queryTokens, index.idf);

  const results = index.chunks.map((chunk) => {
    const chunkVec = tfidfVector(chunk.tokens, index.idf);
    const score = cosineSimilarity(queryVec, chunkVec);
    return { chunk, score };
  });

  return results
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Formats search results for display or prompt injection.
 */
export function formatSearchResults(results: Array<{ chunk: Chunk; score: number }>): string {
  if (results.length === 0) return '';
  const lines = ['<RELEVANT_MEMORY>'];
  for (const { chunk, score } of results) {
    lines.push(`<memory source="${chunk.source}" relevance="${score.toFixed(2)}">`);
    lines.push(chunk.content);
    lines.push('</memory>');
  }
  lines.push('</RELEVANT_MEMORY>');
  return lines.join('\n');
}
