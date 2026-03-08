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

import {
  getInstalledServers,
  detectNeededServers,
  installMcpServer,
  uninstallMcpServer,
  listAvailableServers,
  buildApprovalMessage,
  buildMcpContext,
} from '../../src/agent/mcp-manager.js';
import { setSecret } from '../../src/config/keychain.js';

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

  it('installMcpServer adds server to config', async () => {
    const result = await installMcpServer('figma', {
      FIGMA_PERSONAL_ACCESS_TOKEN: 'figd_test123',
    });
    expect(result.success).toBe(true);
    expect(mockMcpConfig.mcpServers).toHaveProperty('figma');
    expect(setSecret).toHaveBeenCalledWith(
      'mcp-figma-figma-personal-access-token',
      'figd_test123',
    );
  });

  it('installMcpServer returns error for unknown server', async () => {
    const result = await installMcpServer('unknown-server', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown');
  });

  it('uninstallMcpServer removes server from config', async () => {
    mockMcpConfig.mcpServers = { figma: { command: 'npx' } };
    await uninstallMcpServer('figma');
    expect(mockMcpConfig.mcpServers).not.toHaveProperty('figma');
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
});
