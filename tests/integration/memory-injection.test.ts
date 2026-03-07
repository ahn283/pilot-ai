import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-mem-integ-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const {
  writeUserMemory,
  writeProjectMemory,
  appendHistory,
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

describe('메모리 쓰기/읽기/프롬프트 주입', () => {
  it('사용자 메모리 + 프로젝트 메모리가 컨텍스트에 주입된다', async () => {
    await writeUserMemory('커밋 메시지는 한국어로 작성');
    await writeProjectMemory('api', 'Express + TypeScript, port 3000');

    const context = await buildMemoryContext('api');

    expect(context).toContain('<USER_PREFERENCES>');
    expect(context).toContain('커밋 메시지는 한국어로 작성');
    expect(context).toContain('</USER_PREFERENCES>');
    expect(context).toContain('<PROJECT_CONTEXT project="api">');
    expect(context).toContain('Express + TypeScript, port 3000');
    expect(context).toContain('</PROJECT_CONTEXT>');
  });

  it('히스토리가 컨텍스트에 포함된다', async () => {
    await appendHistory('로그인 버그 수정');
    const context = await buildMemoryContext();
    expect(context).toContain('<RECENT_HISTORY>');
    expect(context).toContain('로그인 버그 수정');
  });

  it('메모리 초기화 후 컨텍스트가 비어있다', async () => {
    await writeUserMemory('데이터');
    await writeProjectMemory('api', '정보');
    await resetMemory();

    const context = await buildMemoryContext('api');
    expect(context).toBe('');
  });
});

describe('프로젝트 인식 & --cwd', () => {
  it('프로젝트 메모리가 프로젝트별로 분리된다', async () => {
    await writeProjectMemory('api', 'Express 서버');
    await writeProjectMemory('frontend', 'Next.js 앱');

    const apiCtx = await buildMemoryContext('api');
    const feCtx = await buildMemoryContext('frontend');

    expect(apiCtx).toContain('Express 서버');
    expect(apiCtx).not.toContain('Next.js 앱');
    expect(feCtx).toContain('Next.js 앱');
    expect(feCtx).not.toContain('Express 서버');
  });
});
