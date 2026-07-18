import { pasteService } from "./pasteService";
import { config } from "./config";

// Background worker: the "Expiration Worker" from 02_HLD/01_architecture.md. It
// periodically deletes expired pastes (metadata + blob) so dead content doesn't
// accumulate. Lazy purge-on-read handles anything a user happens to hit first;
// this sweep catches the rest. In production an S3 lifecycle rule backs it up.
export function startCleanupWorker(): NodeJS.Timeout {
  const intervalMs = config.cleanupIntervalSeconds * 1000;

  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);

  timer.unref?.();
  return timer;
}

async function sweep(): Promise<void> {
  try {
    const n = await pasteService.purgeExpired();
    if (n > 0) {
      // eslint-disable-next-line no-console
      console.log(`[cleanup] purged ${n} expired paste(s)`);
    }
  } catch {
    // Transient DB/blob hiccup — the next tick retries.
  }
}
