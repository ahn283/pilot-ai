import fs from 'node:fs/promises';
import path from 'node:path';
import { getPilotDir } from '../config/store.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

function getMcpConfigPath(): string {
  return path.join(getPilotDir(), 'mcp-config.json');
}

/**
 * Loads the MCP config file, creating it if it doesn't exist.
 */
export async function loadMcpConfig(): Promise<McpConfig> {
  try {
    const data = await fs.readFile(getMcpConfigPath(), 'utf-8');
    return JSON.parse(data) as McpConfig;
  } catch {
    return { mcpServers: {} };
  }
}

/**
 * Saves the MCP config file.
 */
export async function saveMcpConfig(config: McpConfig): Promise<void> {
  await fs.writeFile(getMcpConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Registers the Figma MCP server in the config.
 * Uses @anthropic-ai/figma-mcp or a custom Figma MCP server command.
 */
export async function registerFigmaMcp(personalAccessToken: string): Promise<string> {
  const config = await loadMcpConfig();

  config.mcpServers['figma'] = {
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', '--stdio'],
    env: {
      FIGMA_API_KEY: personalAccessToken,
    },
  };

  await saveMcpConfig(config);
  return getMcpConfigPath();
}

/**
 * Removes the Figma MCP server from the config.
 */
export async function unregisterFigmaMcp(): Promise<void> {
  const config = await loadMcpConfig();
  delete config.mcpServers['figma'];
  await saveMcpConfig(config);
}

/**
 * Returns the MCP config path if any servers are configured, null otherwise.
 */
export async function getMcpConfigPathIfExists(): Promise<string | null> {
  const config = await loadMcpConfig();
  if (Object.keys(config.mcpServers).length === 0) return null;
  return getMcpConfigPath();
}
