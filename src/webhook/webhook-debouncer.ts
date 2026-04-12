import type { WebhookPayload } from '../types.js';

/**
 * Debounces and batches rapid incoming webhook payloads.
 *
 * When a CMS does a bulk publish, it may fire many webhooks in quick
 * succession. The debouncer collects them within a time window and
 * calls onFlush once with the merged payload.
 */
export class WebhookDebouncer {
  private pendingPaths = new Set<string>();
  private pendingTags = new Set<string>();
  private pendingTenants = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly delayMs: number;

  constructor(delayMs = 500) {
    this.delayMs = delayMs;
  }

  /**
   * Adds a payload to the pending batch and schedules a flush.
   * Resets the timer if called again within the window.
   */
  debounce(payload: WebhookPayload, onFlush: (merged: WebhookPayload) => void): void {
    payload.paths?.forEach((p) => this.pendingPaths.add(p));
    payload.tags?.forEach((t) => this.pendingTags.add(t));
    if (payload.tenant) this.pendingTenants.add(payload.tenant);

    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      const merged: WebhookPayload = {
        paths: this.pendingPaths.size > 0 ? [...this.pendingPaths] : undefined,
        tags: this.pendingTags.size > 0 ? [...this.pendingTags] : undefined,
        tenant: this.pendingTenants.size === 1 ? [...this.pendingTenants][0] : undefined,
      };

      this.pendingPaths.clear();
      this.pendingTags.clear();
      this.pendingTenants.clear();
      this.timer = null;

      onFlush(merged);
    }, this.delayMs);
  }

  /** Flush immediately (useful for testing) */
  flush(onFlush: (merged: WebhookPayload) => void): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const merged: WebhookPayload = {
      paths: this.pendingPaths.size > 0 ? [...this.pendingPaths] : undefined,
      tags: this.pendingTags.size > 0 ? [...this.pendingTags] : undefined,
      tenant: this.pendingTenants.size === 1 ? [...this.pendingTenants][0] : undefined,
    };

    this.pendingPaths.clear();
    this.pendingTags.clear();
    this.pendingTenants.clear();

    onFlush(merged);
  }
}
