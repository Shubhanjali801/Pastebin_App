import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { cache } from "./cache";
import { startViewFlusher } from "./viewFlusher";
import { startCleanupWorker } from "./cleanupWorker";

const app = createApp();

// Background workers: batch-flush Redis view counters into Postgres (no-op without
// Redis), and sweep out expired pastes (metadata + blobs).
const flusher = startViewFlusher();
const cleanup = startCleanupWorker();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Pastebin listening on ${config.baseUrl} (port ${config.port})`);
});

// Graceful shutdown — drain connections so we don't drop in-flight reads/writes.
async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received, shutting down...`);
  clearInterval(flusher);
  clearInterval(cleanup);
  server.close(async () => {
    await prisma.$disconnect();
    await cache.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
