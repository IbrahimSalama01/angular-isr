/**
 * angular-isr/server — Server-side ISR engine API
 *
 * Import from 'angular-isr/server' in your server.ts and Node.js code.
 * Do NOT import this in Angular components — it contains Node.js-only APIs.
 */

// Angular providers (server-only)
export { provideIsrServer } from './angular/isr.provider.server.js';

// Core engine
export { IsrEngine } from './core/isr-engine.js';
export { isrAsyncContext } from './core/isr-context.js';

// Cache
export { MemoryCacheAdapter } from './cache/memory-cache-adapter.js';
export type { CacheAdapter, CacheEntry, CacheState } from './types.js';

// Revalidation queue
export { MemoryQueueAdapter } from './revalidation/memory-queue-adapter.js';
export { IdempotencyStore } from './revalidation/idempotency-store.js';
export type { RevalidationQueueAdapter, RevalidationJob, RetryPolicy } from './types.js';

// CMS adapters
export { ContentfulIsrAdapter } from './cms-adapters/contentful.adapter.js';
export type { ContentfulAdapterOptions } from './cms-adapters/contentful.adapter.js';

export { SanityIsrAdapter } from './cms-adapters/sanity.adapter.js';
export type { SanityAdapterOptions } from './cms-adapters/sanity.adapter.js';

export { StrapiIsrAdapter } from './cms-adapters/strapi.adapter.js';
export type { StrapiAdapterOptions } from './cms-adapters/strapi.adapter.js';

export type { CmsAdapter } from './types.js';

// Webhook utilities (server-only)
export { verifySecret, verifyHmacSha256 } from './webhook/secret-auth.js';
export { RateLimiter } from './webhook/rate-limiter.js';
export { WebhookDebouncer } from './webhook/webhook-debouncer.js';

// Full types
export type {
  IsrEngineConfig,
  IsrRequestContext,
  IsrHandleResult,
  IsrRouteConfig,
  IsrEvent,
  IsrEventHandler,
  IsrFetchFn,
  IsrFetchOptions,
  WebhookPayload,
} from './types.js';

export { ANGULAR_ISR_TRANSFER_KEY } from './types.js';
