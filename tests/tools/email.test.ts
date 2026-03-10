import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';

const testDir = '/tmp/pilot-email-test';
vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => testDir,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const {
  configureEmail,
  getAuthUrl,
  exchangeCode,
  saveTokens,
  refreshAccessToken,
  listMessages,
  getMessage,
  createDraft,
} = await import('../../src/tools/email.js');

beforeEach(async () => {
  vi.clearAllMocks();
  await fs.mkdir(testDir, { recursive: true });
  try { await fs.unlink(`${testDir}/gmail-tokens.json`); } catch {}
  configureEmail({ clientId: 'test-client', clientSecret: 'test-secret' });
});

describe('getAuthUrl', () => {
  it('returns Google OAuth URL with loopback redirect', () => {
    const url = getAuthUrl('http://127.0.0.1:8080/callback');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('test-client');
    expect(url).toContain('gmail');
    expect(url).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcallback');
    expect(url).not.toContain('oob');
  });
});

describe('exchangeCode', () => {
  it('exchanges auth code for tokens', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_in: 3600,
      }),
    });

    const tokens = await exchangeCode('auth-code', 'http://127.0.0.1:8080/callback');
    expect(tokens.accessToken).toBe('at-123');
    expect(tokens.refreshToken).toBe('rt-456');
  });
});

describe('refreshAccessToken', () => {
  it('returns cached token if not expired', async () => {
    await saveTokens({
      accessToken: 'valid-token',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
    });

    const token = await refreshAccessToken();
    expect(token).toBe('valid-token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refreshes expired token', async () => {
    await saveTokens({
      accessToken: 'old',
      refreshToken: 'rt-refresh',
      expiresAt: Date.now() - 1000,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        expires_in: 3600,
      }),
    });

    const token = await refreshAccessToken();
    expect(token).toBe('new-token');
  });
});

describe('getMessage', () => {
  it('fetches and parses email message', async () => {
    await saveTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg1',
        threadId: 'th1',
        snippet: 'Hello there',
        payload: {
          headers: [
            { name: 'From', value: 'alice@test.com' },
            { name: 'To', value: 'bob@test.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date', value: 'Mon, 1 Jan 2026' },
          ],
          body: { data: Buffer.from('Hello body').toString('base64url') },
        },
      }),
    });

    const msg = await getMessage('msg1');
    expect(msg?.from).toBe('alice@test.com');
    expect(msg?.subject).toBe('Test Subject');
    expect(msg?.body).toBe('Hello body');
  });
});

describe('createDraft', () => {
  it('creates email draft', async () => {
    await saveTokens({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600_000 });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'draft-1' }),
    });

    const id = await createDraft({ to: 'bob@test.com', subject: 'Hi', body: 'Hello' });
    expect(id).toBe('draft-1');
  });
});
