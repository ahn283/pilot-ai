import inquirer from 'inquirer';
import { exec, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { checkClaudeCli, checkClaudeCliAuth } from '../agent/claude.js';
import { saveConfig, ensurePilotDir } from '../config/store.js';
import { setSecret } from '../config/keychain.js';
import type { PilotConfig } from '../config/schema.js';
import { defaultConfig } from '../config/schema.js';
import { testSlackConnection, testTelegramConnection } from './connection-test.js';
import { installMcpServer } from '../agent/mcp-manager.js';
import { MCP_REGISTRY, type McpServerEntry, parseAtlassianSiteName } from '../tools/mcp-registry.js';
import { requestPermissions, triggerBulkAutomationPermissions } from '../security/permissions.js';
import { isGhAuthenticated } from '../tools/github.js';
import {
  configureGoogle,
  getGoogleAuthUrl,
  exchangeGoogleCode,
  verifyGoogleTokens,
  loadGoogleTokens,
  writeGmailMcpCredentials,
  writeGoogleMcpTokens,
  GOOGLE_SCOPES,
} from '../tools/google-auth.js';
import { startOAuthCallbackServer } from '../utils/oauth-callback-server.js';

const execFileAsync = promisify(execFile);

export async function runInit(): Promise<void> {
  console.log('\nStarting Pilot-AI setup.\n');

  await ensurePilotDir();

  // 1. Claude connection
  const claudeConfig = await setupClaude();

  // 2. Messenger setup
  const { messenger: messengerConfig, userId, platform } = await setupMessenger();

  // 3. Optional integrations
  const integrationConfig = await setupIntegrations();

  // 4. Playwright browser install
  await installPlaywright();

  // 5. macOS permissions
  await requestPermissions();
  await triggerBulkAutomationPermissions();

  // 6. Save config with allowedUsers
  const config: Partial<PilotConfig> = {
    ...defaultConfig,
    claude: claudeConfig,
    messenger: messengerConfig,
    ...integrationConfig,
  };
  // Register the user in allowedUsers
  if (config.security?.allowedUsers) {
    if (platform === 'slack') {
      config.security.allowedUsers.slack = [userId];
    } else {
      config.security.allowedUsers.telegram = [userId];
    }
  }

  await saveConfig(config);

  console.log('\nSetup complete! Run "npx pilot-ai start" to start the agent.\n');
}

async function setupClaude(): Promise<PilotConfig['claude']> {
  console.log('── Claude Connection ──\n');

  const cliExists = await checkClaudeCli();

  if (cliExists) {
    console.log('Claude Code CLI is installed.');
    console.log('  Checking authentication...');

    const isAuthed = await checkClaudeCliAuth();

    if (!isAuthed) {
      console.log('\n  Claude CLI is not authenticated.');
      console.log('  Please run "claude" in your terminal to log in first,');
      console.log('  then re-run "npx pilot-ai init".\n');

      const { continueAnyway } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continueAnyway',
          message: 'Continue with API Key mode instead?',
          default: false,
        },
      ]);

      if (!continueAnyway) {
        throw new Error('Claude CLI authentication required. Run "claude" to log in first.');
      }
    } else {
      console.log('  Authenticated!\n');

      const { useApi } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useApi',
          message: 'Use API Key mode instead? (default: CLI mode)',
          default: false,
        },
      ]);

      if (!useApi) {
        return { mode: 'cli', cliBinary: 'claude', apiKey: null };
      }
    }
  } else {
    console.log('⚠ Claude Code CLI not found.\n');
    console.log('  Pilot-AI requires Claude Code CLI to run in CLI mode (recommended).');
    console.log('  Install it with:\n');
    console.log('    npm install -g @anthropic-ai/claude-code\n');
    console.log('  After installing, run "claude" once to authenticate.\n');

    const { retryOrApi } = await inquirer.prompt([
      {
        type: 'list',
        name: 'retryOrApi',
        message: 'What would you like to do?',
        choices: [
          { name: 'I installed it — check again', value: 'retry' },
          { name: 'Use API Key mode instead (no CLI needed)', value: 'api' },
        ],
      },
    ]);

    if (retryOrApi === 'retry') {
      const retryExists = await checkClaudeCli();
      if (retryExists) {
        console.log('  Claude Code CLI detected!\n');
        const isAuthed = await checkClaudeCliAuth();
        if (isAuthed) {
          console.log('  Authenticated!\n');
          return { mode: 'cli', cliBinary: 'claude', apiKey: null };
        }
        console.log('  CLI is installed but not authenticated.');
        console.log('  Run "claude" in your terminal to log in, then re-run "npx pilot-ai init".\n');
        throw new Error('Claude CLI authentication required. Run "claude" to log in first.');
      }
      console.log('  Still not found. Falling back to API Key mode.\n');
    }
  }

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Anthropic API Key:',
      mask: '*',
      validate: (input: string) => input.startsWith('sk-') || 'Please enter a valid API Key starting with sk-.',
    },
  ]);

  await setSecret('anthropic-api-key', apiKey);
  return { mode: 'api', cliBinary: 'claude', apiKey: '***keychain***' };
}

interface MessengerSetupResult {
  messenger: PilotConfig['messenger'];
  userId: string;
  platform: 'slack' | 'telegram';
}

async function setupMessenger(): Promise<MessengerSetupResult> {
  console.log('\n── Messenger Setup ──\n');

  console.log('  1. Slack');
  console.log('  2. Telegram\n');
  const { platformChoice } = await inquirer.prompt([
    {
      type: 'input',
      name: 'platformChoice',
      message: 'Select messenger platform (1 or 2):',
      validate: (input: string) => ['1', '2'].includes(input.trim()) || 'Enter 1 or 2.',
    },
  ]);
  const platform = platformChoice.trim() === '1' ? 'slack' : 'telegram';

  if (platform === 'slack') {
    return setupSlack();
  }
  return setupTelegram();
}

async function setupSlack(): Promise<MessengerSetupResult> {
  console.log('\n📋 Slack App Setup Guide:');
  console.log('  1. Create a new App at https://api.slack.com/apps');
  console.log('  2. Enable Socket Mode');
  console.log('  3. Event Subscriptions → Subscribe to bot events: message.im');
  console.log('  4. OAuth & Permissions → Bot Token Scopes:');
  console.log('     chat:write, reactions:write, im:history, im:read, im:write,');
  console.log('     app_mentions:read, channels:history');
  console.log('  5. App Home → Messages Tab: turn ON');
  console.log('  6. Event Subscriptions → Subscribe to bot events:');
  console.log('     message.im, app_mention');
  console.log('  7. Install the App to your workspace');
  console.log('  8. Invite the bot to channels: /invite @bot-name\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Bot Token (xoxb-...):',
      mask: '*',
      validate: (input: string) => input.startsWith('xoxb-') || 'Please enter a token starting with xoxb-.',
    },
    {
      type: 'password',
      name: 'appToken',
      message: 'App-Level Token (xapp-...):',
      mask: '*',
      validate: (input: string) => input.startsWith('xapp-') || 'Please enter a token starting with xapp-.',
    },
    {
      type: 'password',
      name: 'signingSecret',
      message: 'Signing Secret:',
      mask: '*',
    },
    {
      type: 'input',
      name: 'userId',
      message: 'Your Slack User ID:',
      validate: (input: string) => input.startsWith('U') || 'Please enter a User ID starting with U.',
    },
  ]);

  // Connection test
  console.log('\n  Testing Slack connection...');
  const slackTest = await testSlackConnection(answers.botToken, answers.userId);
  if (slackTest.ok) {
    console.log('  Connected successfully!\n');
  } else {
    console.log(`  Warning: Connection test failed (${slackTest.error}). Saving tokens anyway.\n`);
  }

  // Save to Keychain
  await setSecret('slack-bot-token', answers.botToken);
  await setSecret('slack-app-token', answers.appToken);
  await setSecret('slack-signing-secret', answers.signingSecret);

  return {
    messenger: {
      platform: 'slack',
      slack: {
        botToken: '***keychain***',
        appToken: '***keychain***',
        signingSecret: '***keychain***',
      },
    },
    userId: answers.userId,
    platform: 'slack',
  };
}

async function setupTelegram(): Promise<MessengerSetupResult> {
  console.log('\n📋 Telegram Bot Setup Guide:');
  console.log('  1. Send /newbot to @BotFather on Telegram');
  console.log('  2. Set the bot name and username');
  console.log('  3. Copy the issued Bot Token\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Bot Token:',
      mask: '*',
      validate: (input: string) => /^\d+:/.test(input) || 'Please enter a valid Telegram Bot Token.',
    },
    {
      type: 'input',
      name: 'chatId',
      message: 'Your Telegram Chat ID:',
      validate: (input: string) => /^\d+$/.test(input) || 'Please enter a numeric Chat ID.',
    },
  ]);

  // Connection test
  console.log('\n  Testing Telegram connection...');
  const telegramTest = await testTelegramConnection(answers.botToken, answers.chatId);
  if (telegramTest.ok) {
    console.log('  Connected successfully!\n');
  } else {
    console.log(`  Warning: Connection test failed (${telegramTest.error}). Saving token anyway.\n`);
  }

  await setSecret('telegram-bot-token', answers.botToken);

  return {
    messenger: {
      platform: 'telegram',
      telegram: {
        botToken: '***keychain***',
      },
    },
    userId: answers.chatId,
    platform: 'telegram',
  };
}

/** Tools available in init selection — MCP registry entries + custom integrations */
interface InitToolChoice {
  id: string;
  name: string;
  description: string;
  category: string;
  type: 'mcp' | 'cli' | 'local';
}

function getInitToolChoices(): InitToolChoice[] {
  // MCP tools from registry (exclude ones not useful for init: filesystem, memory, puppeteer, sqlite)
  const skipMcp = new Set(['filesystem', 'memory', 'puppeteer', 'sqlite']);
  const mcpTools: InitToolChoice[] = MCP_REGISTRY
    .filter((e) => !skipMcp.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, description: e.description, category: e.category, type: 'mcp' as const }));

  // Custom integrations
  const customTools: InitToolChoice[] = [
    { id: 'github', name: 'GitHub', description: 'Manage repos, issues, PRs (via gh CLI)', category: 'development', type: 'cli' },
    { id: 'obsidian', name: 'Obsidian', description: 'Local Obsidian vault integration', category: 'productivity', type: 'local' },
    { id: 'google-oauth', name: 'Google (Gmail, Calendar, Drive)', description: 'Google OAuth — select services after setup', category: 'productivity', type: 'local' },
  ];

  // Merge, dedup by id (custom overrides MCP for github)
  const ids = new Set<string>();
  const result: InitToolChoice[] = [];
  for (const tool of [...customTools, ...mcpTools]) {
    if (!ids.has(tool.id)) {
      ids.add(tool.id);
      result.push(tool);
    }
  }

  // Sort by category
  const catOrder: Record<string, number> = { design: 0, productivity: 1, development: 2, data: 3, communication: 4 };
  result.sort((a, b) => (catOrder[a.category] ?? 99) - (catOrder[b.category] ?? 99));
  return result;
}

async function setupIntegrations(): Promise<Partial<PilotConfig>> {
  console.log('\n── Integration Setup (optional) ──\n');

  const tools = getInitToolChoices();

  // Group by category for display
  let lastCat = '';
  const choices = tools.map((t) => {
    const separator = t.category !== lastCat
      ? new inquirer.Separator(`\n  ${t.category.charAt(0).toUpperCase() + t.category.slice(1)}`)
      : undefined;
    lastCat = t.category;
    const choice = { name: `${t.name} — ${t.description}`, value: t.id };
    return separator ? [separator, choice] : [choice];
  }).flat();

  const { selectedTools } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedTools',
      message: 'Select tools to enable (space to select, enter to confirm):',
      choices,
    },
  ]);

  const selected = new Set(selectedTools as string[]);
  const result: Partial<PilotConfig> = {};

  // Process each selected tool
  if (selected.has('github')) {
    const githubConfig = await setupGithub();
    if (githubConfig) result.github = githubConfig;
  }

  if (selected.has('obsidian')) {
    const { vaultPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'vaultPath',
        message: 'Obsidian vault path (e.g. ~/Documents/MyVault):',
        validate: (input: string) => input.length > 0 || 'Path required.',
      },
    ]);
    result.obsidian = { vaultPath };
    console.log('  Obsidian vault configured.\n');
  }

  if (selected.has('google-oauth') || selected.has('google-drive') || selected.has('gmail') || selected.has('google-calendar')) {
    console.log('\n── Google OAuth2 Setup ──\n');
    console.log('  Step 0: Configure OAuth Consent Screen');
    console.log('  ──────────────────────────────────────');
    console.log('  1. Go to https://console.cloud.google.com/apis/credentials/consent');
    console.log('  2. Select "External" user type → Create');
    console.log('  3. Fill in App name, User support email, Developer email');
    console.log('  4. Add your Google account as a Test user');
    console.log('  5. Save\n');
    console.log('  Step 1: Create OAuth Client ID');
    console.log('  ─────────────────────────────');
    console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
    console.log('  2. Click "+ CREATE CREDENTIALS" → "OAuth client ID"');
    console.log('  ⚠️  3. Application type: MUST be "Desktop app"');
    console.log('       (NOT "Web application" — this will cause a 400 error)');
    console.log('  4. Name: "Pilot-AI" (or any name you prefer)');
    console.log('  5. Click "Create" and copy the Client ID & Client Secret\n');
    console.log('  Step 2: Enable Google APIs');
    console.log('  ─────────────────────────');
    console.log('  Enable each API you want to use:');
    console.log('  • Gmail API:     https://console.cloud.google.com/apis/library/gmail.googleapis.com');
    console.log('  • Calendar API:  https://console.cloud.google.com/apis/library/calendar-json.googleapis.com');
    console.log('  • Drive API:     https://console.cloud.google.com/apis/library/drive.googleapis.com\n');

    const googleAnswers = await inquirer.prompt([
      {
        type: 'password',
        name: 'clientId',
        message: 'Google OAuth Client ID:',
        mask: '*',
        validate: (input: string) => input.length > 10 || 'Valid Client ID required.',
      },
      {
        type: 'password',
        name: 'clientSecret',
        message: 'Google OAuth Client Secret:',
        mask: '*',
        validate: (input: string) => input.length > 5 || 'Valid Client Secret required.',
      },
    ]);

    const { googleServices } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'googleServices',
        message: 'Google services:',
        choices: [
          { name: 'Gmail', value: 'gmail', checked: selected.has('gmail') || selected.has('google-oauth') },
          { name: 'Google Calendar', value: 'calendar', checked: selected.has('google-calendar') || selected.has('google-oauth') },
          { name: 'Google Drive', value: 'drive', checked: selected.has('google-drive') },
        ],
      },
    ]);

    const trimmedClientId = googleAnswers.clientId.trim();
    const trimmedClientSecret = googleAnswers.clientSecret.trim();
    await setSecret('google-client-id', trimmedClientId);
    await setSecret('google-client-secret', trimmedClientSecret);

    result.google = {
      clientId: '***keychain***',
      clientSecret: '***keychain***',
      services: googleServices as Array<'gmail' | 'calendar' | 'drive'>,
    };

    // Step 3: Auto-run OAuth authentication flow
    const services = googleServices as Array<keyof typeof GOOGLE_SCOPES>;
    await runGoogleOAuthFlow(trimmedClientId, trimmedClientSecret, services);

    // Step 4: Register Google MCP servers using obtained OAuth tokens
    const tokens = await loadGoogleTokens();

    // Write tokens for Calendar/Drive MCP servers (they manage their own token files)
    if (tokens) {
      await writeGoogleMcpTokens(tokens);
      console.log('  Google MCP tokens synced to Calendar/Drive MCP servers.');
    }

    if ((googleServices as string[]).includes('gmail') && tokens?.refreshToken) {
      // Write ~/.gmail-mcp/ credential files for file-based auth (required by @shinzolabs/gmail-mcp)
      await writeGmailMcpCredentials(trimmedClientId, trimmedClientSecret, tokens);
      console.log('  Gmail MCP credential files written to ~/.gmail-mcp/');

      const gmailMcpDir = path.join(os.homedir(), '.gmail-mcp');
      await registerMcpTool('gmail', {
        CLIENT_ID: trimmedClientId,
        CLIENT_SECRET: trimmedClientSecret,
        REFRESH_TOKEN: tokens.refreshToken,
        PORT: '3456',
        GMAIL_OAUTH_PATH: path.join(gmailMcpDir, 'gcp-oauth.keys.json'),
        GMAIL_CREDENTIALS_PATH: path.join(gmailMcpDir, 'credentials.json'),
      });
    }

    // Create shared gcp-oauth.keys.json for Calendar/Drive MCP servers
    const needsOAuthFile = (googleServices as string[]).includes('calendar') || (googleServices as string[]).includes('drive');
    let oauthCredentialsPath = '';
    if (needsOAuthFile) {
      const credDir = path.join(os.homedir(), '.pilot', 'credentials');
      await fs.mkdir(credDir, { recursive: true });
      oauthCredentialsPath = path.join(credDir, 'gcp-oauth.keys.json');
      await fs.writeFile(oauthCredentialsPath, JSON.stringify({
        installed: {
          client_id: trimmedClientId,
          client_secret: trimmedClientSecret,
          redirect_uris: ['http://127.0.0.1'],
        },
      }), 'utf-8');
    }

    if ((googleServices as string[]).includes('calendar') && oauthCredentialsPath) {
      await registerMcpTool('google-calendar', { GOOGLE_OAUTH_CREDENTIALS: oauthCredentialsPath });
    }

    if ((googleServices as string[]).includes('drive') && oauthCredentialsPath) {
      await registerMcpTool('google-drive', { GOOGLE_DRIVE_OAUTH_CREDENTIALS: oauthCredentialsPath });
    }
  }

  // MCP tools: collect credentials and register
  for (const toolId of selected) {
    if (['github', 'obsidian', 'google-oauth', 'google-drive', 'gmail', 'google-calendar'].includes(toolId)) continue;
    await collectAndRegisterMcpTool(toolId, result);
  }

  return result;
}

/** Collect credentials for an MCP tool and register it */
async function collectAndRegisterMcpTool(toolId: string, result: Partial<PilotConfig>): Promise<void> {
  const entry = MCP_REGISTRY.find((e) => e.id === toolId);
  if (!entry) return;

  const envValues: Record<string, string> = {};

  // Tool-specific setup guides and key collection
  switch (toolId) {
    case 'notion': {
      console.log('\n  Notion Integration Guide:');
      console.log('  1. Create a new Integration at https://www.notion.so/my-integrations');
      console.log('  2. Copy the Internal Integration Secret');
      console.log('  3. Add the Integration via "Connections" on your pages/DBs\n');
      const { notionApiKey } = await inquirer.prompt([{
        type: 'password', name: 'notionApiKey', message: 'Notion API Key:', mask: '*',
        validate: (input: string) => input.length > 10 || 'Valid Notion API Key required.',
      }]);
      await setSecret('notion-api-key', notionApiKey);
      envValues['OPENAPI_MCP_HEADERS'] = JSON.stringify({
        'Authorization': `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
      });
      result.notion = { apiKey: '***keychain***' };
      break;
    }
    case 'figma': {
      console.log('\n  Figma Personal Access Token Guide:');
      console.log('  1. Go to https://www.figma.com/settings');
      console.log('  2. Scroll to "Personal access tokens"');
      console.log('  3. Click "Generate new token"');
      console.log('  4. Give it a name (e.g. "Pilot-AI") and copy the token');
      console.log('  5. Token starts with figd_\n');
      const { figmaApiKey } = await inquirer.prompt([{
        type: 'password', name: 'figmaApiKey', message: 'Figma API Key (figd_...):', mask: '*',
        validate: (input: string) => input.startsWith('figd_') || 'Token must start with figd_',
      }]);
      // Verify PAT
      try {
        const verifyRes = await fetch('https://api.figma.com/v1/me', {
          headers: { 'X-Figma-Token': figmaApiKey },
        });
        if (verifyRes.ok) {
          console.log('  ✓ Figma token verified!\n');
        } else {
          console.log('  ⚠ Token verification failed. Check your token and try again later.\n');
        }
      } catch {
        console.log('  ⚠ Could not verify token (network error). Continuing anyway.\n');
      }
      await setSecret('figma-api-key', figmaApiKey);
      envValues['FIGMA_API_KEY'] = figmaApiKey;
      result.figma = { personalAccessToken: '***keychain***' };
      break;
    }
    case 'linear': {
      console.log('\n  Linear API Key Guide:');
      console.log('  1. Linear > Settings > API > Personal API keys');
      console.log('  2. Click "Create key" and copy it\n');
      const { linearApiKey } = await inquirer.prompt([{
        type: 'password', name: 'linearApiKey', message: 'Linear API Key:', mask: '*',
        validate: (input: string) => input.startsWith('lin_api_') || 'Please enter a key starting with lin_api_.',
      }]);
      await setSecret('linear-api-key', linearApiKey);
      envValues['LINEAR_API_TOKEN'] = linearApiKey;
      result.linear = { apiKey: '***keychain***' };
      break;
    }
    case 'jira':
    case 'confluence': {
      const toolLabel = toolId === 'jira' ? 'Jira' : 'Confluence';
      console.log(`\n  Atlassian ${toolLabel} Setup Guide:`);
      console.log('  1. Go to https://id.atlassian.com/manage-profile/security/api-tokens');
      console.log('  2. Click "Create API token" and copy it');
      console.log('  3. Copy your Atlassian URL (e.g. https://mycompany.atlassian.net)\n');
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
      envValues['ATLASSIAN_SITE_NAME'] = siteName;
      envValues['ATLASSIAN_USER_EMAIL'] = atlassianAnswers.email;
      envValues['ATLASSIAN_API_TOKEN'] = atlassianAnswers.apiToken;
      await setSecret(`atlassian-api-token-${toolId}`, atlassianAnswers.apiToken);
      break;
    }
    case 'slack': {
      console.log('\n  Slack MCP Setup:');
      console.log('  You need a Bot Token (xoxb-...) and your Workspace/Team ID (starts with T).');
      console.log('  Find your Team ID: open Slack in a browser → the URL shows https://app.slack.com/client/T.../...\n');
      const slackAnswers = await inquirer.prompt([
        {
          type: 'password', name: 'botToken', message: 'Slack Bot Token (xoxb-...):', mask: '*',
          validate: (i: string) => i.startsWith('xoxb-') || 'Bot Token must start with xoxb-',
        },
        {
          type: 'input', name: 'teamId', message: 'Slack Team/Workspace ID (T...):',
          validate: (i: string) => i.startsWith('T') || 'Team ID must start with T (e.g. T01ABC23DEF)',
        },
      ]);
      envValues['SLACK_BOT_TOKEN'] = slackAnswers.botToken;
      envValues['SLACK_TEAM_ID'] = slackAnswers.teamId;
      break;
    }
    case 'wiki': {
      console.log('\n  MediaWiki MCP Setup Guide:');
      console.log('  1. Create a config JSON file with your wiki URL and credentials');
      console.log('  2. Example: { "url": "https://en.wikipedia.org/w", "username": "...", "password": "..." }');
      console.log('  3. Provide the path to this config file\n');
      const { configPath } = await inquirer.prompt([{
        type: 'input', name: 'configPath', message: 'Path to MediaWiki config JSON:',
        validate: (i: string) => i.length > 0 || 'Config path required.',
      }]);
      envValues['CONFIG'] = configPath;
      break;
    }
    default: {
      // Generic MCP tool: collect all envVars from registry
      if (entry.envVars && Object.keys(entry.envVars).length > 0) {
        console.log(`\n  ${entry.name} requires the following credentials:\n`);
        for (const [key, desc] of Object.entries(entry.envVars)) {
          const { value } = await inquirer.prompt([{
            type: 'password', name: 'value', message: `${desc}:`, mask: '*',
            validate: (input: string) => input.length > 0 || `${key} is required.`,
          }]);
          envValues[key] = value;
        }
      }
      break;
    }
  }

  await registerMcpTool(toolId, envValues);
}

/** Register an MCP tool with error handling */
export async function registerMcpTool(toolId: string, envValues: Record<string, string>): Promise<boolean> {
  try {
    const result = await installMcpServer(toolId, envValues, { skipVerify: true });
    if (!result.success) {
      console.log(`  MCP registration failed for ${toolId} (${result.error ?? 'unknown error'}). You can add it later with: pilot-ai addtool ${toolId}`);
      return false;
    }
    const entry = MCP_REGISTRY.find((e) => e.id === toolId);
    console.log(`  ${entry?.name ?? toolId} configured (MCP server registered).`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  MCP registration failed for ${toolId} (${msg}). You can add it later with: pilot-ai addtool ${toolId}`);
    return false;
  }
}

async function setupGithub(): Promise<PilotConfig['github'] | null> {
  const { setupGh } = await inquirer.prompt([
    { type: 'confirm', name: 'setupGh', message: 'Set up GitHub Integration?', default: true },
  ]);
  if (!setupGh) return null;

  // Check if gh CLI is installed
  try {
    await execFileAsync('which', ['gh']);
  } catch {
    console.log('\n  GitHub CLI (gh) is not installed.');
    console.log('  Install it with: brew install gh');
    console.log('  Skipping GitHub setup.\n');
    return null;
  }

  console.log('  GitHub CLI detected.');

  // Check if already authenticated
  const authed = await isGhAuthenticated();
  if (authed) {
    console.log('  Already authenticated!\n');
    return { enabled: true };
  }

  // Guide user to authenticate
  console.log('\n  GitHub CLI is not authenticated. Please run:\n');
  console.log('    gh auth login --scopes repo,read:org,workflow\n');
  console.log('  Complete the login in your browser, then press Enter to continue.\n');

  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: 'Press Enter after completing gh auth login...',
    },
  ]);

  // Verify authentication
  const authedNow = await isGhAuthenticated();
  if (authedNow) {
    console.log('  GitHub authenticated successfully!\n');
    return { enabled: true };
  }

  console.log('  Warning: GitHub authentication not detected. You can run "gh auth login" later.\n');
  return { enabled: false };
}

/**
 * Runs the Google OAuth loopback flow after credential entry.
 * On failure, prints guidance to run `pilot-ai auth google` later (does not abort init).
 */
async function runGoogleOAuthFlow(
  clientId: string,
  clientSecret: string,
  services: Array<keyof typeof GOOGLE_SCOPES>,
): Promise<void> {
  console.log('\n  Step 3: Authenticate with Google');
  console.log('  ────────────────────────────────');

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
      console.log('  Opening browser for Google sign-in...');
      console.log(`  (If the browser doesn't open, visit: ${authUrl})\n`);
      exec(`open "${authUrl}"`);

      console.log('  Waiting for authorization...');
      const { code, state: returnedState } = await server.waitForCode();
      if (returnedState !== expectedState) {
        throw new Error('OAuth state mismatch — possible CSRF attack. Please try again.');
      }

      console.log('  Exchanging authorization code for tokens...');
      const tokens = await exchangeGoogleCode(code, services, server.redirectUri, codeVerifier);

      const valid = await verifyGoogleTokens(tokens.accessToken);
      if (valid) {
        console.log(`  ✓ Google authenticated and verified! (${services.join(', ')})\n`);
      } else {
        console.log(`  ⚠ Tokens saved but verification failed. Try: pilot-ai auth google\n`);
      }

      // Warn about Testing mode token expiry
      console.log('  ⚠ IMPORTANT: If your Google Cloud OAuth app is in "Testing" mode,');
      console.log('  refresh tokens expire after 7 days and ALL Google integrations will break.');
      console.log('  To fix permanently:');
      console.log('    1. Go to https://console.cloud.google.com/apis/credentials/consent');
      console.log('    2. Click "PUBLISH APP"');
      console.log('    3. For personal use (<100 users), no Google review is needed.');
      console.log('  If you stay in Testing mode, re-run "pilot-ai auth google" every 7 days.\n');
    } finally {
      server.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ Google authentication failed: ${msg}`);
    console.log('  You can authenticate later with: pilot-ai auth google\n');
  }
}

async function installPlaywright(): Promise<void> {
  const { install } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'install',
      message: 'Install Playwright Chromium browser? (required for browser automation)',
      default: true,
    },
  ]);

  if (!install) {
    console.log('  Skipping Playwright install. Run "npx playwright install chromium" later.\n');
    return;
  }

  console.log('  Installing Playwright Chromium...');
  try {
    await execFileAsync('npx', ['playwright', 'install', 'chromium'], { timeout: 300_000 });
    console.log('  Playwright Chromium installed.\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  Warning: Playwright install failed (${msg}). Run "npx playwright install chromium" manually.\n`);
  }
}
