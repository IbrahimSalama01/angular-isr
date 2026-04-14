/**
 * In-process sliding-window rate limiter.
 *
 * Tracks request timestamps per identifier (IP, tenant, etc.)
 * and rejects requests that exceed the configured limit per minute.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly limitPerMinute: number;
  private callCount = 0;

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

    if (timestamps.length > 0) {
      this.windows.set(identifier, timestamps);
    } else {
      this.windows.delete(identifier); // Entry is dead — prune immediately
    }

    // Full prune every 1000 calls to catch any lingering stale entries
    if (++this.callCount % 1000 === 0) {
      this.prune(windowStart);
    }

    return timestamps.length <= this.limitPerMinute;
  }

  /**
   * Removes all expired timestamps across all identifiers.
   */
  private prune(windowStart: number): void {
    for (const [id, timestamps] of this.windows) {
      if (!timestamps.some((t) => t > windowStart)) {
        this.windows.delete(id);
      }
    }
  }

  /** Clears all state (useful for testing) */
  reset(): void {
    this.windows.clear();
    this.callCount = 0;
  }
}
