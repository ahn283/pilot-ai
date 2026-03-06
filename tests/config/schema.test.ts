import { describe, it, expect } from 'vitest';
import { configSchema } from '../../src/config/schema.js';

describe('configSchema', () => {
  const validConfig = {
    claude: { mode: 'cli', cliBinary: 'claude', apiKey: null },
    messenger: { platform: 'slack', slack: { botToken: 'xoxb-test', appToken: 'xapp-test', signingSecret: 'secret' } },
    safety: { dangerousActionsRequireApproval: true, approvalTimeoutMinutes: 30 },
    security: {
      allowedUsers: { slack: ['U123'], telegram: [] },
      dmOnly: true,
      filesystemSandbox: { allowedPaths: ['~'], blockedPaths: ['~/.ssh'] },
      auditLog: { enabled: true, path: '~/.pilot/logs/audit.jsonl', maskSecrets: true },
    },
  };

  it('유효한 설정을 파싱한다', () => {
    const result = configSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('claude.mode에 잘못된 값이면 실패한다', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      claude: { ...validConfig.claude, mode: 'invalid' },
    });
    expect(result.success).toBe(false);
  });

  it('messenger.platform이 없으면 실패한다', () => {
    const result = configSchema.safeParse({
      ...validConfig,
      messenger: {},
    });
    expect(result.success).toBe(false);
  });

  it('telegram 설정도 파싱한다', () => {
    const telegramConfig = {
      ...validConfig,
      messenger: { platform: 'telegram' as const, telegram: { botToken: 'bot123:ABC' } },
    };
    const result = configSchema.safeParse(telegramConfig);
    expect(result.success).toBe(true);
  });

  it('security.allowedUsers 기본값이 빈 배열이다', () => {
    const config = {
      ...validConfig,
      security: {
        ...validConfig.security,
        allowedUsers: { slack: [], telegram: [] },
      },
    };
    const result = configSchema.parse(config);
    expect(result.security.allowedUsers.slack).toEqual([]);
    expect(result.security.allowedUsers.telegram).toEqual([]);
  });
});
