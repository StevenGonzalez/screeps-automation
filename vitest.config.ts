import { defineConfig } from "vitest/config";

// Unit tests cover the pure, framework-free helpers (no Screeps runtime globals). Source
// modules under test import nothing and only reference Screeps constants as TypeScript
// types, which esbuild strips — so they load fine under Node without a game shim.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Defines the few Screeps constants the source modules read at import time.
    setupFiles: ["test/setup.ts"],
  },
});
