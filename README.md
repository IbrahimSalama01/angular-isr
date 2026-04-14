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
import { MemoryCacheAdapter } from 'angular-isr/server';
import { createIsrEngine, createIsrMiddleware, createWebhookHandler } from 'angular-isr/adapters/express';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// Angular SSR request handler (AngularNodeAppEngine - Angular 19+)
const angularHandler = createNodeRequestHandler(async (req, res, next) => {
  const response = await angularApp.handle(req);
  if (response) {
    writeResponseToNodeResponse(response, res);
  } else {
    next();
  }
});

/**
 * OR: Angular 17/18 CommonEngine approach
 *
 * import { CommonEngine } from '@angular/ssr';
 * const commonEngine = new CommonEngine();
 *
 * const angularHandler: RequestHandler = (req, res, next) => {
 *   commonEngine
 *     .render({
 *       bootstrap: AppServerModule,
 *       documentFilePath: join(serverDistFolder, 'index.server.html'),
 *       url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
 *       publicPath: browserDistFolder,
 *       providers: [{ provide: APP_BASE_HREF, useValue: req.baseUrl }],
 *     })
 *     .then((html) => res.send(html))
 *     .catch((err) => next(err));
 * };
 */

// Set up ISR engine — createIsrEngine() auto-wires background revalidation
// using the same angularHandler, so you don't need to configure renderFnFactory manually.
const isrEngine = createIsrEngine({
  angularHandler,
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
    engine: isrEngine,
    secret: process.env['ISR_SECRET'] ?? 'change-me',
    onEvent: (event) => console.log('[ISR webhook]', event.meta),
  }),
);

// Static files
app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));

// ISR middleware — intercepts all HTML page requests
app.use(createIsrMiddleware({ engine: isrEngine, angularHandler }));

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => console.log(`Node Express server listening on http://localhost:${port}`));
}

export const reqHandler = createNodeRequestHandler(app);
```

> **Why `createIsrEngine()` instead of `new IsrEngine()`?**  
> `createIsrEngine()` is a factory helper that automatically configures `renderFnFactory` for background revalidation using your `angularHandler`. Without it, stale pages will be served indefinitely because background re-renders won't have access to the Angular render pipeline.

### 2. Angular — `src/app/app.config.ts`

```typescript
import { provideIsr } from 'angular-isr';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideIsr(), // Shared providers (client + server)
  ],
};
```

### 3. Angular Server — `src/app/app.config.server.ts`

```typescript
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { provideIsrServer } from 'angular-isr/server';
import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    provideIsrServer(), // Required for ISR-aware fetching (AsyncLocalStorage)
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
```

### 4. Read ISR state in a component

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

## Production Deployment

### MemoryCacheAdapter vs Redis

The built-in `MemoryCacheAdapter` is suitable for local development and single-instance deployments. However, in a production environment with multiple server instances (load-balanced), each instance will have its own isolated memory cache.

For multi-instance deployments, you **must** use a distributed cache like **Redis**. This ensures that all instances share the same cache state and that a webhook-triggered invalidation affects all instances simultaneously.

See the [Custom Cache Adapter](#custom-cache-adapter) section for a Redis implementation example.

---

## Hybrid Rendering with isr.fetch()

The biggest differentiator: data-level cache control during SSR.

Instead of using the native `fetch()`, inject the `ISR_FETCH` token. This allows the ISR engine to track data dependencies and automatically handle hydration.

### 1. In your Angular service

```typescript
import { inject, Injectable } from '@angular/core';
import { ISR_FETCH } from 'angular-isr';

@Injectable({ providedIn: 'root' })
export class BlogService {
  private fetch = inject(ISR_FETCH);

  async getPosts() {
    // This response IS included in the ISR cache (default behavior)
    // It will be cached for 300s and tagged with 'blog'
    const response = await this.fetch('https://cms.example.com/api/posts', {
      isr: { cache: true, ttl: 300, tags: ['blog'] },
    });
    return response.json();
  }

  async getCart() {
    // This response is NEVER cached — fetched live on every request
    const response = await this.fetch('/api/user/cart', {
      isr: { cache: false },
    });
    return response.json();
  }
}
```

- `cache: true` (default) — response serialized into ISR `CacheEntry`, hydrated on client.
- `cache: false` — fetched live on every request, not included in cached HTML.

---

## CMS Integration

Connecting your CMS to `angular-isr` allows for instant updates when content changes.

### 1. Setup CMS Adapter

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
```

### 2. Connect to Engine

Use `engine.invalidate()` to purge the cache when a webhook is received.

```typescript
app.post('/webhooks/contentful', express.json(), async (req, res) => {
  try {
    const payload = await adapter.parseWebhook(req);
    
    // Invalidate the paths and tags returned by the adapter
    await isrEngine.invalidate({
      tenantId: '', // optional tenant
      paths: payload.paths,
      tags: payload.tags,
    });
    
    res.status(200).json({ message: 'Invalidated' });
  } catch (err) {
    res.status(401).json({ error: 'Invalid secret' });
  }
});
```

We also support [Sanity](#sanity) and [Strapi](#strapi) out of the box.

---

## CMS Webhooks (Generic)

If you aren't using a built-in adapter, you can call our generic webhook handler:

```bash
curl -X POST https://your-site.com/_isr/revalidate \
  -H "Content-Type: application/json" \
  -H "X-ISR-Secret: your-secret" \
  -d '{ "paths": ["/blog/my-post"], "tags": ["blog"] }'
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
| `angular-isr` | Angular components, app config (`provideIsr`, `IsrService`, `ISR_FETCH`, `withIsrConfig`) |
| `angular-isr/server` | Server-side only: `IsrEngine`, `provideIsrServer`, cache adapters, CMS adapters, queue adapters |
| `angular-isr/adapters/express` | Express-specific: `createIsrEngine`, `createIsrMiddleware`, `createWebhookHandler` |

---

## API Reference

### Angular (@angular-isr)

- `provideIsr(config?)`: Provides ISR services to your Angular app.
- `IsrService`: Injectable service that exposes `cacheState()`, `ttl()`, and `tags()` signals.
- `ISR_FETCH`: Injection token for an ISR-aware fetch function.
- `withIsrConfig(config)`: Helper to set ISR configuration in route data.
  ```ts
  { path: 'home', component: HomeComponent, data: withIsrConfig({ ttl: 3600 }) }
  ```

### Server (@angular-isr/server)

- `IsrEngine`: The core ISR engine.
- `MemoryCacheAdapter`: In-memory cache storage (single-instance only).
- `IsrEngine.invalidate({ tenantId, paths, tags })`: Programmatically invalidate cache entries.

### Express (`angular-isr/adapters/express`)

- `createIsrEngine(options)`: **Recommended** — creates an `IsrEngine` pre-wired for Express. Accepts the same options as `IsrEngine` plus `angularHandler`, and automatically configures background revalidation using that handler. Use instead of `new IsrEngine()` in Express apps.
- `createIsrMiddleware({ engine, angularHandler })`: Creates Express middleware that intercepts HTML page requests through the ISR pipeline.
- `createWebhookHandler({ engine, secret, ... })`: Handles on-demand revalidation webhooks. Always pass `engine` (not the deprecated `cacheAdapter`) for correct cache-key-based invalidation.

---

## License

MIT
