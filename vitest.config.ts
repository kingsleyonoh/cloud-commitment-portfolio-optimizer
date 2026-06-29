import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@core": new URL("./core", import.meta.url).pathname,
      "@apps": new URL("./apps", import.meta.url).pathname,
    },
  },
});
