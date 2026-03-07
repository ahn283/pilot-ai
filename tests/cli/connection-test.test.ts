import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testSlackConnection, testTelegramConnection } from '../../src/cli/connection-test.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('testSlackConnection', () => {
  it('returns ok after auth + DM open + message send', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true }) }) // auth.test
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, channel: { id: 'D123' } }) }) // conversations.open
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true }) }); // chat.postMessage

    const result = await testSlackConnection('xoxb-test', 'U12345');
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify test message was sent
    const msgCall = mockFetch.mock.calls[2];
    expect(msgCall[0]).toBe('https://slack.com/api/chat.postMessage');
    const body = JSON.parse(msgCall[1].body);
    expect(body.channel).toBe('D123');
    expect(body.text).toContain('connected successfully');
  });

  it('returns error on invalid token', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: false, error: 'invalid_auth' }),
    });

    const result = await testSlackConnection('xoxb-bad', 'U12345');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid_auth');
  });

  it('returns error when DM open fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: false, error: 'user_not_found' }) });

    const result = await testSlackConnection('xoxb-test', 'U_BAD');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('user_not_found');
  });

  it('returns error when message send fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, channel: { id: 'D1' } }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: false, error: 'channel_not_found' }) });

    const result = await testSlackConnection('xoxb-test', 'U12345');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('channel_not_found');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await testSlackConnection('xoxb-test', 'U12345');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

describe('testTelegramConnection', () => {
  it('returns ok after getMe + sendMessage', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, result: { username: 'mybot' } }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true }) });

    const result = await testTelegramConnection('123:TOKEN', '99999');
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify test message was sent
    const msgCall = mockFetch.mock.calls[1];
    expect(msgCall[0]).toContain('sendMessage');
    const body = JSON.parse(msgCall[1].body);
    expect(body.chat_id).toBe('99999');
    expect(body.text).toContain('connected successfully');
  });

  it('returns error on invalid token', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: false, description: 'Unauthorized' }),
    });

    const result = await testTelegramConnection('bad:token', '99999');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unauthorized');
  });

  it('returns error when message send fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, result: { username: 'bot' } }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: false, description: 'chat not found' }) });

    const result = await testTelegramConnection('123:TOKEN', '00000');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('chat not found');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'));

    const result = await testTelegramConnection('123:TOKEN', '99999');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('fetch failed');
  });
});
