import inquirer from 'inquirer';
import { MCP_REGISTRY } from '../tools/mcp-registry.js';
import { getInstalledServers, installMcpServer, uninstallMcpServer } from '../agent/mcp-manager.js';
import { setSecret } from '../config/keychain.js';
import { isGhAuthenticated } from '../tools/github.js';
import { loadConfig, saveConfig } from '../config/store.js';
import { checkClaudeCodeSync } from '../config/claude-code-sync.js';

interface ToolStatus {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  type: 'MCP' | 'CLI' | 'Local';
  category: string;
  claudeCode?: 'synced' | 'not synced' | '—';
}

/**
 * Lists all available tools with their active/inactive status.
 */
export async function runTools(): Promise<void> {
  const installed = new Set(await getInstalledServers());
  const config = await loadConfig();

  const tools: ToolStatus[] = [];

  // MCP tools from registry
  for (const entry of MCP_REGISTRY) {
    const isActive = installed.has(entry.id);
    tools.push({
      id: entry.id,
      name: entry.name,
      status: isActive ? 'active' : 'inactive',
      type: 'MCP',
      category: entry.category,
      claudeCode: isActive ? (await checkClaudeCodeSync(entry.id) ? 'synced' : 'not synced') : '—',
    });
  }

  // Custom tools
  tools.push({
    id: 'github',
    name: 'GitHub',
    status: config.github?.enabled ? 'active' : 'inactive',
    type: 'CLI',
    category: 'development',
    claudeCode: '—',
  });
  tools.push({
    id: 'obsidian',
    name: 'Obsidian',
    status: config.obsidian?.vaultPath ? 'active' : 'inactive',
    type: 'Local',
    category: 'productivity',
    claudeCode: '—',
  });

  // Sort by category then name
  const catOrder: Record<string, number> = { design: 0, productivity: 1, development: 2, data: 3, communication: 4 };
  tools.sort((a, b) => (catOrder[a.category] ?? 99) - (catOrder[b.category] ?? 99) || a.name.localeCompare(b.name));

  // Print table
  console.log('\nTool               Status     Type    Claude Code');
  console.log('─'.repeat(60));
  for (const t of tools) {
    const statusIcon = t.status === 'active' ? '\x1b[32mactive\x1b[0m  ' : '\x1b[90minactive\x1b[0m';
    let ccStatus = '—';
    if (t.claudeCode === 'synced') ccStatus = '\x1b[32msynced\x1b[0m';
    else if (t.claudeCode === 'not synced') ccStatus = '\x1b[33mnot synced\x1b[0m';
    console.log(
      `${t.name.padEnd(19)}${statusIcon.padEnd(19)}${t.type.padEnd(8)}${ccStatus}`,
    );
  }
  console.log('');
}

/**
 * Adds a tool by name — collects credentials and registers MCP server.
 */
export async function runAddTool(toolName: string): Promise<void> {
  const toolId = toolName.toLowerCase();

  // Handle custom tools
  if (toolId === 'github') {
    await addGitHub();
    return;
  }
  if (toolId === 'obsidian') {
    await addObsidian();
    return;
  }

  // Find in MCP registry
  const entry = MCP_REGISTRY.find((e) => e.id === toolId);
  if (!entry) {
    console.log(`\nUnknown tool: "${toolName}"`);
    console.log('Run "pilot-ai tools" to see available tools.\n');
    return;
  }

  // Check if already installed
  const installed = await getInstalledServers();
  if (installed.includes(toolId)) {
    console.log(`\n${entry.name} is already active.\n`);
    return;
  }

  // Collect env vars
  const envValues: Record<string, string> = {};

  // Tool-specific guides
  switch (toolId) {
    case 'notion':
      console.log('\n  Notion Integration Guide:');
      console.log('  1. Create a new Integration at https://www.notion.so/my-integrations');
      console.log('  2. Copy the Internal Integration Secret');
      console.log('  3. Add the Integration via "Connections" on your pages/DBs\n');
      break;
    case 'figma':
      console.log('\n  Figma uses the official remote MCP server (OAuth).');
      console.log('  No API key needed — authentication happens in your browser.\n');
      break;
    case 'linear':
      console.log('\n  Linear API Key Guide:');
      console.log('  1. Linear > Settings > API > Personal API keys');
      console.log('  2. Click "Create key" and copy it\n');
      break;
    case 'jira':
    case 'confluence': {
      const toolLabel = toolId === 'jira' ? 'Jira' : 'Confluence';
      console.log(`\n  Atlassian ${toolLabel} Setup Guide:`);
      console.log('  1. Go to https://id.atlassian.com/manage-profile/security/api-tokens');
      console.log('  2. Click "Create API token" and copy it');
      console.log('  3. Note your site name (e.g. "mycompany" from mycompany.atlassian.net)\n');
      break;
    }
    case 'wiki':
      console.log('\n  MediaWiki MCP Setup Guide:');
      console.log('  1. Create a config JSON file with your wiki URL and credentials');
      console.log('  2. Example: { "url": "https://en.wikipedia.org/w", "username": "...", "password": "..." }');
      console.log('  3. Provide the path to this config file\n');
      break;
    default:
      if (entry.envVars && Object.keys(entry.envVars).length > 0) {
        console.log(`\n  ${entry.name} requires the following credentials:\n`);
      }
      break;
  }

  // Collect credentials
  if (toolId === 'jira' || toolId === 'confluence') {
    const atlassianAnswers = await inquirer.prompt([
      { type: 'input', name: 'siteName', message: 'Atlassian site name:', validate: (i: string) => i.length > 0 || 'Site name required.' },
      { type: 'input', name: 'email', message: 'Atlassian account email:', validate: (i: string) => i.includes('@') || 'Valid email required.' },
      { type: 'password', name: 'apiToken', message: 'Atlassian API Token:', mask: '*', validate: (i: string) => i.length > 5 || 'Valid token required.' },
    ]);
    envValues['ATLASSIAN_SITE_NAME'] = atlassianAnswers.siteName;
    envValues['ATLASSIAN_USER_EMAIL'] = atlassianAnswers.email;
    envValues['ATLASSIAN_API_TOKEN'] = atlassianAnswers.apiToken;
    await setSecret(`atlassian-api-token-${toolId}`, atlassianAnswers.apiToken);
  } else if (toolId === 'wiki') {
    const { configPath } = await inquirer.prompt([{
      type: 'input', name: 'configPath', message: 'Path to MediaWiki config JSON:',
      validate: (i: string) => i.length > 0 || 'Config path required.',
    }]);
    envValues['CONFIG'] = configPath;
  } else if (toolId === 'notion') {
    const { notionApiKey } = await inquirer.prompt([{
      type: 'password', name: 'notionApiKey', message: 'Notion API Key:', mask: '*',
      validate: (input: string) => input.length > 10 || 'Valid Notion API Key required.',
    }]);
    await setSecret('notion-api-key', notionApiKey);
    envValues['OPENAPI_MCP_HEADERS'] = JSON.stringify({
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
    });
    const config = await loadConfig();
    await saveConfig({ ...config, notion: { apiKey: '***keychain***' } });
  } else if (toolId === 'figma') {
    // Figma uses HTTP transport (OAuth) — no credentials to collect
  } else if (toolId === 'linear') {
    const { linearApiKey } = await inquirer.prompt([{
      type: 'password', name: 'linearApiKey', message: 'Linear API Key:', mask: '*',
      validate: (input: string) => input.startsWith('lin_api_') || 'Please enter a key starting with lin_api_.',
    }]);
    await setSecret('linear-api-key', linearApiKey);
    envValues['LINEAR_API_TOKEN'] = linearApiKey;
    const config = await loadConfig();
    await saveConfig({ ...config, linear: { apiKey: '***keychain***' } });
  } else if (toolId === 'google-drive') {
    const googleAnswers = await inquirer.prompt([
      { type: 'password', name: 'clientId', message: 'Google OAuth Client ID:', mask: '*', validate: (i: string) => i.length > 10 || 'Required.' },
      { type: 'password', name: 'clientSecret', message: 'Google OAuth Client Secret:', mask: '*', validate: (i: string) => i.length > 5 || 'Required.' },
    ]);
    await setSecret('google-client-id', googleAnswers.clientId);
    await setSecret('google-client-secret', googleAnswers.clientSecret);
    envValues['GOOGLE_CLIENT_ID'] = googleAnswers.clientId;
    envValues['GOOGLE_CLIENT_SECRET'] = googleAnswers.clientSecret;
  } else if (entry.envVars) {
    for (const [key, desc] of Object.entries(entry.envVars)) {
      const { value } = await inquirer.prompt([{
        type: 'password', name: 'value', message: `${desc}:`, mask: '*',
        validate: (input: string) => input.length > 0 || `${key} is required.`,
      }]);
      envValues[key] = value;
    }
  }

  // Register
  const result = await installMcpServer(toolId, envValues, { skipVerify: true });
  if (result.success) {
    console.log(`\n  ${entry.name} configured (MCP server registered).\n`);
  } else {
    console.log(`\n  Failed to register ${entry.name}: ${result.error}\n`);
  }
}

/**
 * Removes a tool by name — unregisters MCP server.
 */
export async function runRemoveTool(toolName: string): Promise<void> {
  const toolId = toolName.toLowerCase();

  const installed = await getInstalledServers();
  if (!installed.includes(toolId)) {
    const entry = MCP_REGISTRY.find((e) => e.id === toolId);
    console.log(`\n${entry?.name ?? toolId} is not currently active.\n`);
    return;
  }

  await uninstallMcpServer(toolId);
  const entry = MCP_REGISTRY.find((e) => e.id === toolId);
  console.log(`\n  ${entry?.name ?? toolId} MCP server removed.\n`);
}

/**
 * Syncs all pilot-ai MCP servers to Claude Code native settings (user scope).
 */
export async function runSyncMcp(): Promise<void> {
  const { loadMcpConfig, saveMcpConfig } = await import('../tools/figma-mcp.js');
  const { syncToClaudeCode, syncHttpToClaudeCode } = await import('../config/claude-code-sync.js');
  const { checkClaudeCli } = await import('../agent/claude.js');
  const { getRegistryEntry } = await import('../tools/mcp-registry.js');

  const cliExists = await checkClaudeCli();
  if (!cliExists) {
    console.log('\n  Claude Code CLI is not installed. Cannot sync.\n');
    return;
  }

  const config = await loadMcpConfig();
  const serverIds = Object.keys(config.mcpServers);

  if (serverIds.length === 0) {
    console.log('\n  No MCP servers configured in pilot-ai.\n');
    return;
  }

  console.log('\nSyncing MCP servers to Claude Code (user scope)...');

  // Migrate outdated configs using the registry as source of truth
  let configChanged = false;
  for (const serverId of serverIds) {
    const entry = getRegistryEntry(serverId);
    if (!entry) continue;
    const current = config.mcpServers[serverId];

    if (entry.transport === 'http' && entry.url) {
      // Migrate to HTTP transport marker
      if (current.command !== '__http__') {
        config.mcpServers[serverId] = { command: '__http__', args: [entry.url] };
        configChanged = true;
      }
    } else {
      // Ensure it's a stdio server with the correct package name
      const expectedArgs = ['-y', entry.npmPackage, ...(entry.args ?? [])];
      const currentPkg = current.args?.[1];
      if (current.command !== 'npx' || currentPkg !== entry.npmPackage) {
        // Migrate env: map old env key names to new ones if needed
        const env = current.env ?? {};
        // Figma: FIGMA_PERSONAL_ACCESS_TOKEN → FIGMA_API_KEY
        if (serverId === 'figma' && env['FIGMA_PERSONAL_ACCESS_TOKEN'] && !env['FIGMA_API_KEY']) {
          env['FIGMA_API_KEY'] = env['FIGMA_PERSONAL_ACCESS_TOKEN'];
          delete env['FIGMA_PERSONAL_ACCESS_TOKEN'];
        }
        config.mcpServers[serverId] = {
          command: 'npx',
          args: expectedArgs,
          ...(Object.keys(env).length > 0 ? { env } : {}),
        };
        configChanged = true;
      }
    }
  }
  if (configChanged) {
    await saveMcpConfig(config);
    console.log('  (migrated outdated configs to latest package names)');
  }

  // Sync: separate HTTP and stdio servers
  const synced: string[] = [];
  const failed: string[] = [];

  for (const serverId of serverIds) {
    const serverConfig = config.mcpServers[serverId];
    let result: { success: boolean; error?: string };

    if (serverConfig.command === '__http__' && serverConfig.args?.[0]) {
      result = await syncHttpToClaudeCode(serverId, serverConfig.args[0]);
    } else {
      result = await syncToClaudeCode(serverId, serverConfig);
    }

    if (result.success) {
      synced.push(serverId);
    } else {
      failed.push(serverId);
    }
  }

  for (const id of synced) {
    console.log(`  ✅ ${id} — synced`);
  }
  for (const id of failed) {
    console.log(`  ❌ ${id} — failed`);
  }

  console.log(`\n${synced.length} server(s) synced. Run "claude mcp list" to verify.\n`);
}

async function addGitHub(): Promise<void> {
  const authed = await isGhAuthenticated();
  if (authed) {
    console.log('\n  GitHub CLI is already authenticated.\n');
    const config = await loadConfig();
    await saveConfig({ ...config, github: { enabled: true } });
    return;
  }

  console.log('\n  GitHub CLI is not authenticated. Please run:\n');
  console.log('    gh auth login --scopes repo,read:org,workflow\n');
  console.log('  Complete the login, then run this command again.\n');
}

async function addObsidian(): Promise<void> {
  const { vaultPath } = await inquirer.prompt([{
    type: 'input', name: 'vaultPath', message: 'Obsidian vault path (e.g. ~/Documents/MyVault):',
    validate: (input: string) => input.length > 0 || 'Path required.',
  }]);
  const config = await loadConfig();
  await saveConfig({ ...config, obsidian: { vaultPath } });
  console.log(`\n  Obsidian vault configured: ${vaultPath}\n`);
}
