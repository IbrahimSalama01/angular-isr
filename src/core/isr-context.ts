import { AsyncLocalStorage } from 'node:async_hooks';
import type { IsrFetchFn } from '../types.js';

/**
 * Per-request async context that makes isrFetch available anywhere in the
 * call stack during an SSR render, without polluting the Express request object.
 *
 * Used by:
 * - isr-middleware.ts: sets the context for each render
 * - isr-engine-factory.ts: sets the context for background revalidation renders
 * - isr.provider.ts: reads the context to provide ISR_FETCH to Angular DI
 */
export interface IsrContext {
  isrFetch: IsrFetchFn;
}

export const isrAsyncContext = new AsyncLocalStorage<IsrContext>();
