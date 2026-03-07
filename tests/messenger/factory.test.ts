import { describe, it, expect } from 'vitest';
import { createMessengerAdapter } from '../../src/messenger/factory.js';
import { SlackAdapter } from '../../src/messenger/slack.js';
import { TelegramAdapter } from '../../src/messenger/telegram.js';
import type { PilotConfig } from '../../src/config/schema.js';

function makeConfig(overrides: Partial<PilotConfig['messenger']>): PilotConfig {
  return {
    claude: { mode: 'cli', cliBinary: 'claude', apiKey: null },
    messenger: { platform: 'slack', ...overrides } as PilotConfig['messenger'],
    safety: { dangerousActionsRequireApproval: true, approvalTimeoutMinutes: 30 },
    security: {
      allowedUsers: { slack: [], telegram: [] },
      dmOnly: true,
      filesystemSandbox: { allowedPaths: ['~'], blockedPaths: [] },
      auditLog: { enabled: true, path: '~/.pilot/logs/audit.jsonl', maskSecrets: true },
    },
  };
}

describe('createMessengerAdapter', () => {
  it('Slack 설정이면 SlackAdapter를 생성한다', () => {
    const config = makeConfig({
      platform: 'slack',
      slack: { botToken: 'xoxb-test', appToken: 'xapp-test', signingSecret: 'secret' },
    });
    const adapter = createMessengerAdapter(config);
    expect(adapter).toBeInstanceOf(SlackAdapter);
  });

  it('Telegram 설정이면 TelegramAdapter를 생성한다', () => {
    const config = makeConfig({
      platform: 'telegram',
      telegram: { botToken: 'bot123:ABC' },
    });
    const adapter = createMessengerAdapter(config);
    expect(adapter).toBeInstanceOf(TelegramAdapter);
  });

  it('Slack 설정 없이 slack 플랫폼이면 에러를 던진다', () => {
    const config = makeConfig({ platform: 'slack' });
    delete (config.messenger as Record<string, unknown>).slack;
    expect(() => createMessengerAdapter(config)).toThrow('Slack 설정이 없습니다');
  });

  it('Telegram 설정 없이 telegram 플랫폼이면 에러를 던진다', () => {
    const config = makeConfig({ platform: 'telegram' });
    expect(() => createMessengerAdapter(config)).toThrow('Telegram 설정이 없습니다');
  });
});
