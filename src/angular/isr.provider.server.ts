import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { ISR_FETCH } from './isr-fetch.token.js';
import { isrAsyncContext } from '../core/isr-context.js';

/**
 * Provides server-side ISR services for the Angular application.
 * This provider should be added to `app.config.server.ts`.
 *
 * It overrides the default `ISR_FETCH` provider to use the `isrFetch` function
 * from the current request's `AsyncLocalStorage` context. This allows
 * automatic cache-tag tracking for data fetched during SSR.
 *
 * Usage in `app.config.server.ts`:
 * ```ts
 * import { provideIsrServer } from 'angular-isr/server';
 *
 * export const serverConfig: ApplicationConfig = {
 *   providers: [
 *     provideServerRendering(),
 *     provideIsrServer(),
 *   ],
 * };
 * ```
 */
export function provideIsrServer(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: ISR_FETCH,
      useFactory: () => {
        const context = isrAsyncContext.getStore();
        return context?.isrFetch ?? globalThis.fetch.bind(globalThis);
      },
    },
  ]);
}
