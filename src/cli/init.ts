import inquirer from 'inquirer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkClaudeCli } from '../agent/claude.js';
import { saveConfig, ensurePilotDir } from '../config/store.js';
import { setSecret } from '../config/keychain.js';
import type { PilotConfig } from '../config/schema.js';
import { defaultConfig } from '../config/schema.js';
import { testSlackConnection, testTelegramConnection } from './connection-test.js';
import { registerFigmaMcp } from '../tools/figma-mcp.js';

const execFileAsync = promisify(execFile);

export async function runInit(): Promise<void> {
  console.log('\nStarting Pilot-AI setup.\n');

  await ensurePilotDir();

  // 1. Claude connection
  const claudeConfig = await setupClaude();

  // 2. Messenger setup
  const messengerConfig = await setupMessenger();

  // 3. Optional integrations
  const integrationConfig = await setupIntegrations();

  // 4. Playwright browser install
  await installPlaywright();

  // 5. Save config
  const config: Partial<PilotConfig> = {
    ...defaultConfig,
    claude: claudeConfig,
    messenger: messengerConfig,
    ...integrationConfig,
  };

  await saveConfig(config);

  console.log('\nSetup complete! Run "npx pilot-ai start" to start the agent.\n');
}

async function setupClaude(): Promise<PilotConfig['claude']> {
  console.log('── Claude Connection ──\n');

  const cliExists = await checkClaudeCli();

  if (cliExists) {
    console.log('Claude Code CLI is installed.\n');

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

async function setupMessenger(): Promise<PilotConfig['messenger']> {
  console.log('\n── Messenger Setup ──\n');

  const { platform } = await inquirer.prompt([
    {
      type: 'list',
      name: 'platform',
      message: 'Select messenger platform:',
      choices: [
        { name: 'Slack', value: 'slack' },
        { name: 'Telegram', value: 'telegram' },
      ],
    },
  ]);

  if (platform === 'slack') {
    return setupSlack();
  }
  return setupTelegram();
}

async function setupSlack(): Promise<PilotConfig['messenger']> {
  console.log('\n📋 Slack App Setup Guide:');
  console.log('  1. Create a new App at https://api.slack.com/apps');
  console.log('  2. Enable Socket Mode');
  console.log('  3. Event Subscriptions → Subscribe to bot events: message.im');
  console.log('  4. OAuth & Permissions → Bot Token Scopes:');
  console.log('     chat:write, im:history, im:read, im:write');
  console.log('  5. App Home → Messages Tab: turn ON');
  console.log('  6. Install the App to your workspace\n');

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
    platform: 'slack',
    slack: {
      botToken: '***keychain***',
      appToken: '***keychain***',
      signingSecret: '***keychain***',
    },
  };
}

async function setupTelegram(): Promise<PilotConfig['messenger']> {
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
    platform: 'telegram',
    telegram: {
      botToken: '***keychain***',
    },
  };
}

async function setupIntegrations(): Promise<Partial<PilotConfig>> {
  console.log('\n── Integration Setup (optional) ──\n');

  const result: Partial<PilotConfig> = {};

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
    result.notion = { apiKey: '***keychain***' };
    console.log('  Notion configured.\n');
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
    await registerFigmaMcp(figmaToken);
    result.figma = { personalAccessToken: '***keychain***' };
    console.log('  Figma configured (MCP server registered).\n');
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
    result.linear = { apiKey: '***keychain***' };
    console.log('  Linear configured.\n');
  }

  return result;
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
