import inquirer from 'inquirer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkClaudeCli, checkClaudeCliAuth } from '../agent/claude.js';
import { saveConfig, ensurePilotDir } from '../config/store.js';
import { setSecret } from '../config/keychain.js';
import type { PilotConfig } from '../config/schema.js';
import { defaultConfig } from '../config/schema.js';
import { testSlackConnection, testTelegramConnection } from './connection-test.js';
import { registerFigmaMcp } from '../tools/figma-mcp.js';
import { installMcpServer } from '../agent/mcp-manager.js';
import { requestPermissions, triggerBulkAutomationPermissions } from '../security/permissions.js';
import { isGhAuthenticated } from '../tools/github.js';

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
    console.log('Claude Code CLI not found. Configuring API Key mode.\n');
    console.log('  Install CLI: npm install -g @anthropic-ai/claude-code\n');
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

async function setupIntegrations(): Promise<Partial<PilotConfig>> {
  console.log('\n── Integration Setup (optional) ──\n');

  const result: Partial<PilotConfig> = {};

  // GitHub
  const githubConfig = await setupGithub();
  if (githubConfig) {
    result.github = githubConfig;
  }

  // Notion
  const { setupNotion } = await inquirer.prompt([
    { type: 'confirm', name: 'setupNotion', message: 'Set up Notion Integration?', default: false },
  ]);
  if (setupNotion) {
    console.log('\n📋 Notion Integration Guide:');
    console.log('  1. Create a new Integration at https://www.notion.so/my-integrations');
    console.log('  2. Set a name and click "Submit"');
    console.log('  3. Copy the Internal Integration Secret');
    console.log('  4. Add the Integration via "Connections" on the pages/DBs you want to use\n');

    const { notionApiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'notionApiKey',
        message: 'Notion API Key (ntn_ or secret_...):',
        mask: '*',
        validate: (input: string) => input.length > 10 || 'Valid Notion API Key required.',
      },
    ]);
    await setSecret('notion-api-key', notionApiKey);
    try {
      await installMcpServer('notion', {
        OPENAPI_MCP_HEADERS: JSON.stringify({
          'Authorization': `Bearer ${notionApiKey}`,
          'Notion-Version': '2022-06-28',
        }),
      }, { skipVerify: true });
      console.log('  Notion configured (MCP server registered).\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Notion key saved, but MCP registration failed (${msg}). You can register it later.\n`);
    }
    result.notion = { apiKey: '***keychain***' };
  }

  // Obsidian
  const { setupObsidian } = await inquirer.prompt([
    { type: 'confirm', name: 'setupObsidian', message: 'Set up Obsidian vault?', default: false },
  ]);
  if (setupObsidian) {
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

  // Figma
  const { setupFigma } = await inquirer.prompt([
    { type: 'confirm', name: 'setupFigma', message: 'Set up Figma?', default: false },
  ]);
  if (setupFigma) {
    console.log('\n📋 Figma Personal Access Token Guide:');
    console.log('  1. Figma > Account Settings > Personal access tokens');
    console.log('  2. Click "Generate new token" and copy it\n');

    const { figmaToken } = await inquirer.prompt([
      {
        type: 'password',
        name: 'figmaToken',
        message: 'Figma Personal Access Token:',
        mask: '*',
        validate: (input: string) => input.length > 10 || 'Valid Figma token required.',
      },
    ]);
    await setSecret('figma-personal-access-token', figmaToken);
    try {
      await installMcpServer('figma', {
        FIGMA_PERSONAL_ACCESS_TOKEN: figmaToken,
      }, { skipVerify: true });
      console.log('  Figma configured (MCP server registered).\n');
    } catch (err) {
      // Fallback to legacy registration
      await registerFigmaMcp(figmaToken);
      console.log('  Figma configured (MCP server registered via fallback).\n');
    }
    result.figma = { personalAccessToken: '***keychain***' };
  }

  // Google (Gmail, Calendar, Drive)
  const { setupGoogle } = await inquirer.prompt([
    { type: 'confirm', name: 'setupGoogle', message: 'Set up Google (Gmail, Calendar, Drive)?', default: false },
  ]);
  if (setupGoogle) {
    console.log('\n📋 Google OAuth2 Setup Guide:');
    console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
    console.log('  2. Create a new OAuth 2.0 Client ID (Desktop app)');
    console.log('  3. Enable these APIs in your project:');
    console.log('     - Gmail API');
    console.log('     - Google Calendar API');
    console.log('     - Google Drive API');
    console.log('  4. Copy the Client ID and Client Secret\n');

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

    console.log('\n  Select which Google services to enable:\n');
    const { googleServices } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'googleServices',
        message: 'Google services:',
        choices: [
          { name: 'Gmail', value: 'gmail', checked: true },
          { name: 'Google Calendar', value: 'calendar', checked: true },
          { name: 'Google Drive', value: 'drive', checked: true },
        ],
      },
    ]);

    await setSecret('google-client-id', googleAnswers.clientId);
    await setSecret('google-client-secret', googleAnswers.clientSecret);

    // Register Google Drive MCP if drive service is selected
    if ((googleServices as string[]).includes('drive')) {
      try {
        await installMcpServer('google-drive', {
          GOOGLE_CLIENT_ID: googleAnswers.clientId,
          GOOGLE_CLIENT_SECRET: googleAnswers.clientSecret,
        }, { skipVerify: true });
        console.log('  Google Drive MCP server registered.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  Google Drive MCP registration failed (${msg}). You can register it later.`);
      }
    }

    result.google = {
      clientId: '***keychain***',
      clientSecret: '***keychain***',
      services: googleServices as Array<'gmail' | 'calendar' | 'drive'>,
    };

    console.log(`  Google configured (${(googleServices as string[]).join(', ')}).`);
    console.log('  OAuth token setup will happen on first use via chat.\n');
  }

  // Linear
  const { setupLinear } = await inquirer.prompt([
    { type: 'confirm', name: 'setupLinear', message: 'Set up Linear?', default: false },
  ]);
  if (setupLinear) {
    console.log('\n📋 Linear API Key Guide:');
    console.log('  1. Linear > Settings > API > Personal API keys');
    console.log('  2. Click "Create key" and copy it\n');

    const { linearApiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'linearApiKey',
        message: 'Linear API Key:',
        mask: '*',
        validate: (input: string) => input.startsWith('lin_api_') || 'Please enter a key starting with lin_api_.',
      },
    ]);
    await setSecret('linear-api-key', linearApiKey);
    try {
      await installMcpServer('linear', {
        LINEAR_API_KEY: linearApiKey,
      }, { skipVerify: true });
      console.log('  Linear configured (MCP server registered).\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Linear key saved, but MCP registration failed (${msg}). You can register it later.\n`);
    }
    result.linear = { apiKey: '***keychain***' };
  }

  return result;
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
