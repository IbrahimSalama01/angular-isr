import type { RevalidationJob, RevalidationQueueAdapter, RetryPolicy } from '../types.js';

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 1000,
};

/**
 * In-memory revalidation queue.
 *
 * Features:
 * - Deduplication: only one in-flight render per cacheKey
 * - Exponential backoff retry
 * - Dead-letter logging on final failure
 */
export class MemoryQueueAdapter implements RevalidationQueueAdapter {
  private handler?: (job: RevalidationJob) => Promise<void>;
  private readonly inFlight = new Set<string>();
  private readonly retryPolicy: RetryPolicy;
  private readonly deadLetterLog?: (job: RevalidationJob, error: Error) => void;

  constructor(options?: {
    retryPolicy?: RetryPolicy;
    deadLetterLog?: (job: RevalidationJob, error: Error) => void;
  }) {
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options?.retryPolicy };
    this.deadLetterLog = options?.deadLetterLog;
  }

  onProcess(handler: (job: RevalidationJob) => Promise<void>): void {
    this.handler = handler;
  }

  async enqueue(job: Omit<RevalidationJob, 'attempt' | 'enqueuedAt'>): Promise<void> {
    if (this.inFlight.has(job.cacheKey)) {
      return; // deduplicate
    }
    this.inFlight.add(job.cacheKey);
    const fullJob: RevalidationJob = { ...job, attempt: 1, enqueuedAt: Date.now() };
    // Fire and forget — process in background
    this.processWithRetry(fullJob).catch((err) => {
      // This should never happen — processWithRetry handles its own errors internally.
      // If we reach here, there is a bug in processWithRetry itself.
      console.error('[angular-isr] Unexpected error in processWithRetry — this is a bug:', err);
    });
  }

  private async processWithRetry(job: RevalidationJob): Promise<void> {
    if (!this.handler) {
      this.inFlight.delete(job.cacheKey);
      return;
    }

    try {
      await this.handler(job);
      this.inFlight.delete(job.cacheKey);
    } catch (error) {
      if (job.attempt >= this.retryPolicy.maxAttempts) {
        this.inFlight.delete(job.cacheKey);
        this.deadLetterLog?.(job, error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const delay = this.retryPolicy.backoffMs * Math.pow(2, job.attempt - 1);
      await sleep(delay);
      await this.processWithRetry({ ...job, attempt: job.attempt + 1 });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
