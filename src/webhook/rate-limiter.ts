/**
 * In-process sliding-window rate limiter.
 *
 * Tracks request timestamps per identifier (IP, tenant, etc.)
 * and rejects requests that exceed the configured limit per minute.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly limitPerMinute: number;

  constructor(limitPerMinute = 60) {
    this.limitPerMinute = limitPerMinute;
  }

  /**
   * Returns true if the request should be allowed.
   */
  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;

    const timestamps = (this.windows.get(identifier) ?? []).filter((t) => t > windowStart);
    timestamps.push(now);
    this.windows.set(identifier, timestamps);

    return timestamps.length <= this.limitPerMinute;
  }

  /** Clears all state (useful for testing) */
  reset(): void {
    this.windows.clear();
  }
}
