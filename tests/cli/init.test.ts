import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const testDir = path.join(os.tmpdir(), `pilot-init-test-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

// Mock inquirer
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
    Separator: class { constructor(public text: string) {} },
  },
}));

// Mock keychain
vi.mock('../../src/config/keychain.js', () => ({
  setSecret: vi.fn(),
  getSecret: vi.fn().mockResolvedValue('mock-secret'),
}));

// Mock claude check
vi.mock('../../src/agent/claude.js', () => ({
  checkClaudeCli: vi.fn(),
  checkClaudeCliAuth: vi.fn(),
}));

// Mock github check
vi.mock('../../src/tools/github.js', () => ({
  isGhAuthenticated: vi.fn().mockResolvedValue(false),
}));

// Mock MCP manager
vi.mock('../../src/agent/mcp-manager.js', () => ({
  installMcpServer: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock child_process for Playwright install
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: object, cb: (err: Error | null) => void) => { cb(null); }),
}));

import inquirer from 'inquirer';
import { setSecret } from '../../src/config/keychain.js';
import { checkClaudeCli, checkClaudeCliAuth } from '../../src/agent/claude.js';
import { installMcpServer } from '../../src/agent/mcp-manager.js';

const { runInit } = await import('../../src/cli/init.js');
const { loadConfig } = await import('../../src/config/store.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'history'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'skills'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'logs'), { recursive: true });
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('runInit - CLI mode with Slack', () => {
  it('CLI mode + Slack setup saves config correctly', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false }) // Claude: use CLI
      .mockResolvedValueOnce({ platformChoice: '1' }) // Messenger: Slack
      .mockResolvedValueOnce({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        signingSecret: 'secret123',
        userId: 'U12345',
      })
      .mockResolvedValueOnce({ selectedTools: [] }) // Integration: none selected
      .mockResolvedValueOnce({ install: false }); // Playwright: skip

    await runInit();

    const config = await loadConfig();
    expect(config.claude.mode).toBe('cli');
    expect(config.claude.apiKey).toBeNull();
    expect(config.messenger.platform).toBe('slack');
    expect(config.messenger.slack?.botToken).toBe('mock-secret');
    expect(setSecret).toHaveBeenCalledWith('slack-bot-token', 'xoxb-test');
    expect(setSecret).toHaveBeenCalledWith('slack-app-token', 'xapp-test');
    expect(setSecret).toHaveBeenCalledWith('slack-signing-secret', 'secret123');
  });
});

describe('runInit - API mode with Telegram', () => {
  it('API mode + Telegram setup saves config correctly', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(false);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ retryOrApi: 'api' }) // CLI not found: use API mode
      .mockResolvedValueOnce({ apiKey: 'sk-test-key' }) // API key
      .mockResolvedValueOnce({ platformChoice: '2' }) // Messenger: Telegram
      .mockResolvedValueOnce({
        botToken: '123456:ABC-DEF',
        chatId: '99999',
      })
      .mockResolvedValueOnce({ selectedTools: [] }) // Integration: none
      .mockResolvedValueOnce({ install: false }); // Playwright: skip

    await runInit();

    const config = await loadConfig();
    expect(config.claude.mode).toBe('api');
    expect(config.claude.apiKey).toBe('mock-secret');
    expect(config.messenger.platform).toBe('telegram');
    expect(setSecret).toHaveBeenCalledWith('anthropic-api-key', 'sk-test-key');
    expect(setSecret).toHaveBeenCalledWith('telegram-bot-token', '123456:ABC-DEF');
  });
});

describe('runInit - MCP registration via checkbox selection', () => {
  it('selecting Notion registers MCP server', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test', appToken: 'xapp-test',
        signingSecret: 'secret123', userId: 'U12345',
      })
      .mockResolvedValueOnce({ selectedTools: ['notion'] }) // Select Notion
      .mockResolvedValueOnce({ notionApiKey: 'ntn_test_key_12345' }) // Notion key
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledWith('notion', expect.objectContaining({
      OPENAPI_MCP_HEADERS: expect.stringContaining('ntn_test_key_12345'),
    }), { skipVerify: true });
  });

  it('selecting Linear registers MCP server', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test', appToken: 'xapp-test',
        signingSecret: 'secret123', userId: 'U12345',
      })
      .mockResolvedValueOnce({ selectedTools: ['linear'] }) // Select Linear
      .mockResolvedValueOnce({ linearApiKey: 'lin_api_test123' }) // Linear key
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledWith('linear', {
      LINEAR_API_TOKEN: 'lin_api_test123',
    }, { skipVerify: true });
  });

  it('selecting Figma registers MCP server with PAT', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    // Mock fetch for PAT verification
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test', appToken: 'xapp-test',
        signingSecret: 'secret123', userId: 'U12345',
      })
      .mockResolvedValueOnce({ selectedTools: ['figma'] }) // Select Figma
      .mockResolvedValueOnce({ figmaApiKey: 'figd_test_token' }) // PAT prompt
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledWith('figma', { FIGMA_API_KEY: 'figd_test_token' }, { skipVerify: true });
  });

  it('selecting multiple tools registers all of them', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test', appToken: 'xapp-test',
        signingSecret: 'secret123', userId: 'U12345',
      })
      .mockResolvedValueOnce({ selectedTools: ['notion', 'figma'] }) // Multi-select
      .mockResolvedValueOnce({ notionApiKey: 'ntn_test_key' }) // Notion key
      .mockResolvedValueOnce({ figmaApiKey: 'figd_test_token' }) // Figma PAT
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledTimes(2);
  });

  it('MCP registration failure does not break init', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(installMcpServer).mockRejectedValueOnce(new Error('MCP registration failed'));
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test', appToken: 'xapp-test',
        signingSecret: 'secret123', userId: 'U12345',
      })
      .mockResolvedValueOnce({ selectedTools: ['notion'] })
      .mockResolvedValueOnce({ notionApiKey: 'ntn_test_key_12345' })
      .mockResolvedValueOnce({ install: false });

    await expect(runInit()).resolves.not.toThrow();
  });
});
