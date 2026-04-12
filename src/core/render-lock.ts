/**
 * Per-key render lock that prevents cache stampede.
 *
 * When multiple concurrent requests arrive for the same uncached page,
 * only the first triggers a render. Subsequent requests queue up and
 * read the result from cache once the first render completes.
 */
export class RenderLock {
  private readonly locks = new Map<string, Promise<void>>();

  /**
   * Acquires the lock for `key`.
   *
   * - If no lock exists, creates one and returns a release function.
   * - If a lock already exists, waits for it to be released (the caller
   *   should then read from cache rather than rendering again).
   *
   * @returns `{ acquired: true, release }` if this caller owns the lock,
   *          `{ acquired: false }` if this caller waited for another render.
   */
  async acquire(key: string): Promise<{ acquired: true; release: () => void } | { acquired: false }> {
    if (this.locks.has(key)) {
      // Another render is in progress — wait for it
      await this.locks.get(key);
      return { acquired: false };
    }

    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.locks.set(key, lock);

    return {
      acquired: true,
      release: () => {
        this.locks.delete(key);
        release();
      },
    };
  }

  /** Returns true if a render is already in progress for this key */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }
}
