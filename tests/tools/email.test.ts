import { describe, it, expect, vi, beforeEach } from 'vitest';

const testDir = '/tmp/pilot-email-test';
vi.mock('../../src/config/store.js', () => ({
  getPilotDir: () => testDir,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Configure Google OAuth module (replaces configureEmail)
const { configureGoogle, saveGoogleTokens } = await import('../../src/tools/google-auth.js');
const { listMessages, getMessage, createDraft } = await import('../../src/tools/email.js');

beforeEach(async () => {
  vi.clearAllMocks();
  configureGoogle({ clientId: 'test-client', clientSecret: 'test-secret' });
});

describe('getMessage', () => {
  it('fetches and parses email message', async () => {
    await saveGoogleTokens({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    });

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
    await saveGoogleTokens({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3600_000,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'draft-1' }),
    });

    const id = await createDraft({ to: 'bob@test.com', subject: 'Hi', body: 'Hello' });
    expect(id).toBe('draft-1');
  });
});
