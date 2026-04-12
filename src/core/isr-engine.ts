import { defaultCacheKeyResolver, normalizePath } from './cache-key.js';
import { RenderLock } from './render-lock.js';
import { MemoryQueueAdapter } from '../revalidation/memory-queue-adapter.js';
import type {
  CacheEntry,
  CacheState,
  IsrEngineConfig,
  IsrEvent,
  IsrFetchFn,
  IsrFetchOptions,
  IsrHandleResult,
  IsrRequestContext,
  IsrRouteConfig,
  RevalidationJob,
} from '../types.js';

/**
 * The core framework-agnostic ISR engine.
 *
 * Handles the full ISR state machine:
 * fresh → stale → revalidating → error/miss
 *
 * Framework adapters (Express, Fastify, etc.) wrap this engine.
 */
export class IsrEngine {
  private readonly renderLock = new RenderLock();
  private readonly queue: NonNullable<IsrEngineConfig['queue']>;
  private readonly cacheVersion: string;

  constructor(private readonly config: IsrEngineConfig) {
    this.cacheVersion = config.cacheVersion ?? '0';
    this.queue = config.queue ?? new MemoryQueueAdapter({
      retryPolicy: config.revalidation?.retryPolicy,
      deadLetterLog: config.revalidation?.deadLetterLog,
    });
    this.queue.onProcess(this.processRevalidation.bind(this));
  }

  /**
   * Handles an incoming request through the ISR pipeline.
   */
  async handle(req: unknown, path: string): Promise<IsrHandleResult> {
    const startTime = Date.now();

    const tenantId = await this.resolveTenant(req);
    const normalizedPath = normalizePath(path);
    const cacheKey = this.buildCacheKey(req, tenantId, normalizedPath);
    const routeConfig = this.matchRoute(normalizedPath);

    const ctx: IsrRequestContext = {
      path: normalizedPath,
      tenantId,
      renderFn: (isrFetch) => this.config.cache.get(cacheKey).then(() => ''), // placeholder
    };

    const cached = await this.config.cache.get(cacheKey);

    if (cached) {
      // Version check
      if (cached.version !== this.cacheVersion) {
        return this.handleMiss(req, tenantId, normalizedPath, cacheKey, routeConfig, startTime);
      }

      if (cached.state === 'fresh') {
        this.emit({ type: 'hit', tenantId, path: normalizedPath, cacheState: 'fresh', durationMs: Date.now() - startTime });
        return { html: cached.html, state: 'fresh', cacheHeaders: routeConfig?.cacheHeaders };
      }

      if (cached.state === 'revalidating') {
        // Another render already in progress — serve stale
        this.emit({ type: 'hit', tenantId, path: normalizedPath, cacheState: 'revalidating', durationMs: Date.now() - startTime });
        return { html: cached.html, state: 'revalidating', cacheHeaders: routeConfig?.cacheHeaders };
      }

      if (cached.state === 'stale') {
        // Serve stale immediately and trigger background revalidation
        this.emit({ type: 'revalidate', tenantId, path: normalizedPath, cacheState: 'stale', durationMs: Date.now() - startTime });
        this.scheduleRevalidation(req, tenantId, normalizedPath, cacheKey, routeConfig, cached);
        return { html: cached.html, state: 'stale', cacheHeaders: routeConfig?.cacheHeaders };
      }

      if (cached.state === 'error') {
        this.emit({ type: 'error', tenantId, path: normalizedPath, cacheState: 'error', durationMs: Date.now() - startTime });
        return { html: cached.html, state: 'error', cacheHeaders: routeConfig?.cacheHeaders };
      }
    }

    return this.handleMiss(req, tenantId, normalizedPath, cacheKey, routeConfig, startTime);
  }

  /**
   * Invalidates cache entries by paths and/or tags for a specific tenant.
   */
  async invalidate(options: {
    tenantId: string;
    paths?: string[];
    tags?: string[];
  }): Promise<string[]> {
    const { tenantId, paths = [], tags = [] } = options;
    const invalidated: string[] = [];

    for (const path of paths) {
      const key = this.buildCacheKey(null, tenantId, normalizePath(path));
      await this.config.cache.delete(key);
      invalidated.push(path);
    }

    for (const tag of tags) {
      const keys = await this.config.cache.deleteByTag(tenantId, tag);
      invalidated.push(...keys);
    }

    return invalidated;
  }

  /**
   * Creates an isrFetch function for use during SSR rendering.
   * Tracks which fetched data should be included in the ISR cache.
   */
  createIsrFetch(cachedResponses: Map<string, unknown>): IsrFetchFn {
    return async (url: string, opts?: IsrFetchOptions): Promise<Response> => {
      const isrOpts = opts?.isr;
      const shouldCache = isrOpts?.cache !== false;

      const { isr: _isr, ...fetchOpts } = opts ?? {};
      const response = await fetch(url, fetchOpts);

      if (shouldCache && response.ok) {
        const cloned = response.clone();
        try {
          const data = await cloned.json();
          cachedResponses.set(url, { data, tags: isrOpts?.tags ?? [], ttl: isrOpts?.ttl });
        } catch {
          // Not JSON — store raw text
          const text = await cloned.text();
          cachedResponses.set(url, { data: text, tags: isrOpts?.tags ?? [], ttl: isrOpts?.ttl });
        }
      }

      return response;
    };
  }

  private async handleMiss(
    req: unknown,
    tenantId: string,
    path: string,
    cacheKey: string,
    routeConfig: IsrRouteConfig | undefined,
    startTime: number,
  ): Promise<IsrHandleResult> {
    this.emit({ type: 'miss', tenantId, path, durationMs: Date.now() - startTime });

    const lockResult = await this.renderLock.acquire(cacheKey);

    if (!lockResult.acquired) {
      // Another request finished rendering while we waited — read from cache
      const cached = await this.config.cache.get(cacheKey);
      if (cached && cached.state === 'fresh') {
        return { html: cached.html, state: 'fresh', cacheHeaders: routeConfig?.cacheHeaders };
      }
    }

    // We own the render
    try {
      const html = await this.render(req, tenantId, path, cacheKey, routeConfig);
      return { html, state: 'fresh', cacheHeaders: routeConfig?.cacheHeaders };
    } finally {
      if (lockResult.acquired) {
        lockResult.release();
      }
    }
  }

  private async render(
    _req: unknown,
    tenantId: string,
    path: string,
    cacheKey: string,
    routeConfig: IsrRouteConfig | undefined,
  ): Promise<string> {
    const cachedResponses = new Map<string, unknown>();
    const isrFetch = this.createIsrFetch(cachedResponses);

    // The actual renderFn is provided by the adapter (e.g. Express middleware)
    // and set on the engine via setRenderFn. For now, the adapter calls render directly.
    // This is a placeholder — adapters call engine.renderForRequest() instead.
    throw new Error('renderFn must be provided via IsrEngine.renderForRequest()');
  }

  /**
   * Called by adapters to perform a full render and cache the result.
   */
  async renderForRequest(
    tenantId: string,
    path: string,
    renderFn: (isrFetch: IsrFetchFn) => Promise<string>,
    routeConfig: IsrRouteConfig | undefined,
  ): Promise<string> {
    const cachedResponses = new Map<string, unknown>();
    const isrFetch = this.createIsrFetch(cachedResponses);

    const html = await renderFn(isrFetch);
    const cacheKey = this.buildCacheKey(null, tenantId, normalizePath(path));

    const entry: CacheEntry = {
      html,
      state: 'fresh',
      createdAt: Date.now(),
      ttl: routeConfig?.ttl,
      staleTtl: routeConfig?.staleTtl,
      tags: routeConfig?.tags ?? [],
      tenantId,
      path,
      version: this.cacheVersion,
    };

    await this.config.cache.set(cacheKey, entry);
    return html;
  }

  private scheduleRevalidation(
    req: unknown,
    tenantId: string,
    path: string,
    cacheKey: string,
    routeConfig: IsrRouteConfig | undefined,
    staleEntry: CacheEntry,
  ): void {
    if (this.renderLock.isLocked(cacheKey)) return;

    const job: Omit<RevalidationJob, 'attempt' | 'enqueuedAt'> = {
      cacheKey,
      tenantId,
      path,
      renderFn: async () => {
        // renderFn for the queue will be set by the adapter
        return staleEntry.html;
      },
    };

    this.queue.enqueue(job);
  }

  private async processRevalidation(job: RevalidationJob): Promise<void> {
    this.emit({ type: 'revalidate', tenantId: job.tenantId, path: job.path, meta: { attempt: job.attempt } });
    try {
      await job.renderFn();
    } catch (error) {
      this.emit({ type: 'error', tenantId: job.tenantId, path: job.path, error: error instanceof Error ? error : new Error(String(error)) });
      throw error;
    }
  }

  private async resolveTenant(req: unknown): Promise<string> {
    if (!this.config.tenantResolver) return '';
    try {
      return await this.config.tenantResolver(req);
    } catch {
      return '';
    }
  }

  buildCacheKey(req: unknown, tenantId: string, path: string): string {
    if (this.config.cacheKeyResolver) {
      return this.config.cacheKeyResolver(req, tenantId, this.cacheVersion, path);
    }
    return defaultCacheKeyResolver(tenantId, this.cacheVersion, path);
  }

  matchRoute(path: string): IsrRouteConfig | undefined {
    if (!this.config.routes?.length) return undefined;
    return this.config.routes.find((r) => matchPath(r.path, path));
  }

  private emit(event: IsrEvent): void {
    try {
      this.config.onEvent?.(event);
    } catch {
      // Never let observability hooks crash the engine
    }
  }
}

/**
 * Simple glob-style path matcher.
 * Supports exact paths and ** wildcards.
 */
function matchPath(pattern: string, path: string): boolean {
  if (pattern === '**') return true;
  if (pattern === path) return true;

  // Convert glob to regex: ** matches anything, * matches path segment
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]+');

  return new RegExp(`^${escaped}$`).test(path);
}
