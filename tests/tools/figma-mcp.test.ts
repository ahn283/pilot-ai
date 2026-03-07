import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const testDir = '/tmp/pilot-figma-mcp-test';

vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => testDir,
}));

const {
  loadMcpConfig,
  saveMcpConfig,
  registerFigmaMcp,
  unregisterFigmaMcp,
  getMcpConfigPathIfExists,
} = await import('../../src/tools/figma-mcp.js');

beforeEach(async () => {
  await fs.mkdir(testDir, { recursive: true });
  try { await fs.unlink(path.join(testDir, 'mcp-config.json')); } catch {}
});

describe('loadMcpConfig', () => {
  it('returns empty config when file does not exist', async () => {
    const config = await loadMcpConfig();
    expect(config.mcpServers).toEqual({});
  });

  it('loads existing config', async () => {
    await fs.writeFile(
      path.join(testDir, 'mcp-config.json'),
      JSON.stringify({ mcpServers: { test: { command: 'echo' } } }),
    );
    const config = await loadMcpConfig();
    expect(config.mcpServers['test'].command).toBe('echo');
  });
});

describe('registerFigmaMcp', () => {
  it('registers Figma MCP server with token', async () => {
    const configPath = await registerFigmaMcp('figd_test_token');
    expect(configPath).toContain('mcp-config.json');

    const config = await loadMcpConfig();
    expect(config.mcpServers['figma']).toBeDefined();
    expect(config.mcpServers['figma'].command).toBe('npx');
    expect(config.mcpServers['figma'].args).toContain('@anthropic-ai/figma-mcp');
    expect(config.mcpServers['figma'].env?.FIGMA_PERSONAL_ACCESS_TOKEN).toBe('figd_test_token');
  });

  it('preserves existing MCP servers', async () => {
    await saveMcpConfig({ mcpServers: { other: { command: 'other-server' } } });
    await registerFigmaMcp('figd_token');

    const config = await loadMcpConfig();
    expect(config.mcpServers['other']).toBeDefined();
    expect(config.mcpServers['figma']).toBeDefined();
  });
});

describe('unregisterFigmaMcp', () => {
  it('removes Figma MCP server', async () => {
    await registerFigmaMcp('figd_token');
    await unregisterFigmaMcp();

    const config = await loadMcpConfig();
    expect(config.mcpServers['figma']).toBeUndefined();
  });
});

describe('getMcpConfigPathIfExists', () => {
  it('returns null when no servers configured', async () => {
    const result = await getMcpConfigPathIfExists();
    expect(result).toBeNull();
  });

  it('returns path when servers exist', async () => {
    await registerFigmaMcp('figd_token');
    const result = await getMcpConfigPathIfExists();
    expect(result).toContain('mcp-config.json');
  });
});
