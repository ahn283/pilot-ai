/**
 * Retry utility with exponential backoff and jitter.
 */

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number;
  /** Whether to add jitter (default: true) */
  jitter?: boolean;
  /** Optional predicate to determine if the error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30_000,
  jitter: true,
  isRetryable: () => true,
};

/**
 * Executes a function with retry logic using exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxAttempts || !opts.isRetryable(error)) {
        throw error;
      }

      const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay, opts.jitter);
      await sleep(delay);
    }
  }

  throw lastError;
}

function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: boolean,
): number {
  // Exponential backoff: base * 2^(attempt-1)
  let delay = baseDelay * Math.pow(2, attempt - 1);
  delay = Math.min(delay, maxDelay);

  if (jitter) {
    // Full jitter: random value between 0 and delay
    delay = Math.random() * delay;
  }

  return delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
