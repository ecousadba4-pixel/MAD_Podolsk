import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "frontend",
  resolve: {
    alias: {
      "@": resolve(__dirname, "frontend/src"),
      "@js": resolve(__dirname, "frontend/src/js"),
      "@styles": resolve(__dirname, "frontend/src/styles"),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "frontend/index.html"),
    },
  },
  publicDir: resolve(__dirname, "frontend/public"),
});
