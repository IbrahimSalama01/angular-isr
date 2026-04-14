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
      const mockRes: any = {
        statusCode: 200,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        setHeader(name: string, value: string) {
          headers[name.toLowerCase()] = value;
          return this;
        },
        getHeader(name: string) {
          return headers[name.toLowerCase()];
        },
        removeHeader(name: string) {
          delete headers[name.toLowerCase()];
          return this;
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
          return this;
        },
        send(body: any) {
          if (typeof body === 'string') {
            this.write(body);
          } else if (Buffer.isBuffer(body)) {
            this.write(body);
          } else {
            this.json(body);
            return this;
          }
          this.end();
          return this;
        },
        json(obj: any) {
          this.setHeader('Content-Type', 'application/json');
          this.write(JSON.stringify(obj));
          this.end();
          return this;
        },
        on() { return this; },
        once() { return this; },
        emit() { return false; },
      };

      try {
        const result = angularHandler(originalReq, mockRes as Response, (err?: unknown) => {
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
