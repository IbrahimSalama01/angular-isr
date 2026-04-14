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
   *
   * @param req - The framework request object
   * @param path - The URL path to handle
   * @param renderFn - Optional function to render the page (required for cache misses)
   */
  async handle(req: unknown, path: string, renderFn?: (isrFetch: IsrFetchFn) => Promise<string>): Promise<IsrHandleResult> {
    const startTime = Date.now();

    const tenantId = await this.resolveTenant(req);
    const normalizedPath = normalizePath(path);
    const cacheKey = this.buildCacheKey(req, tenantId, normalizedPath);
    const routeConfig = this.matchRoute(normalizedPath);

    const cached = await this.config.cache.get(cacheKey);

    if (cached) {
      // Version check
      if (cached.version !== this.cacheVersion) {
        return this.handleMiss(req, tenantId, normalizedPath, cacheKey, routeConfig, startTime, renderFn);
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

    return this.handleMiss(req, tenantId, normalizedPath, cacheKey, routeConfig, startTime, renderFn);
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
    renderFn?: (isrFetch: IsrFetchFn) => Promise<string>,
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
      if (!renderFn) {
        throw new Error('renderFn is required for cache misses. Provide it via engine.handle(req, path, renderFn).');
      }
      const html = await this.render(req, tenantId, path, cacheKey, routeConfig, renderFn);
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
    _cacheKey: string,
    routeConfig: IsrRouteConfig | undefined,
    renderFn: (isrFetch: IsrFetchFn) => Promise<string>,
  ): Promise<string> {
    return this.renderForRequest(tenantId, path, renderFn, routeConfig);
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
    _req: unknown,
    tenantId: string,
    path: string,
    _cacheKey: string,
    _routeConfig: IsrRouteConfig | undefined,
    _staleEntry: CacheEntry,
  ): void {
    // Note: Revalidation requires a renderFnFactory to be configured
    // Without it, stale content will be served but not refreshed in the background
    if (!this.config.revalidation?.renderFnFactory) {
      this.emit({ type: 'error', tenantId, path, error: new Error('renderFnFactory not configured - background revalidation disabled') });
      return;
    }

    const job: Omit<RevalidationJob, 'attempt' | 'enqueuedAt'> = {
      cacheKey: this.buildCacheKey(null, tenantId, path),
      tenantId,
      path,
      renderFn: this.config.revalidation.renderFnFactory(tenantId, path),
    };

    this.queue.enqueue(job);
  }

  private async processRevalidation(job: RevalidationJob): Promise<void> {
    this.emit({ type: 'revalidate', tenantId: job.tenantId, path: job.path, meta: { attempt: job.attempt } });
    try {
      const routeConfig = this.matchRoute(job.path);
      await this.renderForRequest(job.tenantId, job.path, job.renderFn, routeConfig);
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
    const normalizedPath = normalizePath(path);
    return this.config.routes.find((r) => matchPath(normalizePath(r.path), normalizedPath));
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
  // Pattern and path are expected to be normalized with normalizePath()
  if (pattern === '**' || pattern === '/**') return true;
  if (pattern === path) return true;

  // Convert glob to regex: ** matches anything, * matches path segment
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '[^/]+');

  return new RegExp(`^${escaped}$`).test(path);
}
