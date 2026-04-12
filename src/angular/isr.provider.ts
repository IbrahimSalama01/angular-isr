import { EnvironmentProviders, inject, makeEnvironmentProviders, PLATFORM_ID, TransferState } from '@angular/core';
import { IsrService } from './isr.service.js';
import type { IsrClientConfig } from '../types.js';

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
export function provideIsr(_config?: IsrClientConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: IsrService,
      useFactory: () => new IsrService(inject(TransferState), inject(PLATFORM_ID)),
    },
  ]);
}
