import { describe, it, expect } from 'vitest';
import { isAuthorizedUser } from '../../src/security/auth.js';
import type { IncomingMessage } from '../../src/messenger/adapter.js';
import type { PilotConfig } from '../../src/config/schema.js';

const config = {
  security: {
    allowedUsers: {
      slack: ['U_ALLOWED'],
      telegram: ['123456'],
    },
  },
} as PilotConfig;

function makeMsg(overrides: Partial<IncomingMessage>): IncomingMessage {
  return {
    platform: 'slack',
    userId: 'U_ALLOWED',
    channelId: 'C1',
    text: 'test',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('isAuthorizedUser', () => {
  it('허용된 Slack 사용자는 true', () => {
    expect(isAuthorizedUser(makeMsg({ platform: 'slack', userId: 'U_ALLOWED' }), config)).toBe(true);
  });

  it('허용되지 않은 Slack 사용자는 false', () => {
    expect(isAuthorizedUser(makeMsg({ platform: 'slack', userId: 'U_HACKER' }), config)).toBe(false);
  });

  it('허용된 Telegram 사용자는 true', () => {
    expect(isAuthorizedUser(makeMsg({ platform: 'telegram', userId: '123456' }), config)).toBe(true);
  });

  it('허용되지 않은 Telegram 사용자는 false', () => {
    expect(isAuthorizedUser(makeMsg({ platform: 'telegram', userId: '999999' }), config)).toBe(false);
  });
});
