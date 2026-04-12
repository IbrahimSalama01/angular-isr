import type { CacheAdapter, CacheEntry, CacheState } from '../types.js';

interface StoredEntry {
  entry: CacheEntry;
  storedAt: number;
}

/**
 * Built-in in-memory cache adapter.
 *
 * Suitable for single-instance deployments and local development.
 * For distributed/multi-instance deployments, implement a Redis-backed CacheAdapter.
 *
 * State computation on get():
 * - fresh:       age < ttl
 * - stale:       ttl <= age < (ttl + staleTtl)
 * - error:       stored with state='error'
 * - null:        staleTtl exceeded (treat as miss), version mismatch, or not found
 */
export class MemoryCacheAdapter implements CacheAdapter {
  private readonly store = new Map<string, StoredEntry>();

  async get(key: string): Promise<CacheEntry | null> {
    const stored = this.store.get(key);
    if (!stored) return null;

    const { entry } = stored;

    // Version mismatch → treat as miss
    if (entry.version !== stored.entry.version) return null;

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
    this.store.set(key, { entry: { ...entry }, storedAt: Date.now() });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deleteByTag(tenantId: string, tag: string): Promise<string[]> {
    const deleted: string[] = [];
    for (const [key, { entry }] of this.store.entries()) {
      if (entry.tenantId === tenantId && entry.tags.includes(tag)) {
        this.store.delete(key);
        deleted.push(key);
      }
    }
    return deleted;
  }

  async deleteByTenant(tenantId: string): Promise<string[]> {
    const deleted: string[] = [];
    for (const [key, { entry }] of this.store.entries()) {
      if (entry.tenantId === tenantId) {
        this.store.delete(key);
        deleted.push(key);
      }
    }
    return deleted;
  }

  /** Update state of an existing entry without replacing it */
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
