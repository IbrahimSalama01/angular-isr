import {
  EnvironmentProviders,
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  PLATFORM_ID,
  TransferState,
} from '@angular/core';
import { IsrService } from './isr.service.js';
import { ISR_FETCH } from './isr-fetch.token.js';
import type { IsrClientConfig } from '../types.js';

/**
 * Injection token for the Angular-side ISR client configuration.
 * Provided automatically by provideIsr(config).
 */
export const ISR_CLIENT_CONFIG = new InjectionToken<IsrClientConfig>('ISR_CLIENT_CONFIG');

/**
 * Provides ISR services for the Angular application.
 *
 * Call in your `app.config.ts`:
 *
 * ```ts
 * import { provideIsr } from 'angular-isr';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideRouter(routes),
 *     provideClientHydration(withEventReplay()),
 *     provideIsr({
 *       routes: [
 *         { path: '/blog/**', ttl: 60, staleTtl: 300, tags: ['blog'] },
 *         { path: '/home', ttl: 3600 },
 *       ],
 *     }),
 *   ],
 * };
 * ```
 *
 * This is intentionally thin — all ISR business logic runs on the server.
 * The Angular layer only exposes cache metadata to components via `IsrService`.
 *
 * Note: `IsrService` is provided via an explicit factory (no `@Injectable` decorator)
 * because this package is compiled with tsup, not ng-packagr. Angular decorators in
 * pre-compiled library output would trigger the JIT runtime path in production builds.
 */
export function provideIsr(config?: IsrClientConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    // Provide the config token so future client-side features can read it
    ...(config ? [{ provide: ISR_CLIENT_CONFIG, useValue: config }] : []),

    // IsrService reads ISR metadata from TransferState (written by the server engine)
    {
      provide: IsrService,
      useFactory: () => new IsrService(inject(TransferState), inject(PLATFORM_ID)),
    },

    // ISR_FETCH falls back to native fetch by default.
    // On the server, it should be overridden via provideIsrServer() in app.config.server.ts
    // to enable ISR-aware fetching using AsyncLocalStorage.
    {
      provide: ISR_FETCH,
      useFactory: () => globalThis.fetch.bind(globalThis),
    },
  ]);
}
