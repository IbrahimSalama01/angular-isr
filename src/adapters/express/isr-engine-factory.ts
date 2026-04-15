import type { RequestHandler } from 'express';
import { IsrEngine } from '../../core/isr-engine.js';
import { isrAsyncContext } from '../../core/isr-context.js';
import { createMockResponse } from './mock-response.js';
import { createMockRequest } from './mock-request.js';
import type { IsrEngineConfig, IsrFetchFn } from '../../types.js';

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

  // 1. Create the Express-specific render function factory.
  // This factory handles background revalidation using the provided Angular handler.
  const expressRenderFnFactory = (_tenantId: string, _path: string) => {
    return (isrFetch: IsrFetchFn) =>
      new Promise<string>((resolve, reject) => {
        const { mockRes, getHtml } = createMockResponse();
        const mockReq = createMockRequest(_path);

        isrAsyncContext.run({ isrFetch }, () => {
          try {
            const result = angularHandler(mockReq, mockRes as Parameters<RequestHandler>[1], (err?: unknown) => {
              if (err) reject(err instanceof Error ? err : new Error(String(err)));
              else reject(new Error('Angular handler passed to next() — no response captured'));
            });

            // Handle async handlers (if any)
            const promiseResult = result as unknown as Promise<void> | undefined;
            if (promiseResult?.catch) {
              promiseResult.catch(reject);
            }
          } catch (error) {
            reject(error);
          }
        });

        getHtml().then(resolve).catch(reject);
      });
  };

  // 2. Build the final revalidation config.
  // We ALWAYS provide the renderFnFactory if an angularHandler is available,
  // enabling background revalidation even if webhooks are not configured.
  const finalRevalidation: IsrEngineConfig['revalidation'] = {
    ...revalidation,
    renderFnFactory: expressRenderFnFactory,
  } as IsrEngineConfig['revalidation'];

  return new IsrEngine({
    ...engineConfig,
    revalidation: finalRevalidation,
  });
}
