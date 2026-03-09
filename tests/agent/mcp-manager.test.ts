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

  it('installMcpServer adds figma as HTTP transport server', async () => {
    const result = await installMcpServer('figma', {});
    expect(result.success).toBe(true);
    expect(mockMcpConfig.mcpServers).toHaveProperty('figma');
    // Figma uses HTTP transport — saved with __http__ marker
    const figmaConfig = mockMcpConfig.mcpServers['figma'] as { command: string; args: string[] };
    expect(figmaConfig.command).toBe('__http__');
    expect(figmaConfig.args[0]).toContain('figma');
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

  it('installMcpServer registers notion with correct config', async () => {
    const headers = JSON.stringify({ 'Authorization': 'Bearer ntn_test', 'Notion-Version': '2022-06-28' });
    await installMcpServer('notion', { OPENAPI_MCP_HEADERS: headers }, { skipVerify: true });
    const notionConfig = mockMcpConfig.mcpServers['notion'] as { command: string; args: string[]; env: Record<string, string> };
    expect(notionConfig.command).toBe('npx');
    expect(notionConfig.args).toContain('@notionhq/notion-mcp-server');
    expect(notionConfig.env?.OPENAPI_MCP_HEADERS).toBe(headers);
  });

  it('installMcpServer registers linear with correct config', async () => {
    await installMcpServer('linear', { LINEAR_API_TOKEN: 'lin_api_test' }, { skipVerify: true });
    const linearConfig = mockMcpConfig.mcpServers['linear'] as { command: string; args: string[]; env: Record<string, string> };
    expect(linearConfig.command).toBe('npx');
    expect(linearConfig.args).toContain('@tacticlaunch/mcp-linear');
    expect(linearConfig.env?.LINEAR_API_TOKEN).toBe('lin_api_test');
  });

  it('installMcpServer registers google-drive with correct config', async () => {
    await installMcpServer('google-drive', {
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
    }, { skipVerify: true });
    const driveConfig = mockMcpConfig.mcpServers['google-drive'] as { command: string; args: string[]; env: Record<string, string> };
    expect(driveConfig.command).toBe('npx');
    expect(driveConfig.args).toContain('@modelcontextprotocol/server-gdrive');
    expect(driveConfig.env?.GOOGLE_CLIENT_ID).toBe('client-id');
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
