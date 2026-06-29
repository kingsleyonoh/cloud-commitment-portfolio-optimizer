import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "apps/web/public",
  build: {
    outDir: "dist/apps/web/assets",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        app: "apps/web/assets/app.ts",
      },
    },
  },
});
