// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    resolve: {
      alias: {
        // pkce-challenge@5.0.1 ships an `exports` map with only types/browser/node
        // conditions — no `default`. workerd matches none of them, so SSR build
        // fails with "No known conditions for '.'". Force the Node ESM entry.
        // TEMPORARY: see .lovable/plan.md Phase 2 — sever the Stagehand chain
        // from the Worker bundle and delete this alias.
        "pkce-challenge": fileURLToPath(
          new URL(
            "./node_modules/pkce-challenge/dist/index.node.js",
            import.meta.url,
          ),
        ),
      },
    },
  },
});
