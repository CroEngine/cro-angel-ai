// Serves whitelisted artefact files from ./corpus/<name>/<file>.
// Read-only. Strict name + filename validation. No directory traversal.

import { createFileRoute } from "@tanstack/react-router";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_FILES = new Set([
  "golden.json",
  "meta.json",
  "freeze-report.json",
  "page.mhtml",
  "screenshot.jpg",
]);

const NAME_RX = /^[a-z0-9_-]+$/;

const CONTENT_TYPES: Record<string, string> = {
  "golden.json": "application/json; charset=utf-8",
  "meta.json": "application/json; charset=utf-8",
  "freeze-report.json": "application/json; charset=utf-8",
  "page.mhtml": "multipart/related",
  "screenshot.jpg": "image/jpeg",
};

export const Route = createFileRoute("/api/public/corpus/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const splat = params._splat ?? "";
        const parts = splat.split("/").filter(Boolean);
        if (parts.length !== 2) {
          return new Response("Not found", { status: 404 });
        }
        const [name, file] = parts;
        if (!NAME_RX.test(name) || !ALLOWED_FILES.has(file)) {
          return new Response("Not found", { status: 404 });
        }

        const path = join("corpus", name, file);
        if (!existsSync(path)) {
          return new Response("Not found", { status: 404 });
        }

        const buf = readFileSync(path);
        const url = new URL(request.url);
        const asDownload = url.searchParams.get("download") === "1";

        const headers: Record<string, string> = {
          "Content-Type": CONTENT_TYPES[file] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        };
        if (asDownload) {
          headers["Content-Disposition"] = `attachment; filename="${name}-${file}"`;
        }

        return new Response(new Uint8Array(buf), { status: 200, headers });
      },
    },
  },
});
