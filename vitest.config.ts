import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres; run files sequentially to avoid races.
    fileParallelism: false,
    testTimeout: 15000,
    // Prisma's first connect can be slow on a cold start; give hooks headroom.
    hookTimeout: 30000,
  },
});
