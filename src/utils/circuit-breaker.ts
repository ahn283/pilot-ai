/**
 * Circuit breaker implementation (CLOSED → OPEN → HALF-OPEN state machine).
 * Protects against cascading failures by failing fast when a service is down.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms to wait before transitioning from OPEN to HALF_OPEN (default: 60000) */
  resetTimeout?: number;
  /** Number of successful calls in HALF_OPEN to close the circuit (default: 1) */
  halfOpenSuccessThreshold?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.resetTimeout = options?.resetTimeout ?? 60_000;
    this.halfOpenSuccessThreshold = options?.halfOpenSuccessThreshold ?? 1;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.lastFailureTime >= this.resetTimeout) {
      this.state = 'HALF_OPEN';
      this.successCount = 0;
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new Error('Circuit breaker is OPEN — request blocked');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.successCount = 0;
    }
  }

  /** Reset the circuit breaker to CLOSED state */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }
}
