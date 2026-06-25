import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// Standalone build for the Angel Adaptive visitor snippet. Kept SEPARATE from the
// app build (which bundles React/TanStack) so the snippet stays tiny and
// dependency-free. The snippet imports ONLY types from src/snippet/contract.ts,
// so zod never enters the bundle. Output: public/cdn/v1/script.js (minified IIFE).
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The snippet has no public dir of its own, and its outDir lives INSIDE the
  // app's public/ — disable the copy so Vite doesn't recurse public/ into itself.
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2018",
    outDir: "public/cdn/v1",
    emptyOutDir: false,
    minify: "esbuild",
    lib: {
      entry: resolve(here, "src/snippet/index.ts"),
      formats: ["iife"],
      name: "AngelAdaptive",
      fileName: () => "script.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
