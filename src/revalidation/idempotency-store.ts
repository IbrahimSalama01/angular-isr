/**
 * Tracks processed webhook idempotency keys to prevent duplicate processing.
 *
 * Entries are TTL-pruned automatically.
 */
export class IdempotencyStore {
  private readonly store = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(options?: { ttlHours?: number; maxSize?: number }) {
    this.ttlMs = (options?.ttlHours ?? 24) * 60 * 60 * 1000;
    this.maxSize = options?.maxSize ?? 10000;
  }

  has(key: string): boolean {
    const timestamp = this.store.get(key);
    if (!timestamp) return false;

    if (Date.now() - timestamp > this.ttlMs) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  set(key: string): void {
    // Capacity-based eviction (O(1) in JS Map)
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, Date.now());

    // Occasional full TTL pruning (every 100 sets)
    if (this.store.size % 100 === 0) {
      this.prune();
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, timestamp] of this.store.entries()) {
      if (timestamp < cutoff) {
        this.store.delete(key);
      } else {
        // Since Map is ordered by insertion, once we find a non-expired entry,
        // all subsequent entries are also non-expired.
        break;
      }
    }
  }
}
