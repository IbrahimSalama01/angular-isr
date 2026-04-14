import { InjectionToken } from '@angular/core';
import type { IsrFetchFn } from '../types.js';

/**
 * Injection token for the ISR-aware fetch function.
 *
 * During SSR, this resolves to the `isrFetch` instance created by the ISR engine,
 * which tracks data fetches for cache invalidation.
 *
 * During client-side rendering (browser), this falls back to the native
 * `globalThis.fetch` function.
 *
 * Usage in Angular services/components:
 * ```ts
 * import { inject } from '@angular/core';
 * import { ISR_FETCH } from 'angular-isr';
 *
 * const fetch = inject(ISR_FETCH);
 * const data = await fetch('/api/posts').then(r => r.json());
 * ```
 *
 * Register via provideIsr() in app.config.ts — no manual provider needed.
 */
export const ISR_FETCH = new InjectionToken<IsrFetchFn>('ISR_FETCH');
