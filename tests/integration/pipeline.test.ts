import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { IncomingMessage, MessengerAdapter, MessageHandler, ApprovalHandler } from '../../src/messenger/adapter.js';
import type { PilotConfig } from '../../src/config/schema.js';

const testDir = path.join(os.tmpdir(), `pilot-integration-${Date.now()}`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, default: { ...actual, homedir: () => testDir }, homedir: () => testDir };
});

// Mock Claude CLI
vi.mock('../../src/agent/claude.js', () => ({
  invokeClaudeCli: vi.fn().mockResolvedValue({ result: 'Claude 응답입니다.' }),
  invokeClaudeApi: vi.fn().mockResolvedValue('API 응답입니다.'),
  checkClaudeCli: vi.fn().mockResolvedValue(true),
}));

const { AgentCore } = await import('../../src/agent/core.js');
const { invokeClaudeCli, invokeClaudeApi } = await import('../../src/agent/claude.js');

beforeEach(async () => {
  await fs.mkdir(path.join(testDir, '.pilot', 'logs'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'projects'), { recursive: true });
  await fs.mkdir(path.join(testDir, '.pilot', 'memory', 'history'), { recursive: true });
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function createMockMessenger(): MessengerAdapter & {
  triggerMessage: (msg: IncomingMessage) => Promise<void>;
  triggerApproval: (taskId: string, approved: boolean) => void;
  sentMessages: { channelId: string; text: string; threadId?: string }[];
} {
  let messageHandler: MessageHandler | null = null;
  let approvalHandler: ApprovalHandler | null = null;
  const sentMessages: { channelId: string; text: string; threadId?: string }[] = [];

  return {
    sentMessages,
    onMessage(handler: MessageHandler) { messageHandler = handler; },
    onApproval(handler: ApprovalHandler) { approvalHandler = handler; },
    async start() {},
    async stop() {},
    async sendText(channelId: string, text: string, threadId?: string) {
      sentMessages.push({ channelId, text, threadId });
    },
    async sendApprovalRequest() { return 'approval-msg-1'; },
    async triggerMessage(msg: IncomingMessage) {
      if (messageHandler) await messageHandler(msg);
    },
    triggerApproval(taskId: string, approved: boolean) {
      if (approvalHandler) approvalHandler(taskId, approved);
    },
  };
}

function createConfig(overrides: Partial<PilotConfig> = {}): PilotConfig {
  return {
    claude: { mode: 'cli', cliBinary: 'claude', apiKey: null },
    messenger: { platform: 'slack', slack: { botToken: 'x', appToken: 'x', signingSecret: 'x' } },
    safety: {
      dangerousActionsRequireApproval: true,
      approvalTimeoutMinutes: 30,
    },
    security: {
      allowedUsers: { slack: ['U_ALLOWED'], telegram: [] },
      dmOnly: true,
      filesystemSandbox: { allowedPaths: ['/home'], blockedPaths: [] },
      auditLog: { enabled: true, path: '~/.pilot/logs/audit.jsonl', maskSecrets: true },
    },
    ...overrides,
  } as PilotConfig;
}

describe('메신저 → Claude → 응답 전체 파이프라인', () => {
  it('인가된 사용자의 메시지를 Claude로 전달하고 응답을 반환한다', async () => {
    const messenger = createMockMessenger();
    const config = createConfig();
    new AgentCore(messenger, config);

    await messenger.triggerMessage({
      platform: 'slack',
      userId: 'U_ALLOWED',
      channelId: 'C123',
      text: '파일 목록 보여줘',
      threadId: 'T1',
    });

    expect(invokeClaudeCli).toHaveBeenCalled();
    expect(messenger.sentMessages).toHaveLength(1);
    expect(messenger.sentMessages[0].text).toBe('Claude 응답입니다.');
    expect(messenger.sentMessages[0].threadId).toBe('T1');
  });

  it('API 모드에서는 invokeClaudeApi를 호출한다', async () => {
    const messenger = createMockMessenger();
    const config = createConfig({
      claude: { mode: 'api', cliBinary: 'claude', apiKey: 'sk-test' },
    });
    new AgentCore(messenger, config);

    await messenger.triggerMessage({
      platform: 'slack',
      userId: 'U_ALLOWED',
      channelId: 'C123',
      text: 'hello',
    });

    expect(invokeClaudeApi).toHaveBeenCalled();
    expect(messenger.sentMessages[0].text).toBe('API 응답입니다.');
  });
});

describe('보안: 비인가 사용자 차단', () => {
  it('인가되지 않은 사용자의 메시지를 무시한다', async () => {
    const messenger = createMockMessenger();
    const config = createConfig();
    new AgentCore(messenger, config);

    await messenger.triggerMessage({
      platform: 'slack',
      userId: 'U_HACKER',
      channelId: 'C123',
      text: 'rm -rf /',
    });

    expect(invokeClaudeCli).not.toHaveBeenCalled();
    expect(messenger.sentMessages).toHaveLength(0);
  });

  it('차단된 사용자의 시도를 감사 로그에 기록한다', async () => {
    const messenger = createMockMessenger();
    const config = createConfig();
    new AgentCore(messenger, config);

    await messenger.triggerMessage({
      platform: 'slack',
      userId: 'U_HACKER',
      channelId: 'C123',
      text: '민감한 명령',
    });

    const auditPath = path.join(testDir, '.pilot', 'logs', 'audit.jsonl');
    const content = await fs.readFile(auditPath, 'utf-8');
    expect(content).toContain('[BLOCKED]');
    expect(content).toContain('U_HACKER');
  });
});

describe('에러 핸들링', () => {
  it('Claude 호출 실패 시 에러 메시지를 전송한다', async () => {
    vi.mocked(invokeClaudeCli).mockRejectedValueOnce(new Error('CLI timeout'));
    const messenger = createMockMessenger();
    const config = createConfig();
    new AgentCore(messenger, config);

    await messenger.triggerMessage({
      platform: 'slack',
      userId: 'U_ALLOWED',
      channelId: 'C123',
      text: '작업 요청',
    });

    expect(messenger.sentMessages).toHaveLength(1);
    expect(messenger.sentMessages[0].text).toContain('오류가 발생했습니다');
    expect(messenger.sentMessages[0].text).toContain('CLI timeout');
  });
});
