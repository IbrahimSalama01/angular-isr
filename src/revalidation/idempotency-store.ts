/**
 * Tracks processed webhook idempotency keys to prevent duplicate processing.
 *
 * Entries are TTL-pruned automatically.
 */
export class IdempotencyStore {
  private readonly store = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlHours = 24) {
    this.ttlMs = ttlHours * 60 * 60 * 1000;
  }

  has(key: string): boolean {
    this.prune();
    return this.store.has(key);
  }

  set(key: string): void {
    this.store.set(key, Date.now());
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, timestamp] of this.store.entries()) {
      if (timestamp < cutoff) {
        this.store.delete(key);
      }
    }
  }
}
