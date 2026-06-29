import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@core": new URL("./core", import.meta.url).pathname,
      "@apps": new URL("./apps", import.meta.url).pathname,
    },
  },
});
