import inquirer from 'inquirer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkClaudeCli } from '../agent/claude.js';
import { saveConfig, ensurePilotDir } from '../config/store.js';
import { setSecret } from '../config/keychain.js';
import type { PilotConfig } from '../config/schema.js';
import { defaultConfig } from '../config/schema.js';
import { testSlackConnection, testTelegramConnection } from './connection-test.js';

const execFileAsync = promisify(execFile);

export async function runInit(): Promise<void> {
  console.log('\n🚀 Pilot-AI 셋업을 시작합니다.\n');

  await ensurePilotDir();

  // 1. Claude 연결
  const claudeConfig = await setupClaude();

  // 2. 메신저 선택 및 설정
  const messengerConfig = await setupMessenger();

  // 3. 선택적 통합 서비스 설정
  const integrationConfig = await setupIntegrations();

  // 4. Playwright 브라우저 설치
  await installPlaywright();

  // 5. 설정 저장
  const config: Partial<PilotConfig> = {
    ...defaultConfig,
    claude: claudeConfig,
    messenger: messengerConfig,
    ...integrationConfig,
  };

  await saveConfig(config);

  console.log('\n✅ 설정 완료! "npx pilot-ai start"로 에이전트를 시작하세요.\n');
}

async function setupClaude(): Promise<PilotConfig['claude']> {
  console.log('── Claude 연결 ──\n');

  const cliExists = await checkClaudeCli();

  if (cliExists) {
    console.log('✅ Claude Code CLI가 설치되어 있습니다.\n');

    const { useApi } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useApi',
        message: 'API Key 모드를 대신 사용하시겠습니까? (기본: CLI 모드)',
        default: false,
      },
    ]);

    if (!useApi) {
      return { mode: 'cli', cliBinary: 'claude', apiKey: null };
    }
  } else {
    console.log('⚠️  Claude Code CLI를 찾을 수 없습니다. API Key 모드로 설정합니다.\n');
    console.log('  CLI 설치: npm install -g @anthropic-ai/claude-code\n');
  }

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Anthropic API Key를 입력하세요:',
      mask: '*',
      validate: (input: string) => input.startsWith('sk-') || 'sk-로 시작하는 유효한 API Key를 입력하세요.',
    },
  ]);

  await setSecret('anthropic-api-key', apiKey);
  return { mode: 'api', cliBinary: 'claude', apiKey: '***keychain***' };
}

async function setupMessenger(): Promise<PilotConfig['messenger']> {
  console.log('\n── 메신저 설정 ──\n');

  const { platform } = await inquirer.prompt([
    {
      type: 'list',
      name: 'platform',
      message: '사용할 메신저를 선택하세요:',
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
  console.log('\n📋 Slack App 설정 가이드:');
  console.log('  1. https://api.slack.com/apps 에서 새 App 생성');
  console.log('  2. Socket Mode 활성화');
  console.log('  3. Event Subscriptions → message.im 추가');
  console.log('  4. OAuth & Permissions → chat:write, im:history 추가');
  console.log('  5. App을 워크스페이스에 설치\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Bot Token (xoxb-...):',
      mask: '*',
      validate: (input: string) => input.startsWith('xoxb-') || 'xoxb-로 시작하는 토큰을 입력하세요.',
    },
    {
      type: 'password',
      name: 'appToken',
      message: 'App-Level Token (xapp-...):',
      mask: '*',
      validate: (input: string) => input.startsWith('xapp-') || 'xapp-로 시작하는 토큰을 입력하세요.',
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
      message: '허용할 Slack User ID (본인):',
      validate: (input: string) => input.startsWith('U') || 'U로 시작하는 User ID를 입력하세요.',
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
  console.log('\n📋 Telegram Bot 설정 가이드:');
  console.log('  1. Telegram에서 @BotFather에게 /newbot 명령');
  console.log('  2. Bot 이름과 username 설정');
  console.log('  3. 발급된 Bot Token 복사\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Bot Token:',
      mask: '*',
      validate: (input: string) => /^\d+:/.test(input) || '유효한 Telegram Bot Token을 입력하세요.',
    },
    {
      type: 'input',
      name: 'chatId',
      message: '허용할 Telegram Chat ID (본인):',
      validate: (input: string) => /^\d+$/.test(input) || '숫자로 된 Chat ID를 입력하세요.',
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
  console.log('\n── 통합 서비스 설정 (선택) ──\n');

  const result: Partial<PilotConfig> = {};

  // Notion
  const { setupNotion } = await inquirer.prompt([
    { type: 'confirm', name: 'setupNotion', message: 'Notion Integration을 설정하시겠습니까?', default: false },
  ]);
  if (setupNotion) {
    console.log('\n📋 Notion Integration 가이드:');
    console.log('  1. https://www.notion.so/my-integrations 에서 새 Integration 생성');
    console.log('  2. 이름 설정 후 "Submit" 클릭');
    console.log('  3. Internal Integration Secret 복사');
    console.log('  4. 연동할 페이지/DB에서 "Connections"로 Integration 추가\n');

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
    { type: 'confirm', name: 'setupObsidian', message: 'Obsidian vault를 설정하시겠습니까?', default: false },
  ]);
  if (setupObsidian) {
    const { vaultPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'vaultPath',
        message: 'Obsidian vault 경로 (예: ~/Documents/MyVault):',
        validate: (input: string) => input.length > 0 || 'Path required.',
      },
    ]);
    result.obsidian = { vaultPath };
    console.log('  Obsidian vault configured.\n');
  }

  // Figma
  const { setupFigma } = await inquirer.prompt([
    { type: 'confirm', name: 'setupFigma', message: 'Figma를 설정하시겠습니까?', default: false },
  ]);
  if (setupFigma) {
    console.log('\n📋 Figma Personal Access Token 가이드:');
    console.log('  1. Figma > Account Settings > Personal access tokens');
    console.log('  2. "Generate new token" 클릭 후 복사\n');

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
    result.figma = { personalAccessToken: '***keychain***' };
    console.log('  Figma configured.\n');
  }

  // Linear
  const { setupLinear } = await inquirer.prompt([
    { type: 'confirm', name: 'setupLinear', message: 'Linear를 설정하시겠습니까?', default: false },
  ]);
  if (setupLinear) {
    console.log('\n📋 Linear API Key 가이드:');
    console.log('  1. Linear > Settings > API > Personal API keys');
    console.log('  2. "Create key" 클릭 후 복사\n');

    const { linearApiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'linearApiKey',
        message: 'Linear API Key:',
        mask: '*',
        validate: (input: string) => input.startsWith('lin_api_') || 'lin_api_로 시작하는 키를 입력하세요.',
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
      message: 'Playwright Chromium 브라우저를 설치하시겠습니까? (브라우저 자동화에 필요)',
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
