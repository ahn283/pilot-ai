import inquirer from 'inquirer';
import { checkClaudeCli } from '../agent/claude.js';
import { saveConfig, ensurePilotDir } from '../config/store.js';
import { setSecret } from '../config/keychain.js';
import type { PilotConfig } from '../config/schema.js';
import { defaultConfig } from '../config/schema.js';
import { testSlackConnection, testTelegramConnection } from './connection-test.js';

export async function runInit(): Promise<void> {
  console.log('\n🚀 Pilot-AI 셋업을 시작합니다.\n');

  await ensurePilotDir();

  // 1. Claude 연결
  const claudeConfig = await setupClaude();

  // 2. 메신저 선택 및 설정
  const messengerConfig = await setupMessenger();

  // 3. 설정 저장
  const config: Partial<PilotConfig> = {
    ...defaultConfig,
    claude: claudeConfig,
    messenger: messengerConfig,
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
  const slackTest = await testSlackConnection(answers.botToken);
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
  const telegramTest = await testTelegramConnection(answers.botToken);
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
