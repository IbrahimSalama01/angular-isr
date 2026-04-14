import { ISR_ROUTE_CONFIG } from './isr-route-config.token.js';
import type { IsrRouteConfig } from '../types.js';

/**
 * Creates route `data` that sets ISR configuration for a specific route.
 *
 * Eliminates the need for the awkward `[ISR_ROUTE_CONFIG as unknown as string]` pattern.
 *
 * Usage:
 * ```ts
 * import { withIsrConfig } from 'angular-isr';
 *
 * export const routes: Routes = [
 *   {
 *     path: 'blog/:slug',
 *     component: BlogPostComponent,
 *     data: withIsrConfig({ ttl: 60, staleTtl: 300, tags: ['blog'] }),
 *   },
 * ];
 * ```
 */
export function withIsrConfig(config: Omit<IsrRouteConfig, 'path'>): Record<string, unknown> {
  return { [ISR_ROUTE_CONFIG as unknown as string]: config };
}
