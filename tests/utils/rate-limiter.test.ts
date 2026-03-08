import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows burst up to maxTokens', () => {
    const limiter = new RateLimiter(3, 1);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('refills tokens over time', async () => {
    const limiter = new RateLimiter(2, 10); // 10 tokens/sec
    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);

    await new Promise((r) => setTimeout(r, 150)); // ~1.5 tokens refilled
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('acquire waits when no tokens available', async () => {
    const limiter = new RateLimiter(1, 100); // 100 tokens/sec = 10ms per token
    limiter.tryAcquire(); // consume the one token

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5); // Should have waited some time
  });

  it('does not exceed maxTokens on refill', async () => {
    const limiter = new RateLimiter(2, 100);
    await new Promise((r) => setTimeout(r, 100)); // Would refill 10 tokens
    // But should cap at 2
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });
});
