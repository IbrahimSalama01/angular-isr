import type { Request, RequestHandler, Response } from 'express';
import { IdempotencyStore } from '../../revalidation/idempotency-store.js';
import { RateLimiter } from '../../webhook/rate-limiter.js';
import { verifySecret } from '../../webhook/secret-auth.js';
import { WebhookDebouncer } from '../../webhook/webhook-debouncer.js';
import type { CacheAdapter, IsrEvent, WebhookPayload } from '../../types.js';
import { normalizePath } from '../../core/cache-key.js';

export interface WebhookHandlerOptions {
  cacheAdapter: CacheAdapter;
  secret: string;
  /** Max requests per minute per IP. Default: 60 */
  rateLimitPerMinute?: number;
  /** Debounce window in ms. Default: 500 */
  debounceMs?: number;
  /** Optional: pre-render invalidated paths after cache deletion */
  preRender?: (tenantId: string, paths: string[]) => Promise<void>;
  onEvent?: (event: IsrEvent) => void;
}

/**
 * Creates an Express request handler for the ISR revalidation webhook.
 *
 * Usage in server.ts:
 * ```ts
 * import { createWebhookHandler } from 'angular-isr/adapters/express';
 *
 * app.post('/_isr/revalidate', createWebhookHandler({ cacheAdapter, secret: process.env.ISR_SECRET! }));
 * ```
 *
 * The webhook accepts POST requests with JSON body:
 * ```json
 * { "paths": ["/blog/my-post"], "tags": ["blog"], "tenant": "tenant-a" }
 * ```
 *
 * Optional headers:
 * - `X-ISR-Secret`: shared secret for authentication
 * - `X-Idempotency-Key`: deduplication key
 */
export function createWebhookHandler(options: WebhookHandlerOptions): RequestHandler {
  const {
    cacheAdapter,
    secret,
    rateLimitPerMinute = 60,
    debounceMs = 500,
    preRender,
    onEvent,
  } = options;

  const rateLimiter = new RateLimiter(rateLimitPerMinute);
  const idempotencyStore = new IdempotencyStore();
  const debouncer = new WebhookDebouncer(debounceMs);

  return async (req: Request, res: Response): Promise<void> => {
    // 1. Rate limiting
    const identifier = getClientIdentifier(req);
    if (!rateLimiter.isAllowed(identifier)) {
      res.status(429).json({ error: 'Too Many Requests' });
      return;
    }

    // 2. Authentication
    if (!verifySecret(req.headers as Record<string, string | undefined>, secret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // 3. Idempotency
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      if (idempotencyStore.has(idempotencyKey)) {
        res.status(200).json({ message: 'Already processed', idempotencyKey });
        return;
      }
      idempotencyStore.set(idempotencyKey);
    }

    // 4. Parse body
    const body = req.body as WebhookPayload;
    const payload: WebhookPayload = {
      paths: Array.isArray(body?.paths) ? body.paths.map(normalizePath) : undefined,
      tags: Array.isArray(body?.tags) ? body.tags : undefined,
      tenant: typeof body?.tenant === 'string' ? body.tenant : undefined,
    };

    // 5. Debounce + process
    debouncer.debounce(payload, async (merged) => {
      const result = await processInvalidation(merged, cacheAdapter, preRender, onEvent);
      // Note: response is already sent at this point — this runs in background
      void result;
    });

    // Respond immediately — actual invalidation happens in debounced callback
    res.status(202).json({
      message: 'Revalidation scheduled',
      paths: payload.paths,
      tags: payload.tags,
      tenant: payload.tenant,
    });
  };
}

async function processInvalidation(
  payload: WebhookPayload,
  cacheAdapter: CacheAdapter,
  preRender?: (tenantId: string, paths: string[]) => Promise<void>,
  onEvent?: (event: IsrEvent) => void,
): Promise<{ revalidated: string[]; errors: string[] }> {
  const revalidated: string[] = [];
  const errors: string[] = [];
  const tenantId = payload.tenant ?? '';

  try {
    // Path-based invalidation
    if (payload.paths?.length) {
      for (const path of payload.paths) {
        try {
          await cacheAdapter.delete(path);
          revalidated.push(path);
        } catch (err) {
          errors.push(`path:${path}:${String(err)}`);
        }
      }
    }

    // Tag-based invalidation
    if (payload.tags?.length) {
      for (const tag of payload.tags) {
        try {
          const deleted = await cacheAdapter.deleteByTag(tenantId, tag);
          revalidated.push(...deleted);
        } catch (err) {
          errors.push(`tag:${tag}:${String(err)}`);
        }
      }
    }

    // Tenant-only invalidation
    if (!payload.paths?.length && !payload.tags?.length && tenantId) {
      try {
        const deleted = await cacheAdapter.deleteByTenant(tenantId);
        revalidated.push(...deleted);
      } catch (err) {
        errors.push(`tenant:${tenantId}:${String(err)}`);
      }
    }

    // Optional pre-render of invalidated paths
    if (preRender && payload.paths?.length) {
      try {
        await preRender(tenantId, payload.paths);
      } catch (err) {
        errors.push(`preRender:${String(err)}`);
      }
    }

    onEvent?.({
      type: 'webhook',
      tenantId,
      path: payload.paths?.[0] ?? '',
      meta: { revalidated: revalidated.length, errors: errors.length, tags: payload.tags },
    });
  } catch (error) {
    errors.push(String(error));
  }

  return { revalidated, errors };
}

function getClientIdentifier(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}
