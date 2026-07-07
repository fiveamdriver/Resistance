import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // DB-backed integration tests run separately (vitest.db.config.ts) so
    // this suite stays pure and instant.
    exclude: ["**/node_modules/**", "**/*.db.test.ts"],
  },
  resolve: {
    // Mirror the "@/*" alias from tsconfig so tests import the same way as app code.
    // "server-only" is a Next.js guard that throws in browser contexts; stub it
    // in the Node test environment so server-side modules can be unit-tested.
    alias: {
      "@": resolve(__dirname, "src"),
      "server-only": resolve(__dirname, "src/__mocks__/server-only.ts"),
    },
  },
});
