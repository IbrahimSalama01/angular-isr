import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { IsrEngine } from '../../core/isr-engine.js';
import { isrAsyncContext } from '../../core/isr-context.js';
import { createMockResponse } from './mock-response.js';
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
 * Static asset file extension pattern — these requests bypass ISR entirely.
 */
const STATIC_EXT_RE = /\.(?:js|mjs|cjs|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|avif|map|json|xml|txt|pdf)$/i;

/**
 * Creates an Express middleware that wraps the ISR engine.
 *
 * Only intercepts navigational HTML requests (GET/HEAD that accept text/html
 * and do not resolve to a static asset). All other requests are passed to next().
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
    // Only intercept navigational HTML requests
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (STATIC_EXT_RE.test(req.path)) return next();
    if (!req.accepts('html')) return next();

    const path = req.path;

    try {
      // Create render function for the engine
      const renderFn = createRenderFn(angularHandler, req);

      // Let the engine handle the full ISR pipeline
      const result = await engine.handle(req, path, renderFn);

      // Send the response
      sendCachedResponse(res, result.html, engine.matchRoute(path));
    } catch (error) {
      next(error);
    }
  };
}

function sendCachedResponse(res: Response, html: string, routeConfig?: IsrRouteConfig): void {
  if (routeConfig?.cacheHeaders) {
    res.setHeader('Cache-Control', routeConfig.cacheHeaders);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

/**
 * Creates a renderFn that drives Angular SSR via the Express handler.
 * Wraps the handler in an AsyncLocalStorage context so isrFetch is available
 * anywhere in the Angular DI tree during SSR (via inject(ISR_FETCH)).
 */
function createRenderFn(
  angularHandler: RequestHandler,
  originalReq: Request,
): (isrFetch: IsrFetchFn) => Promise<string> {
  return (isrFetch: IsrFetchFn): Promise<string> => {
    const { mockRes, getHtml, rejectHtml } = createMockResponse();

    // Run the Angular handler inside the ISR async context so inject(ISR_FETCH) works
    isrAsyncContext.run({ isrFetch }, () => {
      try {
        const result = angularHandler(originalReq, mockRes as Response, (err?: unknown) => {
          // If Angular calls next() it means it didn't handle the request — always an error here
          const error = err instanceof Error ? err : new Error(
            err ? String(err) : 'Angular handler called next() — no response captured',
          );
          rejectHtml(error);
        });
        if (result instanceof Promise) {
          result.catch((err) => rejectHtml(err instanceof Error ? err : new Error(String(err))));
        }
      } catch (error) {
        rejectHtml(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return getHtml();
  };
}
