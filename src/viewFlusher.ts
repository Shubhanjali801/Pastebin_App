import { prisma } from "./db";
import { cache } from "./cache";
import { config } from "./config";

// Background worker: periodically drains the per-paste Redis view counters and adds
// the deltas to Postgres in one batch. This is the "denormalized counter" pattern
// from 03_LLD/02_schema.md — keep the read path free of DB writes, reconcile later.
//
// A no-op when Redis is disabled (there are no buffered counters to flush).
export function startViewFlusher(): NodeJS.Timeout {
  const intervalMs = config.viewFlushIntervalSeconds * 1000;

  const timer = setInterval(() => {
    void flushOnce();
  }, intervalMs);

  // Don't keep the process alive just for the flusher.
  timer.unref?.();
  return timer;
}

export async function flushOnce(): Promise<void> {
  const deltas = await cache.drainViewDeltas();
  for (const { key, delta } of deltas) {
    try {
      await prisma.paste.update({
        where: { key },
        data: { viewCount: { increment: delta } },
      });
    } catch {
      // Paste was deleted/expired between read and flush — the counter is moot.
    }
  }
}
