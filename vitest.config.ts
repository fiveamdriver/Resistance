import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Mirror the "@/*" alias from tsconfig so tests import the same way as app code.
    alias: { "@": resolve(__dirname, "src") },
  },
});
