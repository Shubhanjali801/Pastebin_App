import Redis from "ioredis";
import { config } from "./config";

// Redis serves three jobs on the read-heavy path (~10:1), all OPTIONAL: if
// REDIS_URL is unset or Redis is unreachable, every method degrades to a no-op
// and the app just hits Postgres / the blob store directly.
//
//   1. hot METADATA cache        (avoid a DB round-trip per read)
//   2. small hot BLOB cache      (avoid a blob-store round-trip for tiny pastes)
//   3. view-count counters       (avoid a DB write on every single read)
//
// (3) is the "don't write to the DB on the hot path" trick from 03_LLD/02_schema.md:
// INCR a Redis counter per read, remember the key is dirty, and a background worker
// batch-flushes the deltas into Postgres.

let client: Redis | null = null;
let healthy = false;

if (config.redisUrl) {
  client = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on("ready", () => {
    healthy = true;
  });
  client.on("error", () => {
    healthy = false;
  });
  client.connect().catch(() => {
    healthy = false;
  });
}

const metaKey = (key: string) => `paste:meta:${key}`;
const blobKey = (key: string) => `paste:blob:${key}`;
const viewKey = (key: string) => `paste:views:${key}`;
const DIRTY_SET = "paste:views:dirty";

// Serialized metadata shape kept in the cache (dates as ISO strings).
export interface CachedMeta {
  key: string;
  blobUrl: string;
  sizeBytes: number;
  language: string | null;
  visibility: string;
  ownerId: string | null;
  createdAt: string;
  expiresAt: string | null;
  burnAfterRead: boolean;
  viewCount: number;
}

export const cache = {
  enabled(): boolean {
    return healthy && client !== null;
  },

  // --- metadata ---
  async getMeta(key: string): Promise<CachedMeta | null> {
    if (!this.enabled()) return null;
    try {
      const raw = await client!.get(metaKey(key));
      return raw ? (JSON.parse(raw) as CachedMeta) : null;
    } catch {
      return null;
    }
  },

  async setMeta(key: string, meta: CachedMeta, ttlSeconds: number): Promise<void> {
    if (!this.enabled() || ttlSeconds <= 0) return;
    try {
      await client!.set(metaKey(key), JSON.stringify(meta), "EX", ttlSeconds);
    } catch {
      /* best-effort */
    }
  },

  // --- small blobs (only cache tiny pastes; big blobs belong in S3/CDN) ---
  async getBlob(key: string): Promise<Buffer | null> {
    if (!this.enabled()) return null;
    try {
      return await client!.getBuffer(blobKey(key));
    } catch {
      return null;
    }
  },

  async setBlob(key: string, data: Buffer, ttlSeconds: number): Promise<void> {
    if (!this.enabled() || ttlSeconds <= 0) return;
    if (data.length > config.cacheableBlobBytes) return; // keep big blobs out of Redis
    try {
      await client!.set(blobKey(key), data, "EX", ttlSeconds);
    } catch {
      /* best-effort */
    }
  },

  // --- view counters ---
  // Returns the number of buffered views for this key (delta not yet flushed to DB),
  // or 0 when Redis is unavailable.
  async incrView(key: string): Promise<number> {
    if (!this.enabled()) return 0;
    try {
      const n = await client!.incr(viewKey(key));
      await client!.sadd(DIRTY_SET, key);
      return n;
    } catch {
      return 0;
    }
  },

  // Atomically read-and-reset every dirty counter. The worker adds these deltas
  // to Postgres. Returns [] when Redis is unavailable.
  async drainViewDeltas(): Promise<Array<{ key: string; delta: number }>> {
    if (!this.enabled()) return [];
    try {
      const keys = await client!.smembers(DIRTY_SET);
      const out: Array<{ key: string; delta: number }> = [];
      for (const key of keys) {
        // GETDEL is atomic: read the counter and clear it in one step.
        const raw = await client!.getdel(viewKey(key));
        await client!.srem(DIRTY_SET, key);
        const delta = raw ? Number(raw) : 0;
        if (delta > 0) out.push({ key, delta });
      }
      return out;
    } catch {
      return [];
    }
  },

  // --- invalidation (expiry / burn / delete) ---
  async invalidate(key: string): Promise<void> {
    if (!this.enabled()) return;
    try {
      await client!.del(metaKey(key), blobKey(key), viewKey(key));
      await client!.srem(DIRTY_SET, key);
    } catch {
      /* best-effort */
    }
  },

  // Escape hatch for the rate limiter (shared INCR/EXPIRE across app servers).
  raw(): Redis | null {
    return this.enabled() ? client : null;
  },

  async close(): Promise<void> {
    if (client) await client.quit().catch(() => {});
  },
};
