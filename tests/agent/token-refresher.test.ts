import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock google-auth
vi.mock('../../src/tools/google-auth.js', () => ({
  loadGoogleTokens: vi.fn(),
  getGoogleAccessToken: vi.fn(),
  verifyGoogleTokens: vi.fn(),
  writeGmailMcpCredentials: vi.fn(),
  configureGoogle: vi.fn(),
  getGoogleConfig: vi.fn(),
}));

// Mock figma-mcp
vi.mock('../../src/tools/figma-mcp.js', () => ({
  loadMcpConfig: vi.fn().mockResolvedValue({ mcpServers: {} }),
  saveMcpConfig: vi.fn().mockResolvedValue(undefined),
}));

// Mock claude-code-sync
vi.mock('../../src/config/claude-code-sync.js', () => ({
  syncToClaudeCode: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock keychain
vi.mock('../../src/config/keychain.js', () => ({
  getSecret: vi.fn().mockResolvedValue(null),
}));

import {
  checkGoogleTokenHealth,
  startTokenRefresher,
  stopTokenRefresher,
  isTokenRefresherRunning,
} from '../../src/agent/token-refresher.js';

import {
  loadGoogleTokens,
  getGoogleAccessToken,
  verifyGoogleTokens,
  getGoogleConfig,
} from '../../src/tools/google-auth.js';

const mockLoadGoogleTokens = vi.mocked(loadGoogleTokens);
const mockGetGoogleAccessToken = vi.mocked(getGoogleAccessToken);
const mockVerifyGoogleTokens = vi.mocked(verifyGoogleTokens);
const mockGetGoogleConfig = vi.mocked(getGoogleConfig);

const baseTokens = {
  accessToken: 'valid-access-token',
  refreshToken: 'valid-refresh-token',
  expiresAt: Date.now() + 4 * 60 * 60 * 1000,
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};

describe('token-refresher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopTokenRefresher();

    mockLoadGoogleTokens.mockResolvedValue(baseTokens);
    mockGetGoogleAccessToken.mockResolvedValue('new-access-token');
    mockVerifyGoogleTokens.mockResolvedValue(true);
    mockGetGoogleConfig.mockReturnValue({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
  });

  afterEach(() => {
    stopTokenRefresher();
  });

  describe('checkGoogleTokenHealth', () => {
    it('returns not_configured when no tokens exist', async () => {
      mockLoadGoogleTokens.mockResolvedValueOnce(null);

      const result = await checkGoogleTokenHealth();
      expect(result.status).toBe('not_configured');
    });

    it('returns not_configured when Google config missing', async () => {
      mockGetGoogleConfig.mockReturnValueOnce(null);

      const result = await checkGoogleTokenHealth();
      expect(result.status).toBe('not_configured');
    });

    it('returns healthy when tokens are valid and not near expiry', async () => {
      const result = await checkGoogleTokenHealth();
      expect(result.status).toBe('healthy');
      expect(mockVerifyGoogleTokens).toHaveBeenCalledWith('valid-access-token');
    });

    it('attempts refresh when token verification fails', async () => {
      mockVerifyGoogleTokens.mockResolvedValueOnce(false);

      const result = await checkGoogleTokenHealth();
      expect(result.status).toBe('refreshed');
      expect(mockGetGoogleAccessToken).toHaveBeenCalled();
    });

    it('attempts refresh when token is near expiry', async () => {
      mockLoadGoogleTokens.mockResolvedValueOnce({
        ...baseTokens,
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 min — within warning window
      });

      const result = await checkGoogleTokenHealth();
      expect(result.status).toBe('refreshed');
    });

    it('returns expired when refresh fails', async () => {
      mockLoadGoogleTokens.mockResolvedValueOnce({
        ...baseTokens,
        expiresAt: Date.now() - 1000,
      });
      mockGetGoogleAccessToken.mockRejectedValueOnce(new Error('invalid_grant'));

      const result = await checkGoogleTokenHealth();
      expect(result.status).toBe('expired');
      expect(result.message).toContain('invalid_grant');
    });
  });

  describe('startTokenRefresher / stopTokenRefresher', () => {
    it('starts and stops the refresher', () => {
      expect(isTokenRefresherRunning()).toBe(false);

      startTokenRefresher();
      expect(isTokenRefresherRunning()).toBe(true);

      stopTokenRefresher();
      expect(isTokenRefresherRunning()).toBe(false);
    });

    it('does not start twice', () => {
      startTokenRefresher();
      startTokenRefresher();
      expect(isTokenRefresherRunning()).toBe(true);

      stopTokenRefresher();
      expect(isTokenRefresherRunning()).toBe(false);
    });
  });
});
