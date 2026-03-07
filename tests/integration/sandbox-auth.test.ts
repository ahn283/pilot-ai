import { describe, it, expect } from 'vitest';
import { isAuthorizedUser } from '../../src/security/auth.js';
import { isPathAllowed, isCommandBlocked } from '../../src/security/sandbox.js';
import type { PilotConfig } from '../../src/config/schema.js';
import type { IncomingMessage } from '../../src/messenger/adapter.js';

const config = {
  claude: { mode: 'cli' as const, cliBinary: 'claude', apiKey: null },
  messenger: { platform: 'slack' as const },
  safety: { dangerousActionsRequireApproval: true, approvalTimeoutMinutes: 30 },
  security: {
    allowedUsers: { slack: ['U_OWNER'], telegram: ['12345'] },
    dmOnly: true,
    filesystemSandbox: {
      allowedPaths: ['/Users/me/projects'],
      blockedPaths: ['/Users/me/.ssh', '/Users/me/.pilot'],
    },
    auditLog: { enabled: true, path: '~/.pilot/logs/audit.jsonl', maskSecrets: true },
  },
} as PilotConfig;

describe('보안 통합: 인증 + sandbox', () => {
  it('Slack 인가 사용자를 허용한다', () => {
    const msg: IncomingMessage = {
      platform: 'slack', userId: 'U_OWNER', channelId: 'C1', text: 'hi',
    };
    expect(isAuthorizedUser(msg, config)).toBe(true);
  });

  it('Slack 비인가 사용자를 차단한다', () => {
    const msg: IncomingMessage = {
      platform: 'slack', userId: 'U_ATTACKER', channelId: 'C1', text: 'hi',
    };
    expect(isAuthorizedUser(msg, config)).toBe(false);
  });

  it('Telegram 인가 사용자를 허용한다', () => {
    const msg: IncomingMessage = {
      platform: 'telegram', userId: '12345', channelId: '12345', text: 'hi',
    };
    expect(isAuthorizedUser(msg, config)).toBe(true);
  });

  it('허용된 경로 접근을 허용한다', () => {
    expect(isPathAllowed('/Users/me/projects/api/src/index.ts', config)).toBe(true);
  });

  it('차단된 경로 접근을 차단한다', () => {
    expect(isPathAllowed('/Users/me/.ssh/id_rsa', config)).toBe(false);
    expect(isPathAllowed('/Users/me/.pilot/config.json', config)).toBe(false);
  });

  it('path traversal을 방지한다', () => {
    expect(isPathAllowed('/Users/me/projects/../.ssh/id_rsa', config)).toBe(false);
  });

  it('위험 명령어를 차단한다', () => {
    expect(isCommandBlocked('rm -rf /')).toBe(true);
  });

  it('일반 명령어를 허용한다', () => {
    expect(isCommandBlocked('ls -la')).toBe(false);
  });
});
