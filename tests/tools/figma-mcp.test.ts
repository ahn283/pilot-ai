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

describe('saveMcpConfig', () => {
  it('saves and loads config correctly', async () => {
    await saveMcpConfig({ mcpServers: { figma: { command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'], env: { FIGMA_API_KEY: 'figd_test' } } } });
    const config = await loadMcpConfig();
    expect(config.mcpServers['figma']).toBeDefined();
    expect(config.mcpServers['figma'].command).toBe('npx');
  });

  it('preserves existing MCP servers', async () => {
    await saveMcpConfig({ mcpServers: { other: { command: 'other-server' } } });
    const config = await loadMcpConfig();
    config.mcpServers['figma'] = { command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'], env: { FIGMA_API_KEY: 'figd_test' } };
    await saveMcpConfig(config);

    const updated = await loadMcpConfig();
    expect(updated.mcpServers['other']).toBeDefined();
    expect(updated.mcpServers['figma']).toBeDefined();
  });
});

describe('getMcpConfigPathIfExists', () => {
  it('returns null when no servers configured', async () => {
    const result = await getMcpConfigPathIfExists();
    expect(result).toBeNull();
  });

  it('returns path when servers exist', async () => {
    await saveMcpConfig({ mcpServers: { figma: { command: 'npx' } } });
    const result = await getMcpConfigPathIfExists();
    expect(result).toContain('mcp-config.json');
  });
});
