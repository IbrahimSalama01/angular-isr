import { computed, PLATFORM_ID, signal, TransferState, makeStateKey } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ANGULAR_ISR_TRANSFER_KEY } from '../types.js';
import type { CacheState } from '../types.js';

export interface IsrTransferState {
  cacheState: CacheState;
  ttl: number | null;
  tenant: string | null;
  tags: string[];
}

const ISR_STATE_KEY = makeStateKey<IsrTransferState>(ANGULAR_ISR_TRANSFER_KEY);

const DEFAULT_STATE: IsrTransferState = {
  cacheState: 'miss' as unknown as CacheState,
  ttl: null,
  tenant: null,
  tags: [],
};

/**
 * Angular service that exposes ISR cache metadata as signals.
 *
 * Reads ISR context written into TransferState by the server engine.
 * Only ISR-safe data (fetched via `isrFetch` with `cache: true`) is included.
 *
 * Note: no `@Injectable` decorator — this package is compiled via tsup (not ng-packagr),
 * so Angular decorators must not appear in the pre-built output. `IsrService` is
 * registered explicitly via `provideIsr()`.
 */
export class IsrService {
  private readonly _state = signal<IsrTransferState>(this.readTransferState());

  constructor(
    private readonly transferState: TransferState,
    private readonly platformId: object,
  ) {}

  /** The current ISR cache state for this page render */
  readonly cacheState = computed(() => this._state().cacheState);

  /** Seconds until this cache entry becomes stale (null = on-demand only) */
  readonly ttl = computed(() => this._state().ttl);

  /** Tenant ID this page was rendered for (null = single-tenant) */
  readonly tenant = computed(() => this._state().tenant);

  /** Cache tags associated with this page render */
  readonly tags = computed(() => this._state().tags);

  private readTransferState(): IsrTransferState {
    if (isPlatformBrowser(this.platformId)) {
      try {
        const stored = this.transferState.get(ISR_STATE_KEY, DEFAULT_STATE);
        this.transferState.remove(ISR_STATE_KEY);
        return stored;
      } catch {
        return DEFAULT_STATE;
      }
    }
    // On server: return default — server writes this via the engine
    return DEFAULT_STATE;
  }
}
