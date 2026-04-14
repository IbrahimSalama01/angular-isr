/**
 * Represents the lifecycle state of a cached page entry.
 */
export type CacheState = 'fresh' | 'stale' | 'revalidating' | 'error';

/**
 * A cached page entry stored in the cache adapter.
 */
export interface CacheEntry {
  html: string;
  state: CacheState;
  /** Unix timestamp (ms) when this entry was rendered */
  createdAt: number;
  /** Seconds until this entry transitions from fresh → stale */
  ttl?: number;
  /**
   * Seconds after going stale during which the stale entry is still served
   * while revalidation happens in the background.
   * Default: Infinity (stale is served forever until a new render succeeds).
   */
  staleTtl?: number;
  /** Tags for bulk invalidation */
  tags: string[];
  tenantId: string;
  path: string;
  /**
   * The cacheVersion value from IsrEngineConfig at render time.
   * A version mismatch on get() is treated as a cache miss.
   */
  version: string;
}

/**
 * Pluggable cache storage backend.
 * Implement this interface to use Redis, filesystem, or any other store.
 */
export interface CacheAdapter {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByTag(tenantId: string, tag: string): Promise<string[]>;
  deleteByTenant(tenantId: string): Promise<string[]>;
}

/**
 * A pending revalidation job.
 */
export interface RevalidationJob {
  cacheKey: string;
  tenantId: string;
  path: string;
  renderFn: (isrFetch: IsrFetchFn) => Promise<string>;
  attempt: number;
  enqueuedAt: number;
}

/**
 * Pluggable revalidation queue backend.
 * Implement this interface to use Redis Bull, BullMQ, or any other queue.
 */
export interface RevalidationQueueAdapter {
  enqueue(job: Omit<RevalidationJob, 'attempt' | 'enqueuedAt'>): Promise<void>;
  onProcess(handler: (job: RevalidationJob) => Promise<void>): void;
}

/**
 * Per-route ISR configuration.
 */
export interface IsrRouteConfig {
  /** Glob or exact path to match (e.g. '/blog/**', '/home') */
  path: string;
  /** Seconds until a fresh entry becomes stale. Undefined = on-demand only. */
  ttl?: number;
  /**
   * Seconds a stale entry is still served after TTL expires.
   * Once staleTtl is exceeded, the next request triggers a blocking render.
   * Default: Infinity
   */
  staleTtl?: number;
  /** Cache tags for bulk invalidation */
  tags?: string[];
  /** Whether this route supports on-demand revalidation via webhook. Default: true */
  revalidateOnDemand?: boolean;
  /**
   * Cache-Control header value to set on responses served from cache.
   * e.g. 'max-age=30, stale-while-revalidate=60'
   */
  cacheHeaders?: string;
}

/**
 * Options for isr.fetch() — the data-level cache control helper.
 */
export interface IsrFetchOptions extends RequestInit {
  isr?: {
    /**
     * Whether to include this fetch response in the ISR cache (TransferState).
     * Set to false for user-specific or highly dynamic data.
     * Default: true
     */
    cache?: boolean;
    /** Per-fetch TTL override in seconds */
    ttl?: number;
    /** Tags associated with this data fetch for bulk invalidation */
    tags?: string[];
  };
}

/**
 * The isr.fetch function passed to renderFn.
 * Use this instead of native fetch() for all data fetching during SSR
 * to enable data-level cache control.
 */
export type IsrFetchFn = (url: string, opts?: IsrFetchOptions) => Promise<Response>;

/**
 * Framework-agnostic request context passed to the ISR engine.
 */
export interface IsrRequestContext {
  path: string;
  tenantId: string;
  /**
   * Calls the Angular SSR render engine.
   * The engine injects isrFetch so that data services can use it.
   */
  renderFn: (isrFetch: IsrFetchFn) => Promise<string>;
}

/**
 * Result returned by the ISR engine after handling a request.
 */
export interface IsrHandleResult {
  html: string;
  state: CacheState;
  /** Cache-Control header value (if configured for the matched route) */
  cacheHeaders?: string;
}

/**
 * Unified observability event emitted by the ISR engine.
 */
export interface IsrEvent {
  type: 'hit' | 'miss' | 'revalidate' | 'error' | 'webhook';
  tenantId: string;
  path: string;
  cacheState?: CacheState;
  durationMs?: number;
  error?: Error;
  meta?: Record<string, unknown>;
}

export type IsrEventHandler = (event: IsrEvent) => void;

/**
 * Retry policy for the revalidation queue.
 */
export interface RetryPolicy {
  /** Maximum number of render attempts before giving up. Default: 3 */
  maxAttempts: number;
  /** Base delay in ms for exponential backoff. Default: 1000 */
  backoffMs: number;
}

/**
 * Normalized webhook payload (output of any CmsAdapter.parseWebhook).
 */
export interface WebhookPayload {
  /** Specific paths to invalidate */
  paths?: string[];
  /** Tags to bulk-invalidate */
  tags?: string[];
  /** Tenant to scope invalidation to */
  tenant?: string;
  /** Idempotency key to deduplicate repeated CMS webhook calls */
  idempotencyKey?: string;
}

/**
 * CMS webhook adapter interface.
 * Implement to add support for any CMS (Contentful, Sanity, Strapi, etc.).
 */
export interface CmsAdapter {
  name: string;
  /**
   * Verify the webhook signature and normalize the payload.
   * Should throw if the signature is invalid.
   */
  parseWebhook(req: unknown): Promise<WebhookPayload>;
}

/**
 * Main configuration for the ISR engine.
 */
export interface IsrEngineConfig {
  cache: CacheAdapter;
  /** Pluggable revalidation queue. Default: in-memory MemoryQueueAdapter */
  queue?: RevalidationQueueAdapter;
  /**
   * Bump this on each deployment to automatically invalidate all old cache entries.
   * Old entries with a different version are treated as misses.
   * Default: '0'
   */
  cacheVersion?: string;
  /** Per-route ISR configuration */
  routes?: IsrRouteConfig[];
  /**
   * Extracts the tenant identifier from a request.
   * Default: returns '' (single-tenant mode)
   */
  tenantResolver?: (req: unknown) => string | Promise<string>;
  /**
   * Custom cache key builder.
   * Default: (tenantId, version, path) => `${tenantId}:${version}:${path}`
   */
  cacheKeyResolver?: (req: unknown, tenantId: string, version: string, path: string) => string;
  revalidation?: {
    /** Shared secret for webhook authentication (X-ISR-Secret header) */
    secret: string;
    /** Webhook endpoint path. Default: '/_isr/revalidate' */
    endpoint?: string;
    retryPolicy?: RetryPolicy;
    deadLetterLog?: (job: RevalidationJob, error: Error) => void;
    /** Max webhook requests per minute per IP. Default: 60 */
    rateLimitPerMinute?: number;
    /** Debounce window in ms to batch rapid CMS invalidations. Default: 500 */
    debounceMs?: number;
    /**
     * Factory function to create a render function for background revalidation jobs.
     * The engine will call this to get a render function when processing queued revalidation jobs.
     * This allows the adapter to provide framework-specific rendering logic.
     */
    renderFnFactory?: (tenantId: string, path: string) => (isrFetch: IsrFetchFn) => Promise<string>;
  };
  onEvent?: IsrEventHandler;
}

/**
 * Angular-side ISR client configuration (used in provideIsr()).
 */
export interface IsrClientConfig {
  routes?: IsrRouteConfig[];
}

/** Transfer state key for ISR metadata injected by the server engine */
export const ANGULAR_ISR_TRANSFER_KEY = 'ANGULAR_ISR_STATE';
