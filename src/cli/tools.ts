import inquirer from 'inquirer';
import { MCP_REGISTRY } from '../tools/mcp-registry.js';
import { getInstalledServers, installMcpServer, uninstallMcpServer } from '../agent/mcp-manager.js';
import { setSecret } from '../config/keychain.js';
import { isGhAuthenticated } from '../tools/github.js';
import { loadConfig, saveConfig } from '../config/store.js';

interface ToolStatus {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  type: 'MCP' | 'CLI' | 'Local';
  category: string;
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
    tools.push({
      id: entry.id,
      name: entry.name,
      status: installed.has(entry.id) ? 'active' : 'inactive',
      type: 'MCP',
      category: entry.category,
    });
  }

  // Custom tools
  tools.push({
    id: 'github',
    name: 'GitHub',
    status: config.github?.enabled ? 'active' : 'inactive',
    type: 'CLI',
    category: 'development',
  });
  tools.push({
    id: 'obsidian',
    name: 'Obsidian',
    status: config.obsidian?.vaultPath ? 'active' : 'inactive',
    type: 'Local',
    category: 'productivity',
  });

  // Sort by category then name
  const catOrder: Record<string, number> = { design: 0, productivity: 1, development: 2, data: 3, communication: 4 };
  tools.sort((a, b) => (catOrder[a.category] ?? 99) - (catOrder[b.category] ?? 99) || a.name.localeCompare(b.name));

  // Print table
  console.log('\nTool               Status     Type    Category');
  console.log('─'.repeat(55));
  for (const t of tools) {
    const statusIcon = t.status === 'active' ? '\x1b[32mactive\x1b[0m  ' : '\x1b[90minactive\x1b[0m';
    console.log(
      `${t.name.padEnd(19)}${statusIcon.padEnd(19)}${t.type.padEnd(8)}${t.category}`,
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
      console.log('\n  Figma Personal Access Token Guide:');
      console.log('  1. Figma > Account Settings > Personal access tokens');
      console.log('  2. Click "Generate new token" and copy it\n');
      break;
    case 'linear':
      console.log('\n  Linear API Key Guide:');
      console.log('  1. Linear > Settings > API > Personal API keys');
      console.log('  2. Click "Create key" and copy it\n');
      break;
    default:
      if (entry.envVars && Object.keys(entry.envVars).length > 0) {
        console.log(`\n  ${entry.name} requires the following credentials:\n`);
      }
      break;
  }

  // Collect credentials
  if (toolId === 'notion') {
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
    const { figmaToken } = await inquirer.prompt([{
      type: 'password', name: 'figmaToken', message: 'Figma Personal Access Token:', mask: '*',
      validate: (input: string) => input.length > 10 || 'Valid Figma token required.',
    }]);
    await setSecret('figma-personal-access-token', figmaToken);
    envValues['FIGMA_PERSONAL_ACCESS_TOKEN'] = figmaToken;
    const config = await loadConfig();
    await saveConfig({ ...config, figma: { personalAccessToken: '***keychain***' } });
  } else if (toolId === 'linear') {
    const { linearApiKey } = await inquirer.prompt([{
      type: 'password', name: 'linearApiKey', message: 'Linear API Key:', mask: '*',
      validate: (input: string) => input.startsWith('lin_api_') || 'Please enter a key starting with lin_api_.',
    }]);
    await setSecret('linear-api-key', linearApiKey);
    envValues['LINEAR_API_KEY'] = linearApiKey;
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
