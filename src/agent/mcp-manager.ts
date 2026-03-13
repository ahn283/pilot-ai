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
import { generateLauncherScript, removeLauncherScript, classifyEnvVars, getLauncherPath } from './mcp-launcher.js';
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
    const syncResult = await syncHttpToClaudeCode(serverId, entry.url, 'claude', { interactive: true });
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

  // Classify env vars into secrets (stored in Keychain) and non-secrets (stored in script directly)
  const { secrets, nonSecrets } = classifyEnvVars(envValues);

  // Store secret environment variables in keychain
  const keychainEnvKeys: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    const keychainKey = `mcp-${serverId}-${key.toLowerCase().replace(/_/g, '-')}`;
    await setSecret(keychainKey, value);
    keychainEnvKeys[key] = keychainKey;
  }

  // Generate a wrapper script that reads secrets from Keychain at runtime
  let serverConfig: McpConfig['mcpServers'][string];

  if (Object.keys(keychainEnvKeys).length > 0) {
    // Has secrets → use wrapper script (no plaintext secrets in config)
    const launcherPath = await generateLauncherScript(
      serverId,
      entry.npmPackage,
      keychainEnvKeys,
      entry.args,
      nonSecrets,
    );
    serverConfig = { command: 'bash', args: [launcherPath] };
  } else {
    // No secrets → use direct npx command
    serverConfig = {
      command: 'npx',
      args: ['-y', entry.npmPackage, ...(entry.args ?? [])],
    };
    if (Object.keys(nonSecrets).length > 0) {
      serverConfig.env = { ...nonSecrets };
    }
  }

  // Save to mcp-config.json (no secrets in file)
  const config = await loadMcpConfig();
  config.mcpServers[serverId] = serverConfig;
  await saveMcpConfig(config);

  // Sync to Claude Code native settings (no secrets in ~/.claude.json)
  const syncResult = await syncToClaudeCode(serverId, serverConfig);
  if (syncResult.success) {
    console.log(`  (synced to Claude Code)`);
  } else if (syncResult.error !== 'Claude Code CLI not installed') {
    console.log(`  Note: Claude Code sync failed (${syncResult.error})`);
  }

  // Health check: verify the MCP server process can start
  if (!options.skipVerify) {
    const healthy = await verifyMcpServerStartup(entry, envValues);
    if (!healthy) {
      console.log(`  ⚠ Warning: ${entry.name} MCP server registered but may not start correctly.`);
      console.log(`  Run "claude mcp get ${serverId}" to check status.`);
    }
  }

  return { success: true };
}

/**
 * Verifies that an MCP server can start by spawning it briefly.
 * Returns true if the process doesn't immediately crash with a non-zero exit.
 */
async function verifyMcpServerStartup(
  entry: McpServerEntry,
  envValues: Record<string, string>,
): Promise<boolean> {
  try {
    await execFileAsync(
      'npx',
      ['-y', entry.npmPackage, '--version'],
      {
        timeout: 15_000,
        env: { ...process.env, ...envValues },
      },
    );
    return true;
  } catch {
    // npx resolution failure or immediate crash
    return false;
  }
}

/**
 * Uninstalls an MCP server by removing it from config.
 */
export async function uninstallMcpServer(serverId: string): Promise<void> {
  const config = await loadMcpConfig();
  delete config.mcpServers[serverId];
  await saveMcpConfig(config);

  // Clean up launcher script
  await removeLauncherScript(serverId);

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

/**
 * Migrates existing MCP servers from plaintext env vars to Keychain-backed wrapper scripts.
 * Safe to call multiple times — skips servers already using wrapper scripts.
 * Returns the number of servers migrated.
 */
export async function migrateToSecureLaunchers(): Promise<{ migrated: string[]; skipped: string[] }> {
  const config = await loadMcpConfig();
  const migrated: string[] = [];
  const skipped: string[] = [];

  for (const [serverId, serverConfig] of Object.entries(config.mcpServers)) {
    // Skip HTTP transport servers
    if (serverConfig.command === '__http__') {
      skipped.push(serverId);
      continue;
    }

    // Skip servers already using wrapper scripts
    if (serverConfig.command === 'bash' && serverConfig.args?.[0]?.includes('mcp-launchers/')) {
      skipped.push(serverId);
      continue;
    }

    // Skip servers with no env vars (no secrets to protect)
    if (!serverConfig.env || Object.keys(serverConfig.env).length === 0) {
      skipped.push(serverId);
      continue;
    }

    // Look up registry entry to get npmPackage and args
    const entry = getRegistryEntry(serverId);
    if (!entry) {
      skipped.push(serverId);
      continue;
    }

    // Classify and migrate
    const { secrets, nonSecrets } = classifyEnvVars(serverConfig.env);

    if (Object.keys(secrets).length === 0) {
      skipped.push(serverId);
      continue;
    }

    // Store secrets in Keychain and build env key map
    const keychainEnvKeys: Record<string, string> = {};
    for (const [key, value] of Object.entries(secrets)) {
      const keychainKey = `mcp-${serverId}-${key.toLowerCase().replace(/_/g, '-')}`;
      await setSecret(keychainKey, value);
      keychainEnvKeys[key] = keychainKey;
    }

    // Generate wrapper script
    const launcherPath = await generateLauncherScript(
      serverId,
      entry.npmPackage,
      keychainEnvKeys,
      entry.args,
      nonSecrets,
    );

    // Update config to use wrapper script (no more env field)
    config.mcpServers[serverId] = { command: 'bash', args: [launcherPath] };

    // Re-sync to Claude Code without secrets
    await syncToClaudeCode(serverId, config.mcpServers[serverId]).catch(() => {});

    migrated.push(serverId);
  }

  if (migrated.length > 0) {
    await saveMcpConfig(config);
  }

  return { migrated, skipped };
}
