import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-memory-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const {
  readUserMemory,
  writeUserMemory,
  appendUserMemory,
  readProjectMemory,
  writeProjectMemory,
  appendHistory,
  readHistory,
  buildMemoryContext,
  resetMemory,
} = await import('../../src/agent/memory.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'history'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('user memory', () => {
  it('MEMORY.md를 쓰고 읽을 수 있다', async () => {
    await writeUserMemory('커밋 메시지는 한국어로');
    const content = await readUserMemory();
    expect(content).toBe('커밋 메시지는 한국어로');
  });

  it('빈 메모리는 빈 문자열을 반환한다', async () => {
    const content = await readUserMemory();
    expect(content).toBe('');
  });

  it('메모리에 항목을 추가할 수 있다', async () => {
    await writeUserMemory('규칙 1');
    await appendUserMemory('규칙 2');
    const content = await readUserMemory();
    expect(content).toContain('규칙 1');
    expect(content).toContain('규칙 2');
  });

  it('200줄 제한을 적용한다', async () => {
    const longContent = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n');
    await writeUserMemory(longContent);
    const content = await readUserMemory();
    const lines = content.split('\n');
    expect(lines.length).toBeLessThanOrEqual(200);
  });
});

describe('project memory', () => {
  it('프로젝트 메모리를 쓰고 읽을 수 있다', async () => {
    await writeProjectMemory('api', 'Express + TS, 포트 3000');
    const content = await readProjectMemory('api');
    expect(content).toBe('Express + TS, 포트 3000');
  });

  it('없는 프로젝트 메모리는 빈 문자열', async () => {
    const content = await readProjectMemory('nonexistent');
    expect(content).toBe('');
  });
});

describe('history', () => {
  it('히스토리를 추가하고 읽을 수 있다', async () => {
    await appendHistory('api 로그인 버그 수정');
    const content = await readHistory();
    expect(content).toContain('api 로그인 버그 수정');
  });
});

describe('buildMemoryContext', () => {
  it('메모리 컨텍스트를 조립한다', async () => {
    await writeUserMemory('PR은 항상 draft');
    await writeProjectMemory('api', 'Express 서버');

    const context = await buildMemoryContext('api');
    expect(context).toContain('USER_PREFERENCES');
    expect(context).toContain('PR은 항상 draft');
    expect(context).toContain('PROJECT_CONTEXT');
    expect(context).toContain('Express 서버');
  });

  it('프로젝트 없이도 동작한다', async () => {
    await writeUserMemory('테스트 선호');
    const context = await buildMemoryContext();
    expect(context).toContain('USER_PREFERENCES');
    expect(context).not.toContain('PROJECT_CONTEXT');
  });
});

describe('resetMemory', () => {
  it('메모리를 초기화한다', async () => {
    await writeUserMemory('데이터');
    await writeProjectMemory('api', '정보');
    await resetMemory();
    expect(await readUserMemory()).toBe('');
    expect(await readProjectMemory('api')).toBe('');
  });
});
