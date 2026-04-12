import { InjectionToken } from '@angular/core';
import type { IsrRouteConfig } from '../types.js';

/**
 * Injection token for per-route ISR configuration.
 *
 * Set in route `data` to configure ISR behavior for a specific route:
 *
 * ```ts
 * // app.routes.ts
 * export const routes: Routes = [
 *   {
 *     path: 'blog/:slug',
 *     component: BlogPostComponent,
 *     data: {
 *       [ISR_ROUTE_CONFIG as unknown as string]: {
 *         ttl: 60,
 *         staleTtl: 300,
 *         tags: ['blog'],
 *         cacheHeaders: 'max-age=30, stale-while-revalidate=60',
 *       } satisfies IsrRouteConfig,
 *     },
 *   },
 * ];
 * ```
 *
 * Or inject it in a component to read the current route's ISR config:
 *
 * ```ts
 * const isrConfig = inject(ISR_ROUTE_CONFIG, { optional: true });
 * ```
 */
export const ISR_ROUTE_CONFIG = new InjectionToken<IsrRouteConfig>('ISR_ROUTE_CONFIG');
