import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" assert { type: "json" };

export default defineConfig({
  plugins: [
    react(),
    // @ts-expect-error — crxjs type narrowing differs across versions
    crx({ manifest }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: "src/popup/popup.html",
      },
    },
    sourcemap: true,
    minify: "esbuild",
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
});
