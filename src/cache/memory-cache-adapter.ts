import type { CacheAdapter, CacheEntry, CacheState } from '../types.js';

interface StoredEntry {
  entry: CacheEntry;
  storedAt: number;
}

/**
 * Built-in in-memory cache adapter.
 *
 * Suitable for single-instance deployments and local development.
 *
 * ⚠️ Production note: For distributed/multi-instance deployments (load-balanced
 * servers), implement a Redis-backed CacheAdapter instead. This adapter stores
 * state in-process and does not share state across instances.
 *
 * @param options.maxSize - Maximum number of cache entries. When exceeded, the oldest
 * entry is evicted (FIFO, since Map preserves insertion order). Default: no limit.
 */
export class MemoryCacheAdapter implements CacheAdapter {
  private readonly store = new Map<string, StoredEntry>();
  private readonly maxSize: number;

  constructor(options?: { maxSize?: number }) {
    this.maxSize = options?.maxSize ?? Infinity;
  }

  async get(key: string): Promise<CacheEntry | null> {
    const stored = this.store.get(key);
    if (!stored) return null;

    const { entry } = stored;

    // Note: Version mismatch is handled by IsrEngine, not the adapter
    // This allows the adapter to remain framework-agnostic

    if (entry.state === 'error') return entry;
    if (entry.state === 'revalidating') return entry;

    if (entry.ttl === undefined) {
      // On-demand only — always fresh until explicitly invalidated
      return { ...entry, state: 'fresh' };
    }

    const ageMs = Date.now() - entry.createdAt;
    const ttlMs = entry.ttl * 1000;
    const staleTtlMs = (entry.staleTtl ?? Infinity) * 1000;

    if (ageMs < ttlMs) {
      return { ...entry, state: 'fresh' };
    }

    if (ageMs < ttlMs + staleTtlMs) {
      return { ...entry, state: 'stale' };
    }

    // staleTtl exceeded — evict and treat as miss
    this.store.delete(key);
    return null;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    // Evict oldest entry if at capacity (and this is a new key, not an update)
    if (this.maxSize !== Infinity && this.store.size >= this.maxSize && !this.store.has(key)) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }
    this.store.set(key, { entry: { ...entry }, storedAt: Date.now() });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deleteByTag(tenantId: string, tag: string): Promise<string[]> {
    const deleted: string[] = [];
    // Note: It is safe to delete from a Map while iterating over it in JS.
    // The iterator will continue correctly.
    for (const [key, { entry }] of this.store.entries()) {
      if ((tenantId === '__all__' || entry.tenantId === tenantId) && entry.tags.includes(tag)) {
        this.store.delete(key);
        deleted.push(key);
      }
    }
    return deleted;
  }

  async deleteByTenant(tenantId: string): Promise<string[]> {
    const deleted: string[] = [];
    for (const [key, { entry }] of this.store.entries()) {
      if (tenantId === '__all__' || entry.tenantId === tenantId) {
        this.store.delete(key);
        deleted.push(key);
      }
    }
    return deleted;
  }

  async deleteByPath(tenantId: string, path: string): Promise<string[]> {
    const deleted: string[] = [];
    for (const [key, { entry }] of this.store.entries()) {
      if ((tenantId === '__all__' || entry.tenantId === tenantId) && entry.path === path) {
        this.store.delete(key);
        deleted.push(key);
      }
    }
    return deleted;
  }

  /** Satisfies the optional CacheAdapter.setState() interface method */
  async setState(key: string, state: CacheState): Promise<void> {
    const stored = this.store.get(key);
    if (stored) {
      stored.entry = { ...stored.entry, state };
    }
  }

  /** Returns the number of entries in the cache */
  get size(): number {
    return this.store.size;
  }

  /** Clears all entries */
  clear(): void {
    this.store.clear();
  }
}
