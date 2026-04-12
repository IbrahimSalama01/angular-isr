/**
 * angular-isr — Angular client-side API
 *
 * Import from 'angular-isr' for Angular components, services, and app config.
 * This entry point is safe to import in Angular components (no Node.js-only APIs).
 */

// Angular providers
export { provideIsr } from './angular/isr.provider.js';
export { IsrService } from './angular/isr.service.js';
export type { IsrTransferState } from './angular/isr.service.js';
export { ISR_ROUTE_CONFIG } from './angular/isr-route-config.token.js';

// Types safe for Angular (no server-only types)
export type {
  CacheState,
  IsrClientConfig,
  IsrRouteConfig,
  IsrEvent,
  IsrFetchFn,
  IsrFetchOptions,
} from './types.js';

export { ANGULAR_ISR_TRANSFER_KEY } from './types.js';
