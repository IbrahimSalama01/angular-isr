import type { RequestHandler } from 'express';
import { IsrEngine } from '../../core/isr-engine.js';
import type { IsrEngineConfig } from '../../types.js';

export interface IsrEngineFactoryOptions extends Omit<IsrEngineConfig, 'revalidation'> {
  /**
   * The Angular SSR request handler (from AngularNodeAppEngine or similar).
   * Used for both immediate rendering and background revalidation.
   */
  angularHandler: RequestHandler;
  /**
   * Revalidation configuration.
   * If provided, background revalidation will be enabled.
   */
  revalidation?: Omit<IsrEngineConfig['revalidation'], 'renderFnFactory'>;
}

/**
 * Creates an IsrEngine configured with an Express-specific renderFnFactory.
 *
 * This helper function configures the engine to use the Angular SSR handler
 * for both immediate request rendering and background revalidation jobs.
 *
 * Usage in server.ts:
 * ```ts
 * import { createIsrEngine, createIsrMiddleware } from 'angular-isr/adapters/express';
 *
 * const engine = createIsrEngine({
 *   cache: new MemoryCacheAdapter(),
 *   angularHandler: reqHandler,
 *   revalidation: {
 *     secret: process.env.ISR_SECRET!,
 *   },
 * });
 *
 * app.use(createIsrMiddleware({ engine, angularHandler: reqHandler }));
 * ```
 */
export function createIsrEngine(options: IsrEngineFactoryOptions): IsrEngine {
  const { angularHandler, revalidation, ...engineConfig } = options;

  // Create the renderFnFactory for background revalidation
  const finalRevalidation: IsrEngineConfig['revalidation'] = revalidation
    ? ({
        ...revalidation,
        renderFnFactory: (_tenantId: string, _path: string) => {
          // For background revalidation, we create a mock request
          // The actual request context is reconstructed by the engine
          return (isrFetch) =>
            new Promise<string>((resolve, reject) => {
              const chunks: Buffer[] = [];

              const mockReq = {
                path: _path,
                method: 'GET',
                headers: {},
                // Add minimal request properties needed by Angular SSR
              } as unknown as Parameters<RequestHandler>[0];

              const mockRes: any = {
                statusCode: 200,
                status(code: number) {
                  this.statusCode = code;
                  return this;
                },
                setHeader() { return this; },
                getHeader() { return undefined; },
                removeHeader() { return this; },
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
                  this.write(JSON.stringify(obj));
                  this.end();
                  return this;
                },
                on() { return this; },
                once() { return this; },
                emit() { return false; },
              };

              try {
                const result = angularHandler(mockReq, mockRes as Parameters<RequestHandler>[1], (err?: unknown) => {
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
        },
      } as IsrEngineConfig['revalidation'])
    : undefined;

  return new IsrEngine({
    ...engineConfig,
    revalidation: finalRevalidation,
  });
}
