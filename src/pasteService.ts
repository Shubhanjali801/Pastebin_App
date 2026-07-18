import { Prisma, type Paste } from "@prisma/client";
import { prisma } from "./db";
import { blobStore, type BlobStore } from "./blobstore";
import { cache, type CachedMeta } from "./cache";
import { config } from "./config";
import { generateKey } from "./keygen";
import { resolveExpiry, type ExpiryOption } from "./expiry";
import { AliasTaken, Forbidden, Gone, NotFound } from "./errors";

const UNIQUE_VIOLATION = "P2002"; // Postgres/Prisma unique-constraint code
const MAX_KEY_ATTEMPTS = 5;

export interface CreateOptions {
  content: Buffer; // raw UTF-8 bytes (size already checked by the route -> 413)
  language?: string;
  expiry: ExpiryOption;
  visibility: string;
  ownerId?: string | null;
  customAlias?: string;
}

export interface ReadResult {
  meta: Paste;
  content: string;
}

// ---------------------------------------------------------------------------
// PasteService — orchestrates the two stores. This is where the metadata/blob
// split lives in code: CONTENT goes to the BlobStore, METADATA goes to Postgres.
// It depends on the BlobStore *interface*, so local-disk vs S3 is a wiring choice.
// ---------------------------------------------------------------------------
export class PasteService {
  constructor(
    private readonly blobs: BlobStore = blobStore,
    private readonly db = prisma,
  ) {}

  // -- CREATE (write path) --------------------------------------------------
  // Order matters: blob FIRST, metadata SECOND. A failed metadata write leaves an
  // orphan blob (cleaned up later) — far safer than metadata pointing at a missing blob.
  async create(opts: CreateOptions): Promise<Paste> {
    const { expiresAt, burnAfterRead } = resolveExpiry(opts.expiry);

    const baseData = {
      language: opts.language ?? null,
      visibility: opts.visibility,
      ownerId: opts.ownerId ?? null,
      sizeBytes: opts.content.length,
      expiresAt,
      burnAfterRead,
    };

    // F7 — custom alias: single insert; the PK constraint guarantees uniqueness.
    if (opts.customAlias) {
      const blobUrl = await this.blobs.put(opts.customAlias, opts.content);
      try {
        return await this.db.paste.create({
          data: { key: opts.customAlias, blobUrl, ...baseData },
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          await this.blobs.delete(opts.customAlias); // clean the orphan we just wrote
          throw AliasTaken();
        }
        throw e;
      }
    }

    // F1/F3 — random key with retry on the (rare) collision.
    for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
      const key = generateKey(config.keyLength);
      const blobUrl = await this.blobs.put(key, opts.content);
      try {
        return await this.db.paste.create({ data: { key, blobUrl, ...baseData } });
      } catch (e) {
        if (isUniqueViolation(e)) {
          await this.blobs.delete(key); // orphan from the losing attempt
          continue;
        }
        throw e;
      }
    }
    throw new Error("could not allocate a unique paste key, try again");
  }

  // -- READ (hot path) ------------------------------------------------------
  async read(key: string, requesterId: string | null = null): Promise<ReadResult> {
    const meta = await this.loadMeta(key);
    if (!meta) throw NotFound();

    // F5 — expired: purge lazily and report Gone.
    if (meta.expiresAt && meta.expiresAt.getTime() <= Date.now()) {
      await this.purge(key);
      throw Gone();
    }

    // F6 — private pastes are only readable by their owner (enforced server-side).
    if (meta.visibility === "private" && meta.ownerId !== requesterId) {
      throw Forbidden();
    }

    // Fetch content: small-blob cache first, then the blob store.
    let bytes = await cache.getBlob(key);
    if (!bytes) {
      bytes = await this.blobs.get(key);
      if (!bytes) {
        // Metadata points at a missing blob (orphaned) — treat as not found.
        await this.purge(key);
        throw NotFound();
      }
      await this.cacheBlobIfSmall(key, bytes, meta);
    }

    // View count: prefer INCR-ing a Redis counter (batched to the DB later by the
    // flush worker) so we don't write Postgres on every single read. Without Redis
    // we fall back to a direct DB increment — correct, just not hot-path-optimal.
    let views = meta.viewCount;
    if (cache.enabled()) {
      views += await cache.incrView(key);
    } else {
      await this.db.paste
        .update({ where: { key }, data: { viewCount: { increment: 1 } } })
        .catch(() => {});
      views += 1;
    }
    const withViews: Paste = { ...meta, viewCount: views };

    const content = bytes.toString("utf-8");

    // F5 — burn-after-read: consume the paste right after serving it once. We mark it
    // gone (expiry in the past) and drop the blob, so the NEXT read returns 410 Gone
    // ("already burned", per the API) rather than 404 — and that read fully purges it.
    if (meta.burnAfterRead) {
      await this.consumeBurn(key);
    }

    return { meta: withViews, content };
  }

  // -- DELETE (owner only) --------------------------------------------------
  async delete(key: string, requesterId: string | null): Promise<void> {
    const meta = await this.loadMeta(key);
    if (!meta) throw NotFound();
    if (meta.ownerId !== requesterId) throw Forbidden();
    await this.purge(key);
  }

  // -- list a user's pastes (F9) --------------------------------------------
  async listByOwner(ownerId: string): Promise<Paste[]> {
    return this.db.paste.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
    });
  }

  // -- expiration sweep (the "Expiration Worker" in 02_HLD/01_architecture.md) -----
  // Proactively delete a batch of expired pastes (metadata + blob) so storage doesn't
  // fill with dead content. Lazy purge-on-read still handles anything in between; in
  // production an S3 lifecycle rule is the belt-and-suspenders backstop. Returns count.
  async purgeExpired(batchSize = 500): Promise<number> {
    const expired = await this.db.paste.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { key: true },
      take: batchSize,
    });
    for (const { key } of expired) await this.purge(key);
    return expired.length;
  }

  // -- helpers --------------------------------------------------------------

  // Read-through metadata cache: Redis first, then Postgres (populate on miss).
  private async loadMeta(key: string): Promise<Paste | null> {
    const cached = await cache.getMeta(key);
    if (cached) return fromCached(cached);

    const row = await this.db.paste.findUnique({ where: { key } });
    if (!row) return null;

    // Don't cache past the paste's own expiry.
    let ttl = config.cacheTtlSeconds;
    if (row.expiresAt) {
      const secs = Math.floor((row.expiresAt.getTime() - Date.now()) / 1000);
      ttl = Math.min(ttl, secs);
    }
    // Burn-after-read pastes must never be cached (each read must hit the source of truth).
    if (!row.burnAfterRead) await cache.setMeta(key, toCached(row), ttl);
    return row;
  }

  private async cacheBlobIfSmall(key: string, bytes: Buffer, meta: Paste): Promise<void> {
    if (meta.burnAfterRead) return; // one-shot content is never cached
    let ttl = config.cacheTtlSeconds;
    if (meta.expiresAt) {
      const secs = Math.floor((meta.expiresAt.getTime() - Date.now()) / 1000);
      ttl = Math.min(ttl, secs);
    }
    await cache.setBlob(key, bytes, ttl);
  }

  // Burn-after-read consumption: drop the blob and backdate expiry so the paste is
  // Gone on the next read, without deleting the row yet (that read purges it fully).
  private async consumeBurn(key: string): Promise<void> {
    await Promise.allSettled([
      this.db.paste
        .update({ where: { key }, data: { expiresAt: new Date(Date.now() - 1000) } })
        .catch(() => {}),
      this.blobs.delete(key),
      cache.invalidate(key),
    ]);
  }

  // Remove a paste from every store: metadata, blob, and cache.
  private async purge(key: string): Promise<void> {
    await Promise.allSettled([
      this.db.paste.delete({ where: { key } }).catch(() => {}),
      this.blobs.delete(key),
      cache.invalidate(key),
    ]);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === UNIQUE_VIOLATION;
}

function toCached(p: Paste): CachedMeta {
  return {
    key: p.key,
    blobUrl: p.blobUrl,
    sizeBytes: p.sizeBytes,
    language: p.language,
    visibility: p.visibility,
    ownerId: p.ownerId,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    burnAfterRead: p.burnAfterRead,
    viewCount: p.viewCount,
  };
}

function fromCached(c: CachedMeta): Paste {
  return {
    key: c.key,
    blobUrl: c.blobUrl,
    sizeBytes: c.sizeBytes,
    language: c.language,
    visibility: c.visibility,
    ownerId: c.ownerId,
    createdAt: new Date(c.createdAt),
    expiresAt: c.expiresAt ? new Date(c.expiresAt) : null,
    burnAfterRead: c.burnAfterRead,
    viewCount: c.viewCount,
  };
}

export const pasteService = new PasteService();
