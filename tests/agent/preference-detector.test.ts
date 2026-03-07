import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-pref-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const { detectAndSavePreference } = await import('../../src/agent/preference-detector.js');
const { readUserMemory } = await import('../../src/agent/memory.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'history'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('detectAndSavePreference', () => {
  it('detects "항상" pattern', async () => {
    const result = await detectAndSavePreference('항상 TypeScript로 해줘');
    expect(result).toContain('TypeScript');
    const memory = await readUserMemory();
    expect(memory).toContain('TypeScript');
  });

  it('detects "앞으로" pattern', async () => {
    const result = await detectAndSavePreference('앞으로 커밋 메시지 영어로 해줘');
    expect(result).toBeTruthy();
    const memory = await readUserMemory();
    expect(memory).toContain('커밋 메시지 영어');
  });

  it('detects commit message language preference', async () => {
    const result = await detectAndSavePreference('커밋 메시지는 한국어로');
    expect(result).toBeTruthy();
    const memory = await readUserMemory();
    expect(memory).toContain('한국어');
  });

  it('does not duplicate existing preferences', async () => {
    await detectAndSavePreference('항상 TypeScript로 해줘');
    const result = await detectAndSavePreference('항상 TypeScript로 해줘');
    expect(result).toBeNull();
  });

  it('returns null for normal messages', async () => {
    const result = await detectAndSavePreference('api 프로젝트에서 버그 고쳐줘');
    expect(result).toBeNull();
  });
});
