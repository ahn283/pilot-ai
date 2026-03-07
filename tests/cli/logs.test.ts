import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-logs-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const { getLogPath } = await import('../../src/cli/logs.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot', 'logs'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('getLogPath', () => {
  it('올바른 로그 경로를 반환한다', () => {
    const logPath = getLogPath();
    expect(logPath).toContain('.pilot');
    expect(logPath).toContain('logs');
    expect(logPath).toContain('agent.log');
  });
});

describe('runLogs', () => {
  it('로그 파일이 없으면 안내 메시지를 출력한다', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runLogs } = await import('../../src/cli/logs.js');
    await runLogs();
    expect(spy).toHaveBeenCalledWith('No log files found.');
    spy.mockRestore();
  });

  it('로그 파일이 있으면 내용을 출력한다', async () => {
    const logPath = getLogPath();
    await fs.writeFile(logPath, 'line1\nline2\nline3');

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runLogs } = await import('../../src/cli/logs.js');
    await runLogs();
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('line1');
    expect(output).toContain('line3');
    spy.mockRestore();
  });
});
