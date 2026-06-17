// Serverar whitelisted JSON-artefakter från build-time bundle.
// Binärer (page.mhtml, screenshot.jpg) ligger under public/corpus/<name>/
// och serveras direkt som static assets — den här routen 302-redirectar dit
// för bakåtkompabilitet med ev. externa länkar.

import { createFileRoute } from "@tanstack/react-router";

import {
  getFreezeReport,
  getMeta,
  loadFamilies,
  loadGolden,
} from "@/lib/corpus-bundle";

const ALLOWED_FILES = new Set([
  "golden.json",
  "meta.json",
  "freeze-report.json",
  "render-canary.families.json",
  "page.mhtml",
  "screenshot.jpg",
]);

const BINARY_FILES = new Set(["page.mhtml", "screenshot.jpg"]);

const NAME_RX = /^[a-z0-9_-]+$/;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
  "Access-Control-Max-Age": "86400",
};

const notFound = () => new Response("Not found", { status: 404, headers: CORS_HEADERS });

async function loadJsonArtifact(name: string, file: string): Promise<unknown | null> {
  switch (file) {
    case "meta.json":
      return getMeta(name);
    case "freeze-report.json":
      return getFreezeReport(name);
    case "golden.json":
      return await loadGolden(name);
    case "render-canary.families.json":
      return await loadFamilies(name);
    default:
      return null;
  }
}

export const Route = createFileRoute("/api/public/corpus/$")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      GET: async ({ params, request }) => {
        const splat = params._splat ?? "";
        const parts = splat.split("/").filter(Boolean);
        if (parts.length !== 2) return notFound();

        const [name, file] = parts;
        if (!NAME_RX.test(name) || !ALLOWED_FILES.has(file)) return notFound();

        const url = new URL(request.url);
        const asDownload = url.searchParams.get("download") === "1";

        // Binärer: 302 till same-origin static asset under /corpus/.
        if (BINARY_FILES.has(file)) {
          const target = `/corpus/${name}/${file}`;
          return new Response(null, {
            status: 302,
            headers: { Location: target, ...CORS_HEADERS },
          });
        }

        const data = await loadJsonArtifact(name, file);
        if (data == null) return notFound();

        const body = JSON.stringify(data);
        const headers: Record<string, string> = {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...CORS_HEADERS,
        };
        if (asDownload) {
          headers["Content-Disposition"] = `attachment; filename="${name}-${file}"`;
        }

        return new Response(body, { status: 200, headers });
      },
    },
  },
});
