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
  it('CLI 모드 + Slack 설정을 저장한다', async () => {
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
      .mockResolvedValueOnce({ setupGh: false }) // GitHub: skip
      .mockResolvedValueOnce({ setupNotion: false })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: false })
      .mockResolvedValueOnce({ setupGoogle: false })
      .mockResolvedValueOnce({ setupLinear: false })
      .mockResolvedValueOnce({ install: false });

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
  it('API 모드 + Telegram 설정을 저장한다', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(false);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ apiKey: 'sk-test-key' }) // API key (no CLI)
      .mockResolvedValueOnce({ platformChoice: '2' }) // Messenger: Telegram
      .mockResolvedValueOnce({
        botToken: '123456:ABC-DEF',
        chatId: '99999',
      })
      .mockResolvedValueOnce({ setupGh: false }) // GitHub: skip
      .mockResolvedValueOnce({ setupNotion: false })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: false })
      .mockResolvedValueOnce({ setupGoogle: false })
      .mockResolvedValueOnce({ setupLinear: false })
      .mockResolvedValueOnce({ install: false });

    await runInit();

    const config = await loadConfig();
    expect(config.claude.mode).toBe('api');
    expect(config.claude.apiKey).toBe('mock-secret');
    expect(config.messenger.platform).toBe('telegram');
    expect(config.messenger.telegram?.botToken).toBe('mock-secret');
    expect(setSecret).toHaveBeenCalledWith('anthropic-api-key', 'sk-test-key');
    expect(setSecret).toHaveBeenCalledWith('telegram-bot-token', '123456:ABC-DEF');
  });
});

describe('runInit - CLI exists but choose API', () => {
  it('CLI 있어도 API 모드를 선택할 수 있다', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: true }) // Choose API despite CLI
      .mockResolvedValueOnce({ apiKey: 'sk-my-key' }) // Enter API key
      .mockResolvedValueOnce({ platformChoice: '2' })
      .mockResolvedValueOnce({
        botToken: '111:TOKEN',
        chatId: '12345',
      })
      .mockResolvedValueOnce({ setupGh: false }) // GitHub: skip
      .mockResolvedValueOnce({ setupNotion: false })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: false })
      .mockResolvedValueOnce({ setupGoogle: false })
      .mockResolvedValueOnce({ setupLinear: false })
      .mockResolvedValueOnce({ install: false });

    await runInit();

    const config = await loadConfig();
    expect(config.claude.mode).toBe('api');
    expect(setSecret).toHaveBeenCalledWith('anthropic-api-key', 'sk-my-key');
  });
});

describe('runInit - MCP registration during init', () => {
  it('Notion setup registers MCP server', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        signingSecret: 'secret123',
        userId: 'U12345',
      })
      .mockResolvedValueOnce({ setupGh: false })
      .mockResolvedValueOnce({ setupNotion: true })
      .mockResolvedValueOnce({ notionApiKey: 'ntn_test_key_12345' })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: false })
      .mockResolvedValueOnce({ setupGoogle: false })
      .mockResolvedValueOnce({ setupLinear: false })
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledWith('notion', expect.objectContaining({
      OPENAPI_MCP_HEADERS: expect.stringContaining('ntn_test_key_12345'),
    }), { skipVerify: true });
  });

  it('Linear setup registers MCP server', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        signingSecret: 'secret123',
        userId: 'U12345',
      })
      .mockResolvedValueOnce({ setupGh: false })
      .mockResolvedValueOnce({ setupNotion: false })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: false })
      .mockResolvedValueOnce({ setupGoogle: false })
      .mockResolvedValueOnce({ setupLinear: true })
      .mockResolvedValueOnce({ linearApiKey: 'lin_api_test123' })
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledWith('linear', {
      LINEAR_API_KEY: 'lin_api_test123',
    }, { skipVerify: true });
  });

  it('Figma setup registers MCP server via installMcpServer', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        signingSecret: 'secret123',
        userId: 'U12345',
      })
      .mockResolvedValueOnce({ setupGh: false })
      .mockResolvedValueOnce({ setupNotion: false })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: true })
      .mockResolvedValueOnce({ figmaToken: 'figd_test_token' })
      .mockResolvedValueOnce({ setupGoogle: false })
      .mockResolvedValueOnce({ setupLinear: false })
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledWith('figma', {
      FIGMA_PERSONAL_ACCESS_TOKEN: 'figd_test_token',
    }, { skipVerify: true });
  });

  it('Google Drive setup registers MCP server when drive is selected', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        signingSecret: 'secret123',
        userId: 'U12345',
      })
      .mockResolvedValueOnce({ setupGh: false })
      .mockResolvedValueOnce({ setupNotion: false })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: false })
      .mockResolvedValueOnce({ setupGoogle: true })
      .mockResolvedValueOnce({ clientId: 'google-client-id', clientSecret: 'google-secret' })
      .mockResolvedValueOnce({ googleServices: ['gmail', 'drive'] })
      .mockResolvedValueOnce({ setupLinear: false })
      .mockResolvedValueOnce({ install: false });

    await runInit();

    expect(installMcpServer).toHaveBeenCalledWith('google-drive', {
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    }, { skipVerify: true });
  });

  it('MCP registration failure does not break init', async () => {
    vi.mocked(checkClaudeCli).mockResolvedValue(true);
    vi.mocked(checkClaudeCliAuth).mockResolvedValue(true);
    vi.mocked(installMcpServer).mockRejectedValueOnce(new Error('MCP registration failed'));
    vi.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ useApi: false })
      .mockResolvedValueOnce({ platformChoice: '1' })
      .mockResolvedValueOnce({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        signingSecret: 'secret123',
        userId: 'U12345',
      })
      .mockResolvedValueOnce({ setupGh: false })
      .mockResolvedValueOnce({ setupNotion: true })
      .mockResolvedValueOnce({ notionApiKey: 'ntn_test_key_12345' })
      .mockResolvedValueOnce({ setupObsidian: false })
      .mockResolvedValueOnce({ setupFigma: false })
      .mockResolvedValueOnce({ setupGoogle: false })
      .mockResolvedValueOnce({ setupLinear: false })
      .mockResolvedValueOnce({ install: false });

    // Should not throw even if MCP registration fails
    await expect(runInit()).resolves.not.toThrow();
  });
});
