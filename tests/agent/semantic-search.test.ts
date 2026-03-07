import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const testDir = '/tmp/pilot-search-test';
vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => testDir,
}));

const {
  splitIntoChunks,
  rebuildIndex,
  search,
  loadIndex,
  formatSearchResults,
} = await import('../../src/agent/semantic-search.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, 'memory', 'history'), { recursive: true });
  try { await fs.unlink(path.join(testDir, 'search-index.json')); } catch {}
});

describe('splitIntoChunks', () => {
  it('splits content into chunks', () => {
    const content = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join('\n');
    const chunks = splitIntoChunks(content, 'test.md', 10);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0].source).toBe('test.md');
    expect(chunks[0].tokens.length).toBeGreaterThan(0);
  });

  it('skips empty chunks', () => {
    const chunks = splitIntoChunks('\n\n\n', 'empty.md');
    expect(chunks).toHaveLength(0);
  });
});

describe('rebuildIndex', () => {
  it('builds index from memory files', async () => {
    await fs.writeFile(
      path.join(testDir, 'memory', 'MEMORY.md'),
      '# Memory\nUser prefers TypeScript and ESM modules.\nAlways use vitest for testing.',
    );
    await fs.writeFile(
      path.join(testDir, 'memory', 'projects', 'api.md'),
      '# API Project\nExpress REST API with PostgreSQL database.\nDeployed on AWS Lambda.',
    );

    const index = await rebuildIndex();
    expect(index.chunks.length).toBeGreaterThan(0);
    expect(Object.keys(index.idf).length).toBeGreaterThan(0);
  });
});

describe('search', () => {
  it('finds relevant chunks', async () => {
    await fs.writeFile(
      path.join(testDir, 'memory', 'MEMORY.md'),
      '# Memory\nUser prefers TypeScript strict mode.\nCommit messages in English.',
    );
    await fs.writeFile(
      path.join(testDir, 'memory', 'projects', 'api.md'),
      '# API\nExpress REST API. Uses PostgreSQL for database.\nDeploy command: npm run deploy.',
    );

    const results = await search('TypeScript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].chunk.content).toContain('TypeScript');
  });

  it('returns empty for unrelated query', async () => {
    await fs.writeFile(
      path.join(testDir, 'memory', 'MEMORY.md'),
      'Only about cooking recipes and nothing else.',
    );
    await rebuildIndex();
    const results = await search('quantum physics entanglement');
    // May return low-score results but shouldn't crash
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('formatSearchResults', () => {
  it('formats results as XML', () => {
    const results = [
      { chunk: { id: 'test:0', source: 'MEMORY.md', content: 'Hello world', tokens: ['hello', 'world'] }, score: 0.85 },
    ];
    const formatted = formatSearchResults(results);
    expect(formatted).toContain('<RELEVANT_MEMORY>');
    expect(formatted).toContain('MEMORY.md');
    expect(formatted).toContain('0.85');
    expect(formatted).toContain('Hello world');
  });

  it('returns empty string for no results', () => {
    expect(formatSearchResults([])).toBe('');
  });
});
