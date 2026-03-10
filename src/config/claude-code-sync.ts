/**
 * Syncs MCP server configurations to Claude Code's native settings.
 *
 * Uses `claude mcp add-json -s user` CLI command to register servers
 * in Claude Code's user scope (~/.claude.json top-level mcpServers),
 * making them available across all projects.
 *
 * Why add-json instead of add:
 * - `claude mcp add`'s `-e` flag is variadic and can consume the server name
 * - add-json handles JSON env values (e.g. Notion OPENAPI_MCP_HEADERS) safely
 * - Matches pilot-ai's mcp-config.json structure → minimal conversion
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { checkClaudeCli } from '../agent/claude.js';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 30_000;

export interface McpServerConfigForSync {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Register an MCP server in Claude Code with user scope.
 * Runs: claude mcp add-json -s user <name> '<json>'
 */
export async function syncToClaudeCode(
  serverId: string,
  serverConfig: McpServerConfigForSync,
): Promise<{ success: boolean; error?: string }> {
  const cliExists = await checkClaudeCli();
  if (!cliExists) {
    return { success: false, error: 'Claude Code CLI not installed' };
  }

  try {
    // Remove existing server first (handles updates)
    await execFileAsync('claude', ['mcp', 'remove', '-s', 'user', serverId], {
      timeout: TIMEOUT_MS,
    }).catch(() => {}); // Ignore if not found

    const jsonConfig: Record<string, unknown> = {
      type: 'stdio',
      command: serverConfig.command,
      args: serverConfig.args ?? [],
    };
    if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
      jsonConfig.env = serverConfig.env;
    }

    await execFileAsync('claude', [
      'mcp', 'add-json', '-s', 'user',
      serverId,
      JSON.stringify(jsonConfig),
    ], { timeout: TIMEOUT_MS });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Remove an MCP server from Claude Code's user scope.
 * Runs: claude mcp remove -s user <name>
 */
export async function removeFromClaudeCode(
  serverId: string,
): Promise<{ success: boolean; error?: string }> {
  const cliExists = await checkClaudeCli();
  if (!cliExists) {
    return { success: false, error: 'Claude Code CLI not installed' };
  }

  try {
    await execFileAsync('claude', ['mcp', 'remove', '-s', 'user', serverId], {
      timeout: TIMEOUT_MS,
    });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Sync all servers from a pilot-ai mcp config to Claude Code.
 */
export async function syncAllToClaudeCode(
  mcpServers: Record<string, McpServerConfigForSync>,
): Promise<{ synced: string[]; failed: string[] }> {
  const synced: string[] = [];
  const failed: string[] = [];

  for (const [serverId, config] of Object.entries(mcpServers)) {
    // HTTP transport servers use a different sync path
    let result: { success: boolean; error?: string };
    if (config.command === '__http__' && config.args?.[0]) {
      result = await syncHttpToClaudeCode(serverId, config.args[0]);
    } else {
      result = await syncToClaudeCode(serverId, config);
    }
    if (result.success) {
      synced.push(serverId);
    } else {
      failed.push(serverId);
    }
  }

  return { synced, failed };
}

/**
 * Register a remote HTTP MCP server in Claude Code.
 * Runs: claude mcp add --transport http -s user <name> <url>
 */
export async function syncHttpToClaudeCode(
  serverId: string,
  url: string,
): Promise<{ success: boolean; error?: string }> {
  const cliExists = await checkClaudeCli();
  if (!cliExists) {
    return { success: false, error: 'Claude Code CLI not installed' };
  }

  // HTTP transport MCP servers (e.g. Figma) may trigger OAuth in the browser,
  // so we need a longer timeout to allow the user to complete the flow.
  const httpTimeoutMs = 180_000; // 3 minutes

  try {
    // Remove existing server first (handles updates)
    await execFileAsync('claude', ['mcp', 'remove', '-s', 'user', serverId], {
      timeout: TIMEOUT_MS,
    }).catch(() => {});

    // Use spawn with stdio: 'inherit' so OAuth browser prompts are visible to the user
    await new Promise<void>((resolve, reject) => {
      const child = spawn('claude', [
        'mcp', 'add',
        '--transport', 'http',
        '-s', 'user',
        serverId,
        url,
      ], { stdio: 'inherit' });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`claude mcp add timed out after ${httpTimeoutMs}ms`));
      }, httpTimeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`claude mcp add exited with code ${code}`));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Check if a specific MCP server is registered in Claude Code.
 * Uses: claude mcp get <name>
 */
export async function checkClaudeCodeSync(serverId: string): Promise<boolean> {
  try {
    const cliExists = await checkClaudeCli();
    if (!cliExists) return false;
    await execFileAsync('claude', ['mcp', 'get', serverId], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
