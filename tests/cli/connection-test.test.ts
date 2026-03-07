import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testSlackConnection, testTelegramConnection } from '../../src/cli/connection-test.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('testSlackConnection', () => {
  it('returns ok on successful auth.test', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, user: 'bot', team: 'workspace' }),
    });

    const result = await testSlackConnection('xoxb-test');
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://slack.com/api/auth.test', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer xoxb-test' }),
    }));
  });

  it('returns error on invalid token', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: 'invalid_auth' }),
    });

    const result = await testSlackConnection('xoxb-bad');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_auth');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await testSlackConnection('xoxb-test');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

describe('testTelegramConnection', () => {
  it('returns ok on successful getMe', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: { username: 'mybot' } }),
    });

    const result = await testTelegramConnection('123:TOKEN');
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://api.telegram.org/bot123:TOKEN/getMe');
  });

  it('returns error on invalid token', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, description: 'Unauthorized' }),
    });

    const result = await testTelegramConnection('bad:token');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));

    const result = await testTelegramConnection('123:TOKEN');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('fetch failed');
  });
});
