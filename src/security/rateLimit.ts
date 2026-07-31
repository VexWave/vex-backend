// Fixed-window rate limiter.
//
// Counters live in this process only, which is what keeps it dependency-free:
// it protects a single server instance, so running several behind a load
// balancer multiplies every limit by the instance count. Move the counters
// into Redis (or onto the reverse proxy) before scaling out.
export class RateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    // Ceiling on tracked keys. Without it, an attacker rotating the key
    // (spoofed usernames, a wide source-address range) would grow the map
    // without bound and turn the limiter itself into the memory leak.
    private readonly maxKeys = 100_000,
  ) {}

  /**
   * Counts one hit against `key`. Returns `null` when the caller is under the
   * limit, or the whole seconds left in the current window when it is over —
   * ready to go straight into a `Retry-After` header.
   */
  hit(key: string, now: number = Date.now()): number | null {
    const window = this.windows.get(key);

    if (window !== undefined && window.resetAt > now) {
      window.count += 1;
      return window.count > this.limit
        ? Math.max(1, Math.ceil((window.resetAt - now) / 1000))
        : null;
    }

    // Opening a window. Deleting first means the key is re-inserted at the
    // back, which keeps the map ordered by `resetAt` — every window is the
    // same length, so insertion order *is* expiry order. That ordering is
    // what lets `evictOldest` do its job without scanning.
    this.windows.delete(key);
    if (this.windows.size >= this.maxKeys) {
      this.evictOldest();
    }
    this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
    return null;
  }

  // Forgets a key's counter. Used after a successful login so a legitimate
  // user isn't held back by their own earlier typos.
  reset(key: string): void {
    this.windows.delete(key);
  }

  // Makes room by dropping windows from the front of the map. Because `hit`
  // keeps the map ordered by expiry, those are the ones that have already
  // elapsed — or, if none have, the ones closest to resetting anyway, which
  // are the cheapest counters to forgive.
  //
  // Deliberately not a sweep: this runs inline on a request, and the map holds
  // up to `maxKeys` entries. Scanning all of them would turn the wide
  // key-rotating attack the limit exists to absorb into a stall for every
  // connection in flight. Stopping as soon as there is room makes it O(1).
  private evictOldest(): void {
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) {
        return;
      }
      this.windows.delete(key);
    }
  }
}
