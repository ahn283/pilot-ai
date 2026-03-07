import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readNote,
  writeNote,
  appendToNote,
  getDailyNote,
  searchNotes,
  listNotes,
} from '../../src/tools/obsidian.js';

const VAULT = '/tmp/pilot-obsidian-test';

beforeEach(async () => {
  await fs.rm(VAULT, { recursive: true, force: true });
  await fs.mkdir(VAULT, { recursive: true });
});

describe('readNote / writeNote', () => {
  it('writes and reads a note', async () => {
    await writeNote(VAULT, 'test.md', '# Hello\nContent');
    const content = await readNote(VAULT, 'test.md');
    expect(content).toBe('# Hello\nContent');
  });

  it('auto-appends .md extension', async () => {
    await writeNote(VAULT, 'test', '# Test');
    const content = await readNote(VAULT, 'test');
    expect(content).toBe('# Test');
  });

  it('creates nested directories', async () => {
    await writeNote(VAULT, 'Projects/api/notes.md', 'content');
    const content = await readNote(VAULT, 'Projects/api/notes.md');
    expect(content).toBe('content');
  });

  it('prevents path traversal', async () => {
    await expect(readNote(VAULT, '../../../etc/passwd')).rejects.toThrow('Path traversal');
  });
});

describe('appendToNote', () => {
  it('appends to existing note', async () => {
    await writeNote(VAULT, 'log.md', 'Line 1');
    await appendToNote(VAULT, 'log.md', 'Line 2');
    const content = await readNote(VAULT, 'log.md');
    expect(content).toBe('Line 1\nLine 2');
  });

  it('creates note if not exists', async () => {
    await appendToNote(VAULT, 'new.md', 'First line');
    const content = await readNote(VAULT, 'new.md');
    expect(content).toBe('First line');
  });
});

describe('getDailyNote', () => {
  it('creates daily note with template', async () => {
    const { path: notePath, content } = await getDailyNote(VAULT);
    expect(notePath).toMatch(/^Daily\/\d{4}-\d{2}-\d{2}\.md$/);
    expect(content).toContain('## Tasks');
  });

  it('returns existing daily note', async () => {
    await writeNote(VAULT, 'Daily/2026-03-07.md', '# Custom');
    const { content } = await getDailyNote(VAULT, new Date(2026, 2, 7));
    expect(content).toBe('# Custom');
  });
});

describe('searchNotes', () => {
  it('finds matching notes', async () => {
    await writeNote(VAULT, 'a.md', 'Meeting with Alice');
    await writeNote(VAULT, 'b.md', 'Shopping list');
    await writeNote(VAULT, 'c.md', 'Meeting agenda');

    const results = await searchNotes(VAULT, 'meeting');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.path).sort()).toEqual(['a.md', 'c.md']);
  });

  it('returns empty for no matches', async () => {
    await writeNote(VAULT, 'a.md', 'nothing here');
    const results = await searchNotes(VAULT, 'xyz');
    expect(results).toHaveLength(0);
  });
});

describe('listNotes', () => {
  it('lists all markdown files', async () => {
    await writeNote(VAULT, 'a.md', 'a');
    await writeNote(VAULT, 'sub/b.md', 'b');
    const notes = await listNotes(VAULT);
    expect(notes).toEqual(['a.md', 'sub/b.md']);
  });

  it('lists notes in subdirectory', async () => {
    await writeNote(VAULT, 'sub/x.md', 'x');
    await writeNote(VAULT, 'other/y.md', 'y');
    const notes = await listNotes(VAULT, 'sub');
    expect(notes).toEqual(['sub/x.md']);
  });
});
