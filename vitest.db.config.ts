import { resolve } from "path";

import { defineConfig } from "vitest/config";

/**
 * DB-backed integration tests (src/** /*.db.test.ts).
 *
 * Kept out of the main vitest.config.ts run so the pure unit suite stays
 * instant. Each test file gets its own throwaway SQLite database, provisioned
 * by src/test/db-setup.ts before the app's Prisma client is first imported.
 * Run with: npm run test:db (npm test runs both suites).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    setupFiles: ["src/test/db-setup.ts"],
    // db push takes a couple of seconds per file; leave headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "server-only": resolve(__dirname, "src/__mocks__/server-only.ts"),
    },
  },
});
