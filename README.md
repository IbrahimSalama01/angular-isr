# angular-isr

> **Incremental Static Regeneration (ISR) for Angular SSR** — with multitenancy, CMS webhooks, hybrid rendering, and a pluggable cache backend.

[![npm version](https://img.shields.io/npm/v/angular-isr)](https://www.npmjs.com/package/angular-isr)
[![license](https://img.shields.io/npm/l/angular-isr)](LICENSE)

---

## Features

- ✅ **ISR with explicit cache states** — `fresh`, `stale`, `revalidating`, `error`
- ✅ **Stale-while-revalidate** — serve cached HTML immediately, regenerate in background
- ✅ **On-demand revalidation** — CMS webhook triggers instant cache invalidation
- ✅ **Multitenancy** — configurable tenant resolver, fully isolated cache per tenant
- ✅ **Cache versioning** — bump `cacheVersion` on deploy to auto-invalidate old cache
- ✅ **Hybrid/partial rendering** — `isr.fetch()` gives data-level cache control per request
- ✅ **Pluggable cache backend** — bring your own Redis, filesystem, or database adapter
- ✅ **Pluggable revalidation queue** — plug in BullMQ, Redis queue, or use the built-in in-memory queue
- ✅ **CMS adapters** — Contentful, Sanity, and Strapi built-in
- ✅ **Webhook hardening** — rate limiting, idempotency deduplication, batch debouncing
- ✅ **Observability** — unified `onEvent` hook for logging and metrics
- ✅ **Angular DI** — `IsrService` exposes cache state as signals in your components
- ✅ **Tree-shakable** — three separate entry points (client, server, express adapter)

---

## Requirements

- Angular 17+
- `@angular/ssr` 17+
- `express` 4 or 5 (for the Express adapter)
- Node.js 18+

---

## Installation

```bash
npm install angular-isr
```

---

## Quick Start

### 1. Server — `src/server.ts`

```typescript
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsrEngine, MemoryCacheAdapter } from 'angular-isr/server';
import { createIsrMiddleware, createWebhookHandler } from 'angular-isr/adapters/express';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// Set up ISR engine
const isrEngine = new IsrEngine({
  cache: new MemoryCacheAdapter(),
  cacheVersion: process.env['APP_VERSION'] ?? '1',
  routes: [
    { path: '/blog/**', ttl: 60, staleTtl: 300, tags: ['blog'], cacheHeaders: 'max-age=30, stale-while-revalidate=60' },
    { path: '/home',    ttl: 3600 },
  ],
  revalidation: {
    secret: process.env['ISR_SECRET'] ?? 'change-me',
    rateLimitPerMinute: 30,
    debounceMs: 500,
  },
  onEvent: (event) => console.log('[ISR]', event.type, event.path, event.cacheState ?? ''),
});

// Webhook endpoint (must come before the ISR middleware)
app.post(
  '/_isr/revalidate',
  express.json(),
  createWebhookHandler({
    cacheAdapter: isrEngine['config'].cache,
    secret: process.env['ISR_SECRET'] ?? 'change-me',
    onEvent: (event) => console.log('[ISR webhook]', event.meta),
  }),
);

// Static files
app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));

// Angular SSR request handler
const angularHandler = createNodeRequestHandler(async (req, res, next) => {
  const response = await angularApp.handle(req);
  if (response) {
    writeResponseToNodeResponse(response, res);
  } else {
    next();
  }
});

// ISR middleware — intercepts all other requests
app.use(createIsrMiddleware({ engine: isrEngine, angularHandler }));

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => console.log(`Node Express server listening on http://localhost:${port}`));
}

export const reqHandler = createNodeRequestHandler(app);
```

### 2. Angular — `src/app/app.config.ts`

```typescript
import { provideIsr } from 'angular-isr';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideIsr(),
  ],
};
```

### 3. Read ISR state in a component

```typescript
import { Component, inject } from '@angular/core';
import { IsrService } from 'angular-isr';

@Component({
  selector: 'app-blog-post',
  template: `
    @if (isr.cacheState()() === 'stale') {
      <div role="status" aria-live="polite">Refreshing content…</div>
    }
    <!-- page content -->
  `,
})
export class BlogPostComponent {
  protected isr = inject(IsrService);
}
```

---

## Multitenancy

Use a `tenantResolver` to scope caches by tenant. The resolver receives the raw Express `Request` object.

### Subdomain-based

```typescript
new IsrEngine({
  cache: new MemoryCacheAdapter(),
  tenantResolver: (req) => {
    const host = (req as Request).hostname; // e.g. 'tenant-a.example.com'
    return host.split('.')[0];              // → 'tenant-a'
  },
  // ...
});
```

### Path-prefix-based

```typescript
tenantResolver: (req) => {
  const path = (req as Request).path; // e.g. '/tenant-a/blog/post'
  return path.split('/')[1] ?? '';    // → 'tenant-a'
},
```

### Header-based

```typescript
tenantResolver: (req) => {
  return (req as Request).headers['x-tenant-id'] as string ?? 'default';
},
```

Each tenant's pages are fully isolated. Invalidating a path/tag for `tenant-a` never affects `tenant-b`.

---

## Per-Route ISR Configuration

```typescript
routes: [
  {
    path: '/blog/**',           // glob pattern
    ttl: 60,                    // seconds until entry becomes stale
    staleTtl: 600,              // seconds stale content is still served (default: Infinity)
    tags: ['blog', 'content'],  // tags for bulk invalidation
    revalidateOnDemand: true,   // allow webhook-based invalidation (default: true)
    cacheHeaders: 'max-age=30, stale-while-revalidate=60',  // CDN Cache-Control
  },
  {
    path: '/home',
    ttl: 3600,
  },
  {
    path: '/about',
    // No ttl = on-demand only (never auto-expires)
    tags: ['static'],
  },
],
```

---

## isr.fetch — Hybrid/Partial Rendering

The biggest differentiator: data-level cache control during SSR.

Pass `isrFetch` to your Angular services via a `REQUEST` token or custom provider, then use it instead of native `fetch()`:

```typescript
// In your Angular data service (server-side)
@Injectable({ providedIn: 'root' })
export class BlogService {
  async getPosts(isrFetch: IsrFetchFn): Promise<Post[]> {
    // This response IS included in the ISR cache (default behavior)
    const response = await isrFetch('https://cms.example.com/api/posts', {
      isr: { cache: true, ttl: 300, tags: ['blog'] },
    });
    return response.json();
  }

  async getCart(isrFetch: IsrFetchFn): Promise<Cart> {
    // This response is NEVER cached — fetched live on every request
    const response = await isrFetch('/api/user/cart', {
      isr: { cache: false },
    });
    return response.json();
  }
}
```

- `cache: true` (default) — response serialized into ISR `CacheEntry`, hydrated on client
- `cache: false` — fetched live on every request, not included in cached HTML

---

## CMS Webhooks

### Generic webhook

```bash
curl -X POST https://your-site.com/_isr/revalidate \
  -H "Content-Type: application/json" \
  -H "X-ISR-Secret: your-secret" \
  -H "X-Idempotency-Key: unique-event-id" \
  -d '{ "paths": ["/blog/my-post"], "tags": ["blog"], "tenant": "tenant-a" }'
```

Response:
```json
{ "message": "Revalidation scheduled", "paths": ["/blog/my-post"], "tags": ["blog"] }
```

### Contentful

```typescript
import { ContentfulIsrAdapter } from 'angular-isr/server';

const adapter = new ContentfulIsrAdapter({
  secret: process.env['CONTENTFUL_WEBHOOK_SECRET']!,
  contentTypeTagMap: {
    blogPost: ['blog', 'content'],
    author:   ['authors'],
  },
  pathResolver: (fields, contentType) => {
    const slug = fields['slug']?.['en-US'] as string;
    return slug ? `/blog/${slug}` : undefined;
  },
});

// In your webhook route:
app.post('/webhooks/contentful', express.json(), async (req, res) => {
  const payload = await adapter.parseWebhook(req);
  // Forward to ISR webhook handler or call cacheAdapter.deleteByTag directly
});
```

### Sanity

```typescript
import { SanityIsrAdapter } from 'angular-isr/server';

const adapter = new SanityIsrAdapter({
  secret: process.env['SANITY_WEBHOOK_SECRET']!,
  documentTypeTagMap: { post: ['blog'] },
  pathResolver: (doc) => {
    const slug = (doc as { slug?: { current?: string } }).slug?.current;
    return slug ? `/blog/${slug}` : undefined;
  },
});
```

### Strapi

```typescript
import { StrapiIsrAdapter } from 'angular-isr/server';

const adapter = new StrapiIsrAdapter({
  secret: process.env['STRAPI_WEBHOOK_TOKEN']!,
  modelTagMap: { 'api::blog-post.blog-post': ['blog'] },
});
```

---

## Custom Cache Adapter

Implement `CacheAdapter` to use Redis, a database, or any other storage:

```typescript
import { CacheAdapter, CacheEntry } from 'angular-isr/server';
import { createClient } from 'redis';

export class RedisCacheAdapter implements CacheAdapter {
  private client = createClient({ url: process.env['REDIS_URL'] });

  async get(key: string): Promise<CacheEntry | null> {
    const raw = await this.client.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const ttlSeconds = entry.ttl ? entry.ttl + (entry.staleTtl ?? 0) : undefined;
    await this.client.set(key, JSON.stringify(entry), ttlSeconds ? { EX: ttlSeconds } : undefined);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async deleteByTag(tenantId: string, tag: string): Promise<string[]> {
    const pattern = `${tenantId}:*`;
    const keys = await this.client.keys(pattern);
    const deleted: string[] = [];
    for (const key of keys) {
      const raw = await this.client.get(key);
      if (raw) {
        const entry: CacheEntry = JSON.parse(raw);
        if (entry.tags.includes(tag)) {
          await this.client.del(key);
          deleted.push(key);
        }
      }
    }
    return deleted;
  }

  async deleteByTenant(tenantId: string): Promise<string[]> {
    const pattern = `${tenantId}:*`;
    const keys = await this.client.keys(pattern);
    if (keys.length) await this.client.del(keys);
    return keys;
  }
}
```

---

## Custom Revalidation Queue Adapter

Implement `RevalidationQueueAdapter` to use BullMQ, RabbitMQ, or any queue:

```typescript
import { RevalidationQueueAdapter, RevalidationJob } from 'angular-isr/server';
import { Queue, Worker } from 'bullmq';

export class BullMqQueueAdapter implements RevalidationQueueAdapter {
  private queue = new Queue('isr-revalidation');

  onProcess(handler: (job: RevalidationJob) => Promise<void>): void {
    new Worker('isr-revalidation', async (job) => handler(job.data));
  }

  async enqueue(job: Omit<RevalidationJob, 'attempt' | 'enqueuedAt'>): Promise<void> {
    await this.queue.add('revalidate', job, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
  }
}
```

---

## Observability

Use `onEvent` to wire ISR events into your logging or metrics pipeline:

```typescript
new IsrEngine({
  // ...
  onEvent: (event) => {
    console.log({
      type: event.type,           // 'hit' | 'miss' | 'revalidate' | 'error' | 'webhook'
      tenant: event.tenantId,
      path: event.path,
      state: event.cacheState,
      duration: event.durationMs,
      error: event.error?.message,
      meta: event.meta,
    });

    // Example: send to Prometheus, Datadog, etc.
    metrics.increment(`isr.${event.type}`, { tenant: event.tenantId });
  },
});
```

---

## Cache Versioning (Deploy Invalidation)

Bump `cacheVersion` on each deployment to automatically invalidate all old cache entries:

```typescript
new IsrEngine({
  cache: new MemoryCacheAdapter(),
  cacheVersion: process.env['APP_VERSION'] ?? '1', // e.g. '2024-12-01-abc1234'
  // ...
});
```

Old entries with a different version are treated as cache misses. No manual cache flush needed on deploy.

---

## CDN / Cache-Control Headers

Set `cacheHeaders` per route to emit the correct `Cache-Control` headers for your CDN:

```typescript
routes: [
  {
    path: '/blog/**',
    ttl: 60,
    cacheHeaders: 'public, max-age=30, stale-while-revalidate=60, stale-if-error=86400',
  },
],
```

The `Cache-Control` header is set on every response served from cache (both `fresh` and `stale`).

---

## Retry Policy

Configure how failed background re-renders are retried:

```typescript
revalidation: {
  secret: process.env['ISR_SECRET']!,
  retryPolicy: {
    maxAttempts: 5,
    backoffMs: 2000, // exponential: 2s, 4s, 8s, 16s, 32s
  },
  deadLetterLog: (job, error) => {
    console.error('[ISR DLQ] Final render failure:', { path: job.path, tenant: job.tenantId, error: error.message });
    // Send to Sentry, PagerDuty, etc.
  },
},
```

---

## Entry Points

| Import | Use case |
|--------|----------|
| `angular-isr` | Angular components, app config (`provideIsr`, `IsrService`, `ISR_ROUTE_CONFIG`) |
| `angular-isr/server` | Server-side only: `IsrEngine`, cache adapters, CMS adapters, queue adapters |
| `angular-isr/adapters/express` | Express-specific: `createIsrMiddleware`, `createWebhookHandler` |

---

## License

MIT
