import { I18nError } from "./errors";

/**
 * A map that keeps at most `capacity` entries, dropping the least recently used first. Reads and
 * writes are O(1) (a `Map` iterates in insertion order, and a hit re-inserts the key). The
 * instance keeps its compiled messages in one (the `cacheSize` option).
 * @internal
 */
export class BoundedCache<K, V> {
  readonly #capacity: number;
  readonly #store = new Map<K, V>();

  /**
   * @param capacity Most entries kept; rounded down, and at least 1.
   * @throws I18nError `INVALID_VALUE` when `capacity` is not a finite number: `NaN` and infinity
   *   would make every size comparison false and leave the cache unbounded.
   */
  constructor(capacity: number) {
    if (!Number.isFinite(capacity)) {
      throw new I18nError(
        "INVALID_VALUE",
        __DEV__ ? `a cache size must be a finite number, got ${capacity}.` : "I18N_CACHE",
      );
    }
    this.#capacity = Math.max(1, Math.floor(capacity));
  }

  /** Number of entries held. */
  get size(): number {
    return this.#store.size;
  }

  /** Most entries kept, after rounding. */
  get capacity(): number {
    return this.#capacity;
  }

  /** The value of `key`, marked as most recently used, or `undefined`. */
  get(key: K): V | undefined {
    if (!this.#store.has(key)) return undefined;
    const value = this.#store.get(key) as V;
    this.#store.delete(key);
    this.#store.set(key, value);
    return value;
  }

  /** True when `key` is held; does not change the order. */
  has(key: K): boolean {
    return this.#store.has(key);
  }

  /** Stores `value` as the most recently used entry, dropping the oldest when over capacity. */
  set(key: K, value: V): void {
    this.#store.delete(key);
    this.#store.set(key, value);
    if (this.#store.size > this.#capacity) {
      const oldest = this.#store.keys().next();
      if (oldest.done !== true) this.#store.delete(oldest.value);
    }
  }

  /** Drops every entry. */
  clear(): void {
    this.#store.clear();
  }
}
