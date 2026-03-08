import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { baseDelay: 1, jitter: false });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 1, jitter: false }))
      .rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects isRetryable predicate', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('not retryable'));
    await expect(withRetry(fn, {
      maxAttempts: 3,
      baseDelay: 1,
      isRetryable: () => false,
    })).rejects.toThrow('not retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff timing', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await withRetry(fn, { baseDelay: 50, jitter: false, maxDelay: 200 });
    const elapsed = Date.now() - start;

    // Should wait ~50ms (attempt 1) + ~100ms (attempt 2) = ~150ms
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps delay at maxDelay', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await withRetry(fn, { baseDelay: 1000, maxDelay: 10, jitter: false });
    const elapsed = Date.now() - start;

    // Should not wait more than maxDelay (10ms) + some overhead
    expect(elapsed).toBeLessThan(100);
  });
});
