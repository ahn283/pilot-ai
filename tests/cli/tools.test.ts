import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MCP manager
const mockInstalledServers: string[] = [];
vi.mock('../../src/agent/mcp-manager.js', () => ({
  getInstalledServers: vi.fn().mockImplementation(() => Promise.resolve([...mockInstalledServers])),
  installMcpServer: vi.fn().mockResolvedValue({ success: true }),
  uninstallMcpServer: vi.fn().mockImplementation(async (id: string) => {
    const idx = mockInstalledServers.indexOf(id);
    if (idx >= 0) mockInstalledServers.splice(idx, 1);
  }),
}));

// Mock config
vi.mock('../../src/config/store.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    claude: { mode: 'cli', cliBinary: 'claude', apiKey: null },
    messenger: { platform: 'slack' },
    github: { enabled: true },
    obsidian: { vaultPath: '/test/vault' },
    safety: { dangerousActionsRequireApproval: true, approvalTimeoutMinutes: 30 },
    security: { allowedUsers: { slack: [], telegram: [] }, dmOnly: true, autoApprovePermissions: true, filesystemSandbox: { allowedPaths: ['~'], blockedPaths: [] }, auditLog: { enabled: true, path: '', maskSecrets: true } },
    agent: { showThinking: true },
  }),
  saveConfig: vi.fn(),
  ensurePilotDir: vi.fn(),
  getPilotDir: vi.fn().mockReturnValue('/tmp/pilot-test'),
}));

// Mock keychain
vi.mock('../../src/config/keychain.js', () => ({
  setSecret: vi.fn(),
  getSecret: vi.fn().mockResolvedValue('mock-secret'),
}));

// Mock github
vi.mock('../../src/tools/github.js', () => ({
  isGhAuthenticated: vi.fn().mockResolvedValue(true),
}));

// Mock inquirer
vi.mock('inquirer', () => ({
  default: { prompt: vi.fn() },
}));

import { runTools, runAddTool, runRemoveTool } from '../../src/cli/tools.js';
import { installMcpServer, uninstallMcpServer } from '../../src/agent/mcp-manager.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockInstalledServers.length = 0;
});

describe('runTools', () => {
  it('lists all tools without error', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runTools();
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Tool');
    expect(output).toContain('Figma');
    expect(output).toContain('Notion');
    expect(output).toContain('GitHub');
    consoleSpy.mockRestore();
  });

  it('shows active status for installed MCP servers', async () => {
    mockInstalledServers.push('figma', 'notion');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runTools();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('active');
    consoleSpy.mockRestore();
  });
});

describe('runAddTool', () => {
  it('rejects unknown tool name', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAddTool('nonexistent');
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Unknown tool');
    consoleSpy.mockRestore();
  });

  it('skips already installed tool', async () => {
    mockInstalledServers.push('figma');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAddTool('figma');
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('already active');
    expect(installMcpServer).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('runRemoveTool', () => {
  it('removes installed MCP server', async () => {
    mockInstalledServers.push('notion');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runRemoveTool('notion');
    expect(uninstallMcpServer).toHaveBeenCalledWith('notion');
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('removed');
    consoleSpy.mockRestore();
  });

  it('reports when tool is not active', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runRemoveTool('linear');
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('not currently active');
    consoleSpy.mockRestore();
  });
});
