import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-user-test-${Date.now()}`);

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

vi.mock('../../src/config/keychain.js', () => ({
  getSecret: vi.fn().mockResolvedValue('mock-secret'),
  setSecret: vi.fn().mockResolvedValue(undefined),
}));

const baseConfig = {
  claude: { mode: 'cli', cliBinary: 'claude', apiKey: null },
  messenger: { platform: 'slack', slack: { botToken: 'x', appToken: 'x', signingSecret: 'x' } },
  safety: { dangerousActionsRequireApproval: true, approvalTimeoutMinutes: 30 },
  security: {
    allowedUsers: { slack: ['U_EXISTING'], telegram: [] },
    dmOnly: true,
    filesystemSandbox: { allowedPaths: ['~'], blockedPaths: [] },
    auditLog: { enabled: true, path: '~/.pilot/logs/audit.jsonl', maskSecrets: true },
  },
};

async function writeConfig(config = baseConfig) {
  const configPath = path.join(testDir, '.pilot', 'config.json');
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

async function readConfig() {
  const configPath = path.join(testDir, '.pilot', 'config.json');
  return JSON.parse(await fs.readFile(configPath, 'utf-8'));
}

const { addUser, removeUser, listUsers } = await import('../../src/cli/user.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('adduser', () => {
  it('adds a new slack user', async () => {
    await writeConfig();
    await addUser('slack', 'U_NEW');
    const config = await readConfig();
    expect(config.security.allowedUsers.slack).toContain('U_NEW');
    expect(config.security.allowedUsers.slack).toContain('U_EXISTING');
  });

  it('does not duplicate an existing user', async () => {
    await writeConfig();
    await addUser('slack', 'U_EXISTING');
    const config = await readConfig();
    expect(config.security.allowedUsers.slack.filter((u: string) => u === 'U_EXISTING')).toHaveLength(1);
  });

  it('adds a telegram user', async () => {
    await writeConfig();
    await addUser('telegram', '123456');
    const config = await readConfig();
    expect(config.security.allowedUsers.telegram).toContain('123456');
  });

  it('rejects invalid platform', async () => {
    await writeConfig();
    await expect(addUser('discord', 'U_NEW')).rejects.toThrow('Invalid platform');
  });
});

describe('removeuser', () => {
  it('removes an existing user', async () => {
    await writeConfig();
    await removeUser('slack', 'U_EXISTING');
    const config = await readConfig();
    expect(config.security.allowedUsers.slack).not.toContain('U_EXISTING');
  });

  it('handles removing non-existent user gracefully', async () => {
    await writeConfig();
    await removeUser('slack', 'U_NOBODY');
    const config = await readConfig();
    expect(config.security.allowedUsers.slack).toEqual(['U_EXISTING']);
  });
});

describe('listusers', () => {
  it('lists users without error', async () => {
    await writeConfig();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listUsers();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Authorized users'));
    spy.mockRestore();
  });
});
