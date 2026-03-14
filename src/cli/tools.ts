import inquirer from 'inquirer';
import { exec } from 'node:child_process';
import { MCP_REGISTRY, parseAtlassianSiteName } from '../tools/mcp-registry.js';
import { getInstalledServers, installMcpServer, uninstallMcpServer, registerSentinelAi } from '../agent/mcp-manager.js';
import { setSecret } from '../config/keychain.js';
import { isGhAuthenticated } from '../tools/github.js';
import { loadConfig, saveConfig } from '../config/store.js';
import { checkClaudeCodeSync } from '../config/claude-code-sync.js';
import {
  configureGoogle,
  getGoogleAuthUrl,
  exchangeGoogleCode,
  loadGoogleTokens,
  writeGmailMcpCredentials,
  writeGoogleMcpTokens,
  GOOGLE_SCOPES,
} from '../tools/google-auth.js';
import { startOAuthCallbackServer } from '../utils/oauth-callback-server.js';

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
  if (toolId === 'google-oauth' || toolId === 'google') {
    await addGoogleOAuth();
    return;
  }
  if (toolId === 'sentinel-ai' || toolId === 'sentinel') {
    await addSentinelAi();
    return;
  }

  // Handle "wiki" alias — prompt user to choose between Confluence and MediaWiki
  if (toolId === 'wiki') {
    const { wikiChoice } = await inquirer.prompt([{
      type: 'list',
      name: 'wikiChoice',
      message: 'Which wiki service do you want to set up?',
      choices: [
        { name: 'Confluence (Atlassian) — most common for teams', value: 'confluence' },
        { name: 'MediaWiki (Wikipedia, self-hosted wikis)', value: 'wiki' },
      ],
    }]);
    if (wikiChoice === 'confluence') {
      return runAddTool('confluence');
    }
    // else continue with 'wiki' (MediaWiki)
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
      console.log('  1. Go to https://www.figma.com/settings');
      console.log('  2. Scroll to "Personal access tokens"');
      console.log('  3. Click "Generate new token", copy the token (starts with figd_)\n');
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
      console.log('  3. Copy your Atlassian URL (e.g. https://mycompany.atlassian.net)\n');
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
  if (toolId === 'slack') {
    console.log('\n  Slack MCP Setup:\n');
    const { botToken } = await inquirer.prompt([{
      type: 'password', name: 'botToken', message: 'Slack Bot Token (xoxb-...):', mask: '*',
      validate: (i: string) => i.startsWith('xoxb-') || 'Bot Token must start with xoxb-',
    }]);

    // Auto-fetch Team ID via Slack auth.test API
    let teamId = '';
    try {
      const resp = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await resp.json() as { ok: boolean; team_id?: string; error?: string };
      if (data.ok && data.team_id) {
        teamId = data.team_id;
        console.log(`  ✓ Team ID auto-detected: ${teamId}`);
      } else {
        console.log(`  ⚠ Could not auto-detect Team ID (${data.error ?? 'unknown'}). Please enter manually.`);
      }
    } catch {
      console.log('  ⚠ Could not auto-detect Team ID (network error). Please enter manually.');
    }

    if (!teamId) {
      const ans = await inquirer.prompt([{
        type: 'input', name: 'teamId', message: 'Slack Team/Workspace ID (T...):',
        validate: (i: string) => i.startsWith('T') || 'Team ID must start with T (e.g. T01ABC23DEF)',
      }]);
      teamId = ans.teamId;
    }

    envValues['SLACK_BOT_TOKEN'] = botToken;
    envValues['SLACK_TEAM_ID'] = teamId;
  } else if (toolId === 'jira' || toolId === 'confluence') {
    const atlassianAnswers = await inquirer.prompt([
      {
        type: 'input', name: 'siteUrl',
        message: 'Atlassian URL (e.g. https://mycompany.atlassian.net):',
        validate: (i: string) => i.length > 0 || 'URL required.',
      },
      { type: 'input', name: 'email', message: 'Atlassian account email:', validate: (i: string) => i.includes('@') || 'Valid email required.' },
      { type: 'password', name: 'apiToken', message: 'Atlassian API Token:', mask: '*', validate: (i: string) => i.length > 5 || 'Valid token required.' },
    ]);
    const siteName = parseAtlassianSiteName(atlassianAnswers.siteUrl);
    console.log(`  → Site name: ${siteName}`);

    // Verify credentials via Atlassian REST API
    const verifyEndpoint = toolId === 'jira'
      ? `https://${siteName}.atlassian.net/rest/api/3/myself`
      : `https://${siteName}.atlassian.net/wiki/rest/api/user/current`;
    const authHeader = 'Basic ' + Buffer.from(`${atlassianAnswers.email}:${atlassianAnswers.apiToken}`).toString('base64');
    try {
      const resp = await fetch(verifyEndpoint, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        console.log(`  ⚠ Credential verification failed (HTTP ${resp.status}). Check your email and API token.`);
        console.log(`  Saving anyway — you can re-run "pilot-ai addtool ${toolId}" to fix.\n`);
      } else {
        console.log('  ✓ Credentials verified successfully.');
      }
    } catch {
      console.log('  ⚠ Could not verify credentials (network error). Saving anyway.');
    }

    envValues['ATLASSIAN_SITE_NAME'] = siteName;
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
    const { figmaApiKey } = await inquirer.prompt([{
      type: 'password', name: 'figmaApiKey', message: 'Figma API Key (figd_...):', mask: '*',
      validate: (input: string) => input.startsWith('figd_') || 'Token must start with figd_',
    }]);
    await setSecret('figma-api-key', figmaApiKey);
    envValues['FIGMA_API_KEY'] = figmaApiKey;
    const config = await loadConfig();
    await saveConfig({ ...config, figma: { personalAccessToken: '***keychain***' } });
  } else if (toolId === 'linear') {
    const { linearApiKey } = await inquirer.prompt([{
      type: 'password', name: 'linearApiKey', message: 'Linear API Key:', mask: '*',
      validate: (input: string) => input.startsWith('lin_api_') || 'Please enter a key starting with lin_api_.',
    }]);
    await setSecret('linear-api-key', linearApiKey);
    envValues['LINEAR_API_TOKEN'] = linearApiKey;
    const config = await loadConfig();
    await saveConfig({ ...config, linear: { apiKey: '***keychain***' } });
  } else if (toolId === 'google-drive' || toolId === 'google-calendar') {
    console.log('\n  Google OAuth2 Setup Guide:');
    console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
    console.log('  2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"');
    console.log('  3. Application type: "Desktop app", Name: "Pilot-AI"');
    if (toolId === 'google-drive') {
      console.log('  4. Enable Drive API: https://console.cloud.google.com/apis/library/drive.googleapis.com\n');
    } else {
      console.log('  4. Enable Calendar API: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com\n');
    }
    const googleAnswers = await inquirer.prompt([
      { type: 'password', name: 'clientId', message: 'Google OAuth Client ID:', mask: '*', validate: (i: string) => i.length > 10 || 'Required.' },
      { type: 'password', name: 'clientSecret', message: 'Google OAuth Client Secret:', mask: '*', validate: (i: string) => i.length > 5 || 'Required.' },
    ]);
    await setSecret('google-client-id', googleAnswers.clientId);
    await setSecret('google-client-secret', googleAnswers.clientSecret);

    // Create OAuth credentials file for the MCP server
    const { default: fsMod } = await import('node:fs/promises');
    const { default: pathMod } = await import('node:path');
    const { default: osMod } = await import('node:os');
    const credDir = pathMod.join(osMod.homedir(), '.pilot', 'credentials');
    await fsMod.mkdir(credDir, { recursive: true });
    const oauthPath = pathMod.join(credDir, 'gcp-oauth.keys.json');
    await fsMod.writeFile(oauthPath, JSON.stringify({
      installed: {
        client_id: googleAnswers.clientId,
        client_secret: googleAnswers.clientSecret,
        redirect_uris: ['http://127.0.0.1'],
      },
    }), 'utf-8');

    if (toolId === 'google-drive') {
      envValues['GOOGLE_DRIVE_OAUTH_CREDENTIALS'] = oauthPath;
    } else {
      envValues['GOOGLE_OAUTH_CREDENTIALS'] = oauthPath;
    }

    // Auto-run OAuth flow
    const service = toolId === 'google-drive' ? 'drive' : 'calendar';
    await runAddToolOAuthFlow(googleAnswers.clientId, googleAnswers.clientSecret, [service]);
  } else if (toolId === 'gmail') {
    console.log('\n  Gmail MCP Setup (Google OAuth):');
    console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
    console.log('  2. Click "+ CREATE CREDENTIALS" → "OAuth client ID" (Desktop app)');
    console.log('  3. Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com\n');
    const googleAnswers = await inquirer.prompt([
      { type: 'password', name: 'clientId', message: 'Google OAuth Client ID:', mask: '*', validate: (i: string) => i.length > 10 || 'Required.' },
      { type: 'password', name: 'clientSecret', message: 'Google OAuth Client Secret:', mask: '*', validate: (i: string) => i.length > 5 || 'Required.' },
    ]);
    await setSecret('google-client-id', googleAnswers.clientId);
    await setSecret('google-client-secret', googleAnswers.clientSecret);

    // Run OAuth to get refresh token
    await runAddToolOAuthFlow(googleAnswers.clientId, googleAnswers.clientSecret, ['gmail']);
    const tokens = await loadGoogleTokens();
    if (tokens?.refreshToken) {
      // Write ~/.gmail-mcp/ credential files for file-based auth
      await writeGmailMcpCredentials(googleAnswers.clientId, googleAnswers.clientSecret, tokens);
      console.log('  Gmail MCP credential files written to ~/.gmail-mcp/');

      const { default: osMod2 } = await import('node:os');
      const { default: pathMod2 } = await import('node:path');
      const gmailMcpDir = pathMod2.join(osMod2.homedir(), '.gmail-mcp');
      envValues['CLIENT_ID'] = googleAnswers.clientId;
      envValues['CLIENT_SECRET'] = googleAnswers.clientSecret;
      envValues['REFRESH_TOKEN'] = tokens.refreshToken;
      envValues['PORT'] = '3456';
      envValues['GMAIL_OAUTH_PATH'] = pathMod2.join(gmailMcpDir, 'gcp-oauth.keys.json');
      envValues['GMAIL_CREDENTIALS_PATH'] = pathMod2.join(gmailMcpDir, 'credentials.json');
    } else {
      console.log('  ⚠ Could not obtain refresh token. Run "pilot-ai auth google --services gmail" first.\n');
    }
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
    } else if (current.command === '__http__' && entry.transport !== 'http') {
      // Migrate from HTTP to stdio (e.g. figma OAuth → PAT)
      const env = current.env ?? {};
      config.mcpServers[serverId] = {
        command: 'npx',
        args: ['-y', entry.npmPackage, ...(entry.args ?? [])],
        ...(Object.keys(env).length > 0 ? { env } : {}),
      };
      configChanged = true;
      console.log(`  ⚠ ${serverId}: migrated from HTTP OAuth to stdio (PAT). Run "pilot-ai addtool ${serverId}" to set credentials.`);
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
      result = await syncHttpToClaudeCode(serverId, serverConfig.args[0], 'claude', { interactive: true });
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

async function addGoogleOAuth(): Promise<void> {
  console.log('\n── Google OAuth2 Setup ──\n');
  console.log('  Step 1: Create OAuth Client ID');
  console.log('  ─────────────────────────────');
  console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
  console.log('  2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"');
  console.log('  3. Application type: "Desktop app", Name: "Pilot-AI"');
  console.log('  4. Click "Create" and copy the Client ID & Client Secret\n');
  console.log('  Step 2: Enable Google APIs');
  console.log('  ─────────────────────────');
  console.log('  • Gmail API:     https://console.cloud.google.com/apis/library/gmail.googleapis.com');
  console.log('  • Calendar API:  https://console.cloud.google.com/apis/library/calendar-json.googleapis.com');
  console.log('  • Drive API:     https://console.cloud.google.com/apis/library/drive.googleapis.com\n');

  const googleAnswers = await inquirer.prompt([
    { type: 'password', name: 'clientId', message: 'Google OAuth Client ID:', mask: '*', validate: (i: string) => i.length > 10 || 'Required.' },
    { type: 'password', name: 'clientSecret', message: 'Google OAuth Client Secret:', mask: '*', validate: (i: string) => i.length > 5 || 'Required.' },
  ]);

  const { googleServices } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'googleServices',
    message: 'Google services:',
    choices: [
      { name: 'Gmail', value: 'gmail', checked: true },
      { name: 'Google Calendar', value: 'calendar', checked: true },
      { name: 'Google Drive', value: 'drive', checked: false },
    ],
  }]);

  const trimmedClientId = googleAnswers.clientId.trim();
  const trimmedClientSecret = googleAnswers.clientSecret.trim();
  await setSecret('google-client-id', trimmedClientId);
  await setSecret('google-client-secret', trimmedClientSecret);

  const config = await loadConfig();
  const services = googleServices as Array<'gmail' | 'calendar' | 'drive'>;
  await saveConfig({
    ...config,
    google: {
      clientId: '***keychain***',
      clientSecret: '***keychain***',
      services,
    },
  });

  await runAddToolOAuthFlow(trimmedClientId, trimmedClientSecret, services);
  console.log(`  Google configured (${services.join(', ')}).\n`);
}

/**
 * Runs OAuth flow during addtool. Non-fatal on failure.
 */
/**
 * Sentinel AI setup — supports npx and local build modes.
 * Exported for reuse in init.ts.
 */
export async function addSentinelAi(): Promise<boolean> {
  // Check if already installed
  const installed = await getInstalledServers();
  if (installed.includes('sentinel-ai')) {
    const { reconfigure } = await inquirer.prompt([{
      type: 'confirm', name: 'reconfigure',
      message: 'Sentinel AI is already registered. Reconfigure?',
      default: false,
    }]);
    if (!reconfigure) return true;
  }

  console.log('\n  ── Sentinel AI Setup ──\n');
  console.log('  Sentinel AI is a QA automation infrastructure that runs Playwright/Maestro tests.');
  console.log('  Docs: https://github.com/eodin/sentinel-ai\n');

  const { mode } = await inquirer.prompt([{
    type: 'list', name: 'mode',
    message: 'Installation mode:',
    choices: [
      { name: 'npx (recommended — uses published npm package)', value: 'npx' },
      { name: 'Local build (use a local clone of sentinel-ai)', value: 'local' },
    ],
  }]);

  let localPath: string | undefined;
  if (mode === 'local') {
    console.log('\n  Make sure you have built sentinel-ai first: cd sentinel-ai && npm run build\n');
    const { entryPath } = await inquirer.prompt([{
      type: 'input', name: 'entryPath',
      message: 'Path to sentinel-ai MCP server entry point:',
      validate: async (input: string) => {
        if (!input.trim()) return 'Path is required.';
        const resolved = input.startsWith('~')
          ? input.replace('~', (await import('node:os')).default.homedir())
          : input;
        const { default: fsMod } = await import('node:fs');
        if (!fsMod.existsSync(resolved)) return `File not found: ${resolved}`;
        return true;
      },
    }]);
    localPath = entryPath.startsWith('~')
      ? entryPath.replace('~', (await import('node:os')).default.homedir())
      : entryPath;
  }

  // Optional environment variables
  const env: Record<string, string> = {};
  const { configEnv } = await inquirer.prompt([{
    type: 'confirm', name: 'configEnv',
    message: 'Configure optional environment variables? (registry/reports directory)',
    default: false,
  }]);

  if (configEnv) {
    const { registryDir } = await inquirer.prompt([{
      type: 'input', name: 'registryDir',
      message: 'SENTINEL_REGISTRY_DIR (app registry directory, press Enter to skip):',
    }]);
    if (registryDir.trim()) env['SENTINEL_REGISTRY_DIR'] = registryDir.trim();

    const { reportsDir } = await inquirer.prompt([{
      type: 'input', name: 'reportsDir',
      message: 'SENTINEL_REPORTS_DIR (report output directory, press Enter to skip):',
    }]);
    if (reportsDir.trim()) env['SENTINEL_REPORTS_DIR'] = reportsDir.trim();
  }

  const result = await registerSentinelAi({
    mode: mode as 'npx' | 'local',
    localPath,
    env: Object.keys(env).length > 0 ? env : undefined,
  });

  if (result.success) {
    const via = mode === 'npx' ? 'npx sentinel-ai' : `local build (${localPath})`;
    console.log(`\n  ✓ Sentinel AI registered via ${via}.\n`);
    return true;
  } else {
    console.log(`\n  ✗ Failed to register Sentinel AI: ${result.error}\n`);
    return false;
  }
}

async function runAddToolOAuthFlow(
  clientId: string,
  clientSecret: string,
  services: Array<keyof typeof GOOGLE_SCOPES>,
): Promise<void> {
  // Check if already authenticated
  const existing = await loadGoogleTokens();
  if (existing) {
    const { reauth } = await inquirer.prompt([{
      type: 'confirm',
      name: 'reauth',
      message: 'Google tokens already exist. Re-authenticate?',
      default: false,
    }]);
    if (!reauth) {
      console.log('  Using existing Google tokens.\n');
      return;
    }
  }

  try {
    configureGoogle({ clientId, clientSecret });
    const server = await startOAuthCallbackServer();

    try {
      const { url: authUrl, codeVerifier, state: expectedState } = getGoogleAuthUrl(services, server.redirectUri);
      console.log('\n  Step 3: Authenticate with Google');
      console.log('  ────────────────────────────────');
      console.log('  Opening browser for Google sign-in...');
      console.log(`  (If the browser doesn't open, visit: ${authUrl})\n`);
      exec(`open "${authUrl}"`);

      console.log('  Waiting for authorization...');
      const { code, state: returnedState } = await server.waitForCode();
      if (returnedState !== expectedState) {
        throw new Error('OAuth state mismatch — possible CSRF attack. Please try again.');
      }

      console.log('  Exchanging authorization code for tokens...');
      await exchangeGoogleCode(code, services, server.redirectUri, codeVerifier);

      // Sync tokens to Calendar/Drive MCP servers
      const freshTokens = await loadGoogleTokens();
      if (freshTokens) {
        await writeGoogleMcpTokens(freshTokens);
      }
      console.log(`  ✓ Google authenticated! (${services.join(', ')})\n`);
    } finally {
      server.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ Google authentication failed: ${msg}`);
    console.log('  You can authenticate later with: pilot-ai auth google\n');
  }
}
