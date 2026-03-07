import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-memcmd-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const { handleMemoryCommand } = await import('../../src/agent/memory-commands.js');
const { writeUserMemory, readUserMemory, writeProjectMemory } = await import('../../src/agent/memory.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'history'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('handleMemoryCommand', () => {
  it('shows user memory', async () => {
    await writeUserMemory('- commit in Korean');
    const result = await handleMemoryCommand('내 메모리 보여줘');
    expect(result.handled).toBe(true);
    expect(result.response).toContain('commit in Korean');
  });

  it('shows empty memory message', async () => {
    const result = await handleMemoryCommand('내 메모리');
    expect(result.handled).toBe(true);
    expect(result.response).toContain('No saved memory');
  });

  it('shows project memory', async () => {
    await writeProjectMemory('api', 'Express + TS');
    const result = await handleMemoryCommand('api 프로젝트 메모리 보여');
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Express + TS');
  });

  it('shows missing project memory', async () => {
    const result = await handleMemoryCommand('unknown 프로젝트 메모리');
    expect(result.handled).toBe(true);
    expect(result.response).toContain('No memory found');
  });

  it('adds to memory', async () => {
    const result = await handleMemoryCommand('메모리 추가: PR은 항상 draft로');
    expect(result.handled).toBe(true);
    expect(result.response).toContain('PR은 항상 draft로');
    const memory = await readUserMemory();
    expect(memory).toContain('PR은 항상 draft로');
  });

  it('updates memory', async () => {
    await writeUserMemory('old content');
    const result = await handleMemoryCommand('메모리 업데이트: new content');
    expect(result.handled).toBe(true);
    const memory = await readUserMemory();
    expect(memory).toBe('new content');
  });

  it('resets memory', async () => {
    await writeUserMemory('data');
    const result = await handleMemoryCommand('메모리 초기화');
    expect(result.handled).toBe(true);
    expect(result.response).toContain('reset');
    const memory = await readUserMemory();
    expect(memory).toBe('');
  });

  it('does not handle normal messages', async () => {
    const result = await handleMemoryCommand('api 프로젝트에서 버그 고쳐줘');
    expect(result.handled).toBe(false);
  });

  it('handles English commands', async () => {
    await writeUserMemory('some pref');
    const result = await handleMemoryCommand('show memory');
    expect(result.handled).toBe(true);
    expect(result.response).toContain('some pref');
  });
});
