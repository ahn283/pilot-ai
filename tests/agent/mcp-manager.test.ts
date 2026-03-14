import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock figma-mcp (loadMcpConfig / saveMcpConfig)
const mockMcpConfig = { mcpServers: {} as Record<string, unknown> };
vi.mock('../../src/tools/figma-mcp.js', () => ({
  loadMcpConfig: vi.fn().mockImplementation(() => Promise.resolve(structuredClone(mockMcpConfig))),
  saveMcpConfig: vi.fn().mockImplementation((config: typeof mockMcpConfig) => {
    Object.assign(mockMcpConfig, config);
    return Promise.resolve();
  }),
}));

// Mock keychain
vi.mock('../../src/config/keychain.js', () => ({
  setSecret: vi.fn(),
  getSecret: vi.fn().mockResolvedValue('mock-value'),
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: object, cb: (err: Error | null) => void) => { cb(null); }),
}));

// Mock claude-code-sync
vi.mock('../../src/config/claude-code-sync.js', () => ({
  syncToClaudeCode: vi.fn().mockResolvedValue({ success: true }),
  removeFromClaudeCode: vi.fn().mockResolvedValue({ success: true }),
  syncHttpToClaudeCode: vi.fn().mockResolvedValue({ success: true }),
  checkClaudeCodeSync: vi.fn().mockResolvedValue(true),
}));

// Mock mcp-launcher
vi.mock('../../src/agent/mcp-launcher.js', () => ({
  generateLauncherScript: vi.fn().mockResolvedValue('/mock/.pilot/mcp-launchers/test.sh'),
  removeLauncherScript: vi.fn().mockResolvedValue(undefined),
  getLauncherPath: vi.fn().mockReturnValue('/mock/.pilot/mcp-launchers/test.sh'),
  classifyEnvVars: vi.fn().mockImplementation((envValues: Record<string, string>) => {
    const secrets: Record<string, string> = {};
    const nonSecrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(envValues)) {
      if (value.startsWith('/') || value.startsWith('~') ||
          key.toUpperCase().includes('SITE_NAME') ||
          key.toUpperCase().includes('USER_EMAIL') ||
          key.toUpperCase().includes('TEAM_ID')) {
        nonSecrets[key] = value;
      } else {
        secrets[key] = value;
      }
    }
    return { secrets, nonSecrets };
  }),
}));

// Mock node:fs/promises for launcher script reading
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  getInstalledServers,
  detectNeededServers,
  installMcpServer,
  uninstallMcpServer,
  listAvailableServers,
  buildApprovalMessage,
  buildMcpContext,
  migrateToSecureLaunchers,
  checkAllMcpServerStatus,
  getSecretKeysForServer,
  registerSentinelAi,
} from '../../src/agent/mcp-manager.js';
import { setSecret, getSecret } from '../../src/config/keychain.js';
import { generateLauncherScript, removeLauncherScript } from '../../src/agent/mcp-launcher.js';
import fs from 'node:fs/promises';

beforeEach(() => {
  vi.clearAllMocks();
  mockMcpConfig.mcpServers = {};
});

describe('mcp-manager', () => {
  it('getInstalledServers returns empty when no servers', async () => {
    const installed = await getInstalledServers();
    expect(installed).toEqual([]);
  });

  it('getInstalledServers returns installed server IDs', async () => {
    mockMcpConfig.mcpServers = { figma: { command: 'npx' }, github: { command: 'npx' } };
    const installed = await getInstalledServers();
    expect(installed).toContain('figma');
    expect(installed).toContain('github');
  });

  it('detectNeededServers finds uninstalled servers matching keywords', async () => {
    mockMcpConfig.mcpServers = {};
    const needed = await detectNeededServers('Check my Figma design');
    expect(needed.some((s) => s.id === 'figma')).toBe(true);
  });

  it('detectNeededServers excludes already installed servers', async () => {
    mockMcpConfig.mcpServers = { figma: { command: 'npx' } };
    const needed = await detectNeededServers('Check my Figma design');
    expect(needed.some((s) => s.id === 'figma')).toBe(false);
  });

  it('detectNeededServers returns empty for no match', async () => {
    const needed = await detectNeededServers('hello world');
    expect(needed).toHaveLength(0);
  });

  it('installMcpServer with secrets uses wrapper script (no plaintext env)', async () => {
    const result = await installMcpServer('figma', { FIGMA_API_KEY: 'figd_test' }, { skipVerify: true });
    expect(result.success).toBe(true);
    expect(mockMcpConfig.mcpServers).toHaveProperty('figma');
    const figmaConfig = mockMcpConfig.mcpServers['figma'] as { command: string; args: string[]; env?: Record<string, string> };
    // Now uses bash wrapper script instead of npx with plaintext env
    expect(figmaConfig.command).toBe('bash');
    expect(figmaConfig.args).toContain('/mock/.pilot/mcp-launchers/test.sh');
    // No env field — secrets are in Keychain, read by the wrapper script
    expect(figmaConfig.env).toBeUndefined();
    // Secrets should be stored in keychain
    expect(setSecret).toHaveBeenCalledWith('mcp-figma-figma-api-key', 'figd_test');
    // Launcher script should be generated
    expect(generateLauncherScript).toHaveBeenCalled();
  });

  it('installMcpServer returns error for unknown server', async () => {
    const result = await installMcpServer('unknown-server', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown');
  });

  it('installMcpServer with skipVerify skips npx verification', async () => {
    const { execFile } = await import('node:child_process');
    const result = await installMcpServer('notion', {
      OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer ntn_test"}',
    }, { skipVerify: true });
    expect(result.success).toBe(true);
    expect(mockMcpConfig.mcpServers).toHaveProperty('notion');
    // execFile should NOT have been called (skipVerify)
    expect(execFile).not.toHaveBeenCalled();
  });

  it('installMcpServer registers notion with wrapper script', async () => {
    const headers = JSON.stringify({ 'Authorization': 'Bearer ntn_test', 'Notion-Version': '2022-06-28' });
    await installMcpServer('notion', { OPENAPI_MCP_HEADERS: headers }, { skipVerify: true });
    const notionConfig = mockMcpConfig.mcpServers['notion'] as { command: string; args: string[]; env?: Record<string, string> };
    // Secrets → wrapper script
    expect(notionConfig.command).toBe('bash');
    expect(notionConfig.args).toContain('/mock/.pilot/mcp-launchers/test.sh');
    expect(notionConfig.env).toBeUndefined();
  });

  it('installMcpServer registers linear with wrapper script', async () => {
    await installMcpServer('linear', { LINEAR_API_TOKEN: 'lin_api_test' }, { skipVerify: true });
    const linearConfig = mockMcpConfig.mcpServers['linear'] as { command: string; args: string[]; env?: Record<string, string> };
    expect(linearConfig.command).toBe('bash');
    expect(linearConfig.env).toBeUndefined();
  });

  it('installMcpServer registers google-drive with direct npx (path-only env)', async () => {
    await installMcpServer('google-drive', {
      GOOGLE_DRIVE_OAUTH_CREDENTIALS: '/path/to/creds.json',
    }, { skipVerify: true });
    const driveConfig = mockMcpConfig.mcpServers['google-drive'] as { command: string; args: string[]; env?: Record<string, string> };
    // File path is a non-secret → uses direct npx, no wrapper script needed
    expect(driveConfig.command).toBe('npx');
    expect(driveConfig.args).toContain('@piotr-agier/google-drive-mcp');
    expect(driveConfig.env?.GOOGLE_DRIVE_OAUTH_CREDENTIALS).toBe('/path/to/creds.json');
  });

  it('installMcpServer with no env uses direct npx', async () => {
    await installMcpServer('puppeteer', {}, { skipVerify: true });
    const config = mockMcpConfig.mcpServers['puppeteer'] as { command: string; args: string[] };
    expect(config.command).toBe('npx');
    expect(config.args).toContain('@modelcontextprotocol/server-puppeteer');
  });

  it('uninstallMcpServer removes server from config and cleans up launcher', async () => {
    mockMcpConfig.mcpServers = { figma: { command: 'bash', args: ['/mock/.pilot/mcp-launchers/test.sh'] } };
    await uninstallMcpServer('figma');
    expect(mockMcpConfig.mcpServers).not.toHaveProperty('figma');
    expect(removeLauncherScript).toHaveBeenCalledWith('figma');
  });

  it('listAvailableServers shows install status', async () => {
    mockMcpConfig.mcpServers = { figma: { command: 'npx' } };
    const list = await listAvailableServers();
    const figma = list.find((s) => s.id === 'figma');
    const github = list.find((s) => s.id === 'github');
    expect(figma?.installed).toBe(true);
    expect(github?.installed).toBe(false);
  });

  it('buildApprovalMessage includes server info', () => {
    const entry = { id: 'test', name: 'Test Server', description: 'A test', npmPackage: '@test/pkg', keywords: ['test'], category: 'development' as const, envVars: { API_KEY: 'Test API Key' } };
    const msg = buildApprovalMessage(entry);
    expect(msg).toContain('Test Server');
    expect(msg).toContain('@test/pkg');
    expect(msg).toContain('API_KEY');
  });

  it('buildMcpContext includes installed and available info', async () => {
    mockMcpConfig.mcpServers = { figma: { command: 'npx' } };
    const context = await buildMcpContext();
    expect(context).toContain('INSTALLED MCP SERVERS');
    expect(context).toContain('figma');
    expect(context).toContain('AVAILABLE MCP SERVERS');
  });

  it('buildMcpContext shows only available when nothing installed', async () => {
    mockMcpConfig.mcpServers = {};
    const context = await buildMcpContext();
    expect(context).not.toContain('INSTALLED MCP SERVERS');
    expect(context).toContain('AVAILABLE MCP SERVERS');
  });

  describe('migrateToSecureLaunchers', () => {
    it('migrates servers with plaintext env to wrapper scripts', async () => {
      mockMcpConfig.mcpServers = {
        figma: {
          command: 'npx',
          args: ['-y', 'figma-developer-mcp', '--stdio'],
          env: { FIGMA_API_KEY: 'figd_secret' },
        },
      };
      const result = await migrateToSecureLaunchers();
      expect(result.migrated).toContain('figma');
      expect(setSecret).toHaveBeenCalled();
      expect(generateLauncherScript).toHaveBeenCalled();
      const figmaConfig = mockMcpConfig.mcpServers['figma'] as { command: string; args: string[]; env?: unknown };
      expect(figmaConfig.command).toBe('bash');
      expect(figmaConfig.env).toBeUndefined();
    });

    it('skips servers already using wrapper scripts', async () => {
      mockMcpConfig.mcpServers = {
        figma: { command: 'bash', args: ['/mock/mcp-launchers/figma.sh'] },
      };
      const result = await migrateToSecureLaunchers();
      expect(result.skipped).toContain('figma');
      expect(result.migrated).toHaveLength(0);
    });

    it('skips HTTP transport servers', async () => {
      mockMcpConfig.mcpServers = {
        figma: { command: '__http__', args: ['https://example.com'] },
      };
      const result = await migrateToSecureLaunchers();
      expect(result.skipped).toContain('figma');
    });

    it('skips servers with no env vars', async () => {
      mockMcpConfig.mcpServers = {
        puppeteer: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
      };
      const result = await migrateToSecureLaunchers();
      expect(result.skipped).toContain('puppeteer');
    });
  });

  describe('checkAllMcpServerStatus', () => {
    const mockGetSecret = vi.mocked(getSecret);
    const mockReadFile = vi.mocked(fs.readFile);

    it('returns empty array when no servers registered', async () => {
      mockMcpConfig.mcpServers = {};
      const results = await checkAllMcpServerStatus();
      expect(results).toEqual([]);
    });

    it('returns ready for HTTP transport servers', async () => {
      mockMcpConfig.mcpServers = {
        figma: { command: '__http__', args: ['https://example.com'] },
      };
      const results = await checkAllMcpServerStatus();
      expect(results).toHaveLength(1);
      expect(results[0].serverId).toBe('figma');
      expect(results[0].status).toBe('ready');
    });

    it('returns ready when all Keychain credentials exist for launcher server', async () => {
      mockMcpConfig.mcpServers = {
        slack: { command: 'bash', args: ['/home/.pilot/mcp-launchers/slack.sh'] },
      };
      mockReadFile.mockResolvedValueOnce(
        'export SLACK_BOT_TOKEN=$(security find-generic-password -s "pilot-ai:mcp-slack-slack-bot-token" -a "pilot-ai" -w 2>/dev/null)\n'
      );
      mockGetSecret.mockResolvedValueOnce('xoxb-test-token');

      const results = await checkAllMcpServerStatus();
      expect(results).toHaveLength(1);
      expect(results[0].serverId).toBe('slack');
      expect(results[0].status).toBe('ready');
    });

    it('returns auth_required when Keychain credential is missing', async () => {
      mockMcpConfig.mcpServers = {
        notion: { command: 'bash', args: ['/home/.pilot/mcp-launchers/notion.sh'] },
      };
      mockReadFile.mockResolvedValueOnce(
        'export OPENAPI_MCP_HEADERS=$(security find-generic-password -s "pilot-ai:mcp-notion-openapi-mcp-headers" -a "pilot-ai" -w 2>/dev/null)\n'
      );
      mockGetSecret.mockResolvedValueOnce(null);

      const results = await checkAllMcpServerStatus();
      expect(results).toHaveLength(1);
      expect(results[0].serverId).toBe('notion');
      expect(results[0].status).toBe('auth_required');
      expect(results[0].message).toContain('mcp-notion-openapi-mcp-headers');
    });

    it('returns ready for legacy direct config servers', async () => {
      mockMcpConfig.mcpServers = {
        memory: { command: 'npx', args: ['-y', '@some/memory-server'] },
      };
      const results = await checkAllMcpServerStatus();
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('ready');
    });
  });

  describe('registerSentinelAi', () => {
    it('registers sentinel-qa in npx mode', async () => {
      const result = await registerSentinelAi({ mode: 'npx' });
      expect(result.success).toBe(true);
      const config = mockMcpConfig.mcpServers['sentinel-qa'] as { command: string; args: string[]; env?: Record<string, string> };
      expect(config.command).toBe('npx');
      expect(config.args).toEqual(['-y', 'sentinel-qa']);
      expect(config.env).toBeUndefined();
    });

    it('registers sentinel-qa in local build mode', async () => {
      const localPath = '/Users/test/sentinel-qa/packages/mcp-server/dist/index.js';
      const result = await registerSentinelAi({ mode: 'local', localPath });
      expect(result.success).toBe(true);
      const config = mockMcpConfig.mcpServers['sentinel-qa'] as { command: string; args: string[] };
      expect(config.command).toBe('node');
      expect(config.args).toEqual([localPath]);
    });

    it('registers sentinel-qa with environment variables', async () => {
      const result = await registerSentinelAi({
        mode: 'npx',
        env: { SENTINEL_REPORTS_DIR: '/tmp/reports' },
      });
      expect(result.success).toBe(true);
      const config = mockMcpConfig.mcpServers['sentinel-qa'] as { command: string; args: string[]; env?: Record<string, string> };
      expect(config.env).toEqual({ SENTINEL_REPORTS_DIR: '/tmp/reports' });
    });

    it('does not set env field when env is empty', async () => {
      const result = await registerSentinelAi({ mode: 'npx', env: {} });
      expect(result.success).toBe(true);
      const config = mockMcpConfig.mcpServers['sentinel-qa'] as { command: string; env?: Record<string, string> };
      expect(config.env).toBeUndefined();
    });
  });

  describe('getSecretKeysForServer', () => {
    const mockReadFile = vi.mocked(fs.readFile);

    it('extracts keychain keys from launcher script', async () => {
      mockReadFile.mockResolvedValueOnce(
        '#!/bin/bash\n' +
        'export SLACK_TEAM_ID="T123"\n' +
        'export SLACK_BOT_TOKEN=$(security find-generic-password -s "pilot-ai:mcp-slack-slack-bot-token" -a "pilot-ai" -w 2>/dev/null)\n'
      );
      const keys = await getSecretKeysForServer('/path/to/slack.sh');
      expect(keys).toEqual(['mcp-slack-slack-bot-token']);
    });

    it('returns empty array when script has no secrets', async () => {
      mockReadFile.mockResolvedValueOnce('#!/bin/bash\nexec npx -y some-server\n');
      const keys = await getSecretKeysForServer('/path/to/server.sh');
      expect(keys).toEqual([]);
    });

    it('returns empty array when file does not exist', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const keys = await getSecretKeysForServer('/nonexistent.sh');
      expect(keys).toEqual([]);
    });

    it('extracts multiple keychain keys', async () => {
      mockReadFile.mockResolvedValueOnce(
        'export KEY1=$(security find-generic-password -s "pilot-ai:mcp-jira-user-email" -a "pilot-ai" -w 2>/dev/null)\n' +
        'export KEY2=$(security find-generic-password -s "pilot-ai:mcp-jira-api-token" -a "pilot-ai" -w 2>/dev/null)\n'
      );
      const keys = await getSecretKeysForServer('/path/to/jira.sh');
      expect(keys).toEqual(['mcp-jira-user-email', 'mcp-jira-api-token']);
    });
  });
});
