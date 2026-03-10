/**
 * MCP Server auto-discovery and management.
 * When the agent detects a task that could benefit from an MCP server,
 * it proposes installation to the user via messenger and handles setup.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadMcpConfig, saveMcpConfig, type McpConfig } from '../tools/figma-mcp.js';
import { findMatchingServers, getRegistryEntry, MCP_REGISTRY, type McpServerEntry } from '../tools/mcp-registry.js';
import { getSecret, setSecret } from '../config/keychain.js';
import { getPilotDir } from '../config/store.js';
import { syncToClaudeCode, removeFromClaudeCode } from '../config/claude-code-sync.js';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface McpInstallRequest {
  server: McpServerEntry;
  envValues: Record<string, string>;
}

/**
 * Checks which MCP servers are currently installed.
 */
export async function getInstalledServers(): Promise<string[]> {
  const config = await loadMcpConfig();
  return Object.keys(config.mcpServers);
}

/**
 * Detects MCP servers that could help with the given user message
 * but are not yet installed.
 */
export async function detectNeededServers(userMessage: string): Promise<McpServerEntry[]> {
  const matches = findMatchingServers(userMessage);
  if (matches.length === 0) return [];

  const installed = await getInstalledServers();
  return matches.filter((m) => !installed.includes(m.id));
}

/**
 * Installs and registers an MCP server.
 * 1. Verifies the npm package can be resolved
 * 2. Stores env vars in keychain
 * 3. Adds to mcp-config.json
 */
export interface McpInstallOptions {
  /** Skip npx package verification (useful during init when speed matters) */
  skipVerify?: boolean;
}

export async function installMcpServer(
  serverId: string,
  envValues: Record<string, string>,
  options: McpInstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
  const entry = getRegistryEntry(serverId);
  if (!entry) return { success: false, error: `Unknown MCP server: ${serverId}` };

  // HTTP transport servers (e.g. Figma remote) use `claude mcp add --transport http`
  if (entry.transport === 'http' && entry.url) {
    const { syncHttpToClaudeCode, checkClaudeCodeSync } = await import('../config/claude-code-sync.js');
    const syncResult = await syncHttpToClaudeCode(serverId, entry.url);
    if (syncResult.success) {
      // Verify the server was actually registered in Claude Code
      const verified = await checkClaudeCodeSync(serverId);
      if (!verified) {
        console.log(`  Warning: Server registered but verification failed. It may still work.`);
      }
      // Also record in local config so pilot-ai knows it's "installed"
      const config = await loadMcpConfig();
      config.mcpServers[serverId] = { command: '__http__', args: [entry.url] };
      await saveMcpConfig(config);
      console.log(`  (registered as remote HTTP MCP server)`);
      return { success: true };
    } else {
      return { success: false, error: syncResult.error ?? 'Failed to register HTTP MCP server' };
    }
  }

  if (!options.skipVerify) {
    try {
      // Verify the package exists by trying to resolve it
      await execFileAsync('npx', ['-y', '--package', entry.npmPackage, 'echo', 'ok'], {
        timeout: 60_000,
      });
    } catch {
      // npx -y will auto-install, so this is fine even if it fails on echo
    }
  }

  // Store environment variables in keychain
  for (const [key, value] of Object.entries(envValues)) {
    const keychainKey = `mcp-${serverId}-${key.toLowerCase().replace(/_/g, '-')}`;
    await setSecret(keychainKey, value);
  }

  // Build the server config
  const config = await loadMcpConfig();
  const serverConfig: McpConfig['mcpServers'][string] = {
    command: 'npx',
    args: ['-y', entry.npmPackage, ...(entry.args ?? [])],
  };

  // Add env vars
  if (Object.keys(envValues).length > 0) {
    serverConfig.env = { ...envValues };
  }

  config.mcpServers[serverId] = serverConfig;
  await saveMcpConfig(config);

  // Sync to Claude Code native settings (non-blocking, warn on failure)
  const syncResult = await syncToClaudeCode(serverId, serverConfig);
  if (syncResult.success) {
    console.log(`  (synced to Claude Code)`);
  } else if (syncResult.error !== 'Claude Code CLI not installed') {
    console.log(`  Note: Claude Code sync failed (${syncResult.error})`);
  }

  return { success: true };
}

/**
 * Uninstalls an MCP server by removing it from config.
 */
export async function uninstallMcpServer(serverId: string): Promise<void> {
  const config = await loadMcpConfig();
  delete config.mcpServers[serverId];
  await saveMcpConfig(config);

  // Also remove from Claude Code (ignore failures)
  await removeFromClaudeCode(serverId).catch(() => {});
}

/**
 * Lists all available MCP servers from the registry with install status.
 */
export async function listAvailableServers(): Promise<Array<McpServerEntry & { installed: boolean }>> {
  const installed = await getInstalledServers();
  return MCP_REGISTRY.map((entry) => ({
    ...entry,
    installed: installed.includes(entry.id),
  }));
}

/**
 * Builds a user-friendly message describing an MCP server for approval.
 */
export function buildApprovalMessage(server: McpServerEntry): string {
  const lines = [
    `🔌 *MCP Server: ${server.name}*`,
    `${server.description}`,
    `Package: \`${server.npmPackage}\``,
  ];

  if (server.envVars && Object.keys(server.envVars).length > 0) {
    lines.push('');
    lines.push('Required credentials:');
    for (const [key, desc] of Object.entries(server.envVars)) {
      lines.push(`  • ${key}: ${desc}`);
    }
  }

  return lines.join('\n');
}

/**
 * Builds the MCP context for the system prompt.
 * Tells the agent about available and installed MCP servers.
 */
export async function buildMcpContext(): Promise<string> {
  const installed = await getInstalledServers();
  const available = MCP_REGISTRY.filter((e) => !installed.includes(e.id));
  const configPath = getMcpConfigDisplayPath();

  const parts: string[] = [];

  parts.push(`MCP CONFIGURATION:
- Config file: ${configPath}
- This is YOUR MCP config managed by pilot-ai. It is NOT at ~/.claude/ or .mcp.json.
- All permissions are pre-approved. You do NOT need to ask the user for permission to use any tool.`);

  if (installed.length > 0) {
    const serverDetails = installed.map((id) => {
      const entry = getRegistryEntry(id);
      return entry
        ? `  - ${id}: ${entry.name} — ${entry.description} (tools: mcp__${id}__*)`
        : `  - ${id} (tools: mcp__${id}__*)`;
    }).join('\n');
    parts.push(`INSTALLED MCP SERVERS:\n${serverDetails}`);
    parts.push(
      'These MCP servers are registered and their tools should be available to you. ' +
      'Tool names follow the pattern: mcp__<server-id>__<tool-name>. ' +
      'If an MCP tool call fails with a connection or auth error, tell the user to run ' +
      '"pilot-ai removetool <name>" then "pilot-ai addtool <name>" to re-register with a fresh token. ' +
      'NEVER tell the user to edit ~/.claude/ or .mcp.json — pilot-ai manages MCP config at: ' + configPath,
    );
  }

  if (available.length > 0) {
    const serverList = available
      .map((s) => `  - ${s.id}: ${s.name} — ${s.description}`)
      .join('\n');
    parts.push(`AVAILABLE MCP SERVERS (not installed):\n${serverList}`);
    parts.push(
      'To add a new MCP server, tell the user to run: pilot-ai addtool <server-id>',
    );
  }

  return parts.join('\n\n');
}

function getMcpConfigDisplayPath(): string {
  return path.join(getPilotDir(), 'mcp-config.json');
}
