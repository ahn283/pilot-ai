import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock os.homedir to use a temp directory
const testDir = path.join(os.tmpdir(), `pilot-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

const { ensurePilotDir, saveConfig, loadConfig, configExists } = await import(
  '../../src/config/store.js'
);

describe('store', () => {
  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('ensurePilotDir이 디렉토리 구조를 생성한다', async () => {
    await ensurePilotDir();
    const pilotDir = path.join(testDir, '.pilot');
    const stat = await fs.stat(pilotDir);
    expect(stat.isDirectory()).toBe(true);

    const logsDir = await fs.stat(path.join(pilotDir, 'logs'));
    expect(logsDir.isDirectory()).toBe(true);

    const memoryDir = await fs.stat(path.join(pilotDir, 'memory'));
    expect(memoryDir.isDirectory()).toBe(true);

    const historyDir = await fs.stat(path.join(pilotDir, 'memory', 'history'));
    expect(historyDir.isDirectory()).toBe(true);
  });

  it('saveConfig이 파일을 생성한다', async () => {
    const config = {
      claude: { mode: 'cli' as const, cliBinary: 'claude', apiKey: null },
      messenger: { platform: 'slack' as const },
    };
    await saveConfig(config);
    const exists = await configExists();
    expect(exists).toBe(true);
  });

  it('설정 파일이 없으면 configExists가 false를 반환한다', async () => {
    await ensurePilotDir();
    const exists = await configExists();
    expect(exists).toBe(false);
  });
});
