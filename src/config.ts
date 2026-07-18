// Centralized, validated configuration. Reads from environment (see .env.example).

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

export const config = {
  port: num("PORT", 3000),
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  redisUrl: process.env.REDIS_URL, // optional — caching is skipped if unset/unreachable

  // Key generation (same Base62 idea as the URL shortener).
  keyLength: num("KEY_LENGTH", 7),

  // NFR: cap paste size to bound bandwidth/abuse. Over this -> 413 Payload Too Large.
  maxPasteBytes: num("MAX_PASTE_BYTES", 10 * 1024 * 1024), // 10 MB

  // Blob backend selection. "local" = gzip files on disk (dev/self-host);
  // "s3" = an S3 bucket (production). PasteService is unaware either way.
  blobBackend: (process.env.BLOB_BACKEND ?? "local").toLowerCase(),

  // Where the LocalFileBlobStore writes gzip-compressed blobs (blobBackend=local).
  blobDir: process.env.BLOB_DIR ?? "./data/blobs",

  // S3 blob store (blobBackend=s3). Region falls back to the SDK's AWS_REGION.
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? process.env.AWS_REGION ?? "us-east-1",
  s3Prefix: process.env.S3_PREFIX ?? "pastes",

  // Cache TTL for hot metadata (and small hot blobs), in seconds.
  cacheTtlSeconds: num("CACHE_TTL_SECONDS", 3600),
  // Only cache blob bytes for pastes at or below this size (keep big blobs out of Redis).
  cacheableBlobBytes: num("CACHEABLE_BLOB_BYTES", 64 * 1024), // 64 KB

  // Rate limiting for the create endpoint (fixed window).
  rateLimitMax: num("RATE_LIMIT_MAX", 20),
  rateLimitWindowSeconds: num("RATE_LIMIT_WINDOW_SECONDS", 60),

  // How often the background worker flushes Redis view counters into Postgres.
  viewFlushIntervalSeconds: num("VIEW_FLUSH_INTERVAL_SECONDS", 30),

  // How often the expiration worker sweeps out expired pastes (metadata + blobs).
  cleanupIntervalSeconds: num("CLEANUP_INTERVAL_SECONDS", 300),
} as const;
