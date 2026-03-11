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

import {
  getInstalledServers,
  detectNeededServers,
  installMcpServer,
  uninstallMcpServer,
  listAvailableServers,
  buildApprovalMessage,
  buildMcpContext,
  migrateToSecureLaunchers,
} from '../../src/agent/mcp-manager.js';
import { setSecret } from '../../src/config/keychain.js';
import { generateLauncherScript, removeLauncherScript } from '../../src/agent/mcp-launcher.js';

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
});
