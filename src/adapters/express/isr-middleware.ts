import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { IsrEngine } from '../../core/isr-engine.js';
import type { IsrFetchFn, IsrRouteConfig } from '../../types.js';

export interface IsrMiddlewareOptions {
  engine: IsrEngine;
  /**
   * The Angular SSR request handler (from AngularNodeAppEngine or similar).
   * Called to render a page when the cache is cold.
   */
  angularHandler: RequestHandler;
}

/**
 * Creates an Express middleware that wraps the ISR engine.
 *
 * Usage in server.ts:
 * ```ts
 * import { createIsrMiddleware } from 'angular-isr/adapters/express';
 *
 * app.use(createIsrMiddleware({ engine, angularHandler: reqHandler }));
 * ```
 */
export function createIsrMiddleware(options: IsrMiddlewareOptions): RequestHandler {
  const { engine, angularHandler } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const path = req.path;

    try {
      const routeConfig = engine.matchRoute(path);
      const tenantId = await resolveTenant(engine, req);
      const cacheKey = engine.buildCacheKey(req, tenantId, path);

      // Check cache first via the engine's full handle flow
      const cached = await engine['config'].cache.get(cacheKey);

      if (cached && cached.version === (engine['cacheVersion'] ?? '0')) {
        if (cached.state === 'fresh' || cached.state === 'revalidating') {
          sendCachedResponse(res, cached.html, routeConfig);
          return;
        }

        if (cached.state === 'stale') {
          // Serve stale immediately
          sendCachedResponse(res, cached.html, routeConfig);
          // Schedule background revalidation
          scheduleBackground(engine, req, tenantId, path, cacheKey, routeConfig, cached.html, angularHandler);
          return;
        }
      }

      // Cache miss or version mismatch — render synchronously
      const html = await renderAndCache(engine, req, tenantId, path, cacheKey, routeConfig, angularHandler);
      sendCachedResponse(res, html, routeConfig);
    } catch (error) {
      next(error);
    }
  };
}

async function resolveTenant(engine: IsrEngine, req: Request): Promise<string> {
  const resolver = engine['config'].tenantResolver;
  if (!resolver) return '';
  try {
    return await resolver(req);
  } catch {
    return '';
  }
}

function sendCachedResponse(res: Response, html: string, routeConfig?: IsrRouteConfig): void {
  if (routeConfig?.cacheHeaders) {
    res.setHeader('Cache-Control', routeConfig.cacheHeaders);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

async function renderAndCache(
  engine: IsrEngine,
  req: Request,
  tenantId: string,
  path: string,
  _cacheKey: string,
  routeConfig: IsrRouteConfig | undefined,
  angularHandler: RequestHandler,
): Promise<string> {
  const renderFn = createRenderFn(angularHandler, req);
  return engine.renderForRequest(tenantId, path, renderFn, routeConfig);
}

function scheduleBackground(
  engine: IsrEngine,
  req: Request,
  tenantId: string,
  path: string,
  _cacheKey: string,
  routeConfig: IsrRouteConfig | undefined,
  _staleHtml: string,
  angularHandler: RequestHandler,
): void {
  const renderFn = createRenderFn(angularHandler, req);
  // Fire and forget
  engine.renderForRequest(tenantId, path, renderFn, routeConfig).catch(() => {/* logged by engine */});
}

/**
 * Creates a renderFn that drives Angular SSR via the Express handler.
 * Captures the HTML response from the Angular handler.
 */
function createRenderFn(
  angularHandler: RequestHandler,
  originalReq: Request,
): (isrFetch: IsrFetchFn) => Promise<string> {
  return (_isrFetch: IsrFetchFn) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const headers: Record<string, string> = {};

      // Create a mock response to capture Angular's output
      const mockRes = {
        statusCode: 200,
        setHeader(name: string, value: string) {
          headers[name.toLowerCase()] = value;
        },
        getHeader(name: string) {
          return headers[name.toLowerCase()];
        },
        removeHeader(name: string) {
          delete headers[name.toLowerCase()];
        },
        write(chunk: Buffer | string) {
          if (typeof chunk === 'string') {
            chunks.push(Buffer.from(chunk));
          } else {
            chunks.push(chunk);
          }
          return true;
        },
        end(chunk?: Buffer | string) {
          if (chunk) {
            if (typeof chunk === 'string') {
              chunks.push(Buffer.from(chunk));
            } else {
              chunks.push(chunk);
            }
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        },
        on() { return this; },
        once() { return this; },
        emit() { return false; },
      } as unknown as Response;

      try {
        const result = angularHandler(originalReq, mockRes, (err?: unknown) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else reject(new Error('Angular handler passed to next() — no response captured'));
        });
        if (result instanceof Promise) {
          result.catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
}
