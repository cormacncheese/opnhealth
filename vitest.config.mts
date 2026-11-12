import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    // The database tests share one ledger; run files one at a time.
    fileParallelism: false,
  },
});
