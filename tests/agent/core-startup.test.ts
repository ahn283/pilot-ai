import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all heavy dependencies before importing
vi.mock('../../src/messenger/adapter.js', () => ({}));

vi.mock('../../src/tools/google-auth.js', () => ({
  configureGoogle: vi.fn(),
  loadGoogleTokens: vi.fn(),
}));

vi.mock('../../src/agent/token-refresher.js', () => ({
  startTokenRefresher: vi.fn(),
  stopTokenRefresher: vi.fn(),
  isTokenRefresherRunning: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/tools/figma-mcp.js', () => ({
  loadMcpConfig: vi.fn().mockResolvedValue({ mcpServers: {} }),
  getMcpConfigPathIfExists: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/agent/mcp-manager.js', () => ({
  buildMcpContext: vi.fn().mockResolvedValue(null),
  migrateToSecureLaunchers: vi.fn().mockResolvedValue({ migrated: [], skipped: [] }),
  checkAllMcpServerStatus: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/tools/github.js', () => ({
  isGhAuthenticated: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/security/permissions.js', () => ({
  PermissionWatcher: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })),
  detectPermissionError: vi.fn(),
}));

vi.mock('../../src/security/auth.js', () => ({
  isAuthorizedUser: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/security/audit.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/agent/claude.js', () => ({
  invokeClaudeCli: vi.fn(),
  invokeClaudeApi: vi.fn(),
}));

vi.mock('../../src/agent/safety.js', () => ({
  ApprovalManager: vi.fn().mockImplementation(() => ({
    handleResponse: vi.fn(),
  })),
}));

vi.mock('../../src/agent/memory.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/agent/project.js', () => ({
  resolveProject: vi.fn().mockResolvedValue(null),
  touchProject: vi.fn(),
}));

vi.mock('../../src/agent/memory-commands.js', () => ({
  handleMemoryCommand: vi.fn().mockResolvedValue({ handled: false }),
}));

vi.mock('../../src/agent/preference-detector.js', () => ({
  detectAndSavePreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/agent/project-analyzer.js', () => ({
  analyzeProjectIfNew: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/agent/skills.js', () => ({
  buildSkillsContext: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/agent/tool-descriptions.js', () => ({
  buildToolDescriptions: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/agent/session.js', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  touchSession: vi.fn(),
  deleteSession: vi.fn(),
  cleanupSessions: vi.fn().mockResolvedValue(undefined),
  getRemainingTurns: vi.fn().mockReturnValue(20),
}));

vi.mock('../../src/agent/conversation-summary.js', () => ({
  updateConversationSummary: vi.fn().mockResolvedValue(undefined),
  getConversationSummaryText: vi.fn().mockResolvedValue(null),
  cleanupExpiredSummaries: vi.fn().mockResolvedValue(undefined),
}));

import { AgentCore } from '../../src/agent/core.js';
import { loadGoogleTokens } from '../../src/tools/google-auth.js';
import { startTokenRefresher, stopTokenRefresher } from '../../src/agent/token-refresher.js';
import { loadMcpConfig } from '../../src/tools/figma-mcp.js';

const mockLoadGoogleTokens = vi.mocked(loadGoogleTokens);
const mockStartTokenRefresher = vi.mocked(startTokenRefresher);
const mockLoadMcpConfig = vi.mocked(loadMcpConfig);

function createMockMessenger() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue('msg-id'),
    updateText: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    onApproval: vi.fn(),
  };
}

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    claude: { mode: 'cli' as const, cliBinary: 'claude', apiKey: null },
    messenger: { platform: 'slack' as const, slack: { botToken: 't', appToken: 't', signingSecret: 's' } },
    security: { allowedUsers: { slack: ['U123'], telegram: [] } },
    safety: { requireApproval: [] },
    agent: { showThinking: false },
    ...overrides,
  };
}

describe('AgentCore.start() - TokenRefresher conditional startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.mocked(stopTokenRefresher)();
  });

  it('does NOT start TokenRefresher when config.google is absent', async () => {
    const config = createConfig({ google: undefined });
    const agent = new AgentCore(createMockMessenger() as any, config as any);
    await agent.start();

    expect(mockStartTokenRefresher).not.toHaveBeenCalled();
  });

  it('does NOT start TokenRefresher when tokens are missing (no-tokens + has-mcp)', async () => {
    const config = createConfig({
      google: { clientId: 'id', clientSecret: 'secret', services: ['gmail'] },
    });
    mockLoadGoogleTokens.mockResolvedValueOnce(null);
    mockLoadMcpConfig.mockResolvedValueOnce({
      mcpServers: { gmail: { command: 'bash', args: ['/path/to/launcher.sh'] } },
    });

    const agent = new AgentCore(createMockMessenger() as any, config as any);
    await agent.start();

    expect(mockStartTokenRefresher).not.toHaveBeenCalled();
  });

  it('does NOT start TokenRefresher when no Google MCP servers registered (has-tokens + no-mcp)', async () => {
    const config = createConfig({
      google: { clientId: 'id', clientSecret: 'secret', services: ['gmail'] },
    });
    mockLoadGoogleTokens.mockResolvedValueOnce({
      accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600000, scopes: [],
    });
    mockLoadMcpConfig.mockResolvedValueOnce({ mcpServers: {} });

    const agent = new AgentCore(createMockMessenger() as any, config as any);
    await agent.start();

    expect(mockStartTokenRefresher).not.toHaveBeenCalled();
  });

  it('DOES start TokenRefresher when tokens exist AND Google MCP servers registered', async () => {
    const config = createConfig({
      google: { clientId: 'id', clientSecret: 'secret', services: ['gmail'] },
    });
    mockLoadGoogleTokens.mockResolvedValueOnce({
      accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600000, scopes: [],
    });
    mockLoadMcpConfig.mockResolvedValueOnce({
      mcpServers: { gmail: { command: 'bash', args: ['/path/to/launcher.sh'] } },
    });

    const agent = new AgentCore(createMockMessenger() as any, config as any);
    await agent.start();

    expect(mockStartTokenRefresher).toHaveBeenCalled();
  });

  it('does NOT start TokenRefresher when config.google exists but no tokens and no MCP', async () => {
    const config = createConfig({
      google: { clientId: 'id', clientSecret: 'secret', services: ['gmail'] },
    });
    mockLoadGoogleTokens.mockResolvedValueOnce(null);
    mockLoadMcpConfig.mockResolvedValueOnce({ mcpServers: {} });

    const agent = new AgentCore(createMockMessenger() as any, config as any);
    await agent.start();

    expect(mockStartTokenRefresher).not.toHaveBeenCalled();
  });
});
