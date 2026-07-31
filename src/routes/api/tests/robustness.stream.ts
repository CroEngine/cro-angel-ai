import { createFileRoute } from "@tanstack/react-router";

import { sseStream, withBrowserPage } from "@/lib/tests/sse.server";

// Intern testyta — AVSTÄNGD i drift utan uttrycklig aktivering
// (granskningsfynd 2026-07-28): routen var helt oautentiserad och lät vem
// som helst starta browsersessioner mot godtyckliga URL:er (SSRF +
// kostnads-DoS). ANGEL_INTERNAL_TESTS=1 sätts bara i utvecklingsmiljön;
// riktig sessionsbunden auktorisering är dokumenterad kvarvarande skuld.
const internalTestsEnabled = () => process.env.ANGEL_INTERNAL_TESTS === "1";

import {
  isPersona,
  DEFAULT_PERSONA,
  ALL_PERSONAS,
  type PersonaId,
} from "@/lib/tests/robustness/personas";

// Self-contained robustness sweep, streamed like the crawl so the serverless
// host keeps the function alive while the browser work runs.
//
// For each url it loads the page in Browserbase, computes a real Decision per
// persona, applies the REAL production snippet via its guarded test seam, and
// reports whether targeting hit real elements, the page stayed intact, and
// every change reversed. Nothing is persisted. A final `summary` event carries
// the summarize() aggregate — the launch-gate view (pass/warn/fail, avg
// targeting, irreversible count).
//
//   GET /api/tests/robustness/stream
//        ?url=<page>            single page, or
//        ?urls=<a,b,c>          batch (each its own session; capped)
//        &persona=<id|all>      one persona (default) or the full matrix
//        &site=<slug>&shots=1
export const Route = createFileRoute("/api/tests/robustness/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!internalTestsEnabled()) return new Response("disabled", { status: 403 });
        const reqUrl = new URL(request.url);
        const single = reqUrl.searchParams.get("url");
        const many = reqUrl.searchParams.get("urls");
        const personaParam = reqUrl.searchParams.get("persona") || DEFAULT_PERSONA;
        const site = reqUrl.searchParams.get("site") || "robustness";
        const captureShots = reqUrl.searchParams.get("shots") === "1";

        const urls = (many ? many.split(",") : single ? [single] : [])
          .map((u) => u.trim())
          .filter(Boolean)
          .slice(0, 25); // cap one request; larger sweeps parallelize client-side
        if (urls.length === 0) return new Response("missing url or urls", { status: 400 });

        const personas: PersonaId[] =
          personaParam === "all"
            ? ALL_PERSONAS
            : [isPersona(personaParam) ? personaParam : DEFAULT_PERSONA];

        const origin = reqUrl.origin;

        return sseStream(async ({ emit }) => {
          emit("started", { urls, personas, site });
          const [runnerMod, analyzeMod] = await Promise.all([
            import("@/lib/tests/robustness/runner.server"),
            import("@/lib/tests/robustness/analyze"),
          ]);

          emit("log", { message: "loading snippet source" });
          const snippetRes = await fetch(`${origin}/adaptive.js`);
          if (!snippetRes.ok) throw new Error(`adaptive.js fetch ${snippetRes.status}`);
          const snippetSource = await snippetRes.text();

          // Stored owner-confirmed goal for registered sites, so the sweep
          // exercises the goal-decoration patterns (sticky pill, secondary
          // link) exactly as production would. Unregistered slugs fall back to
          // the runner's deterministic rankGoalCandidates() floor.
          let goal: { selector?: string | null; text?: string | null } | null = null;
          try {
            const { loadSiteConfig } = await import("@/adaptive/persistence.server");
            const cfg = await loadSiteConfig(site);
            if (cfg.conversionSelector || cfg.conversionText) {
              goal = { selector: cfg.conversionSelector, text: cfg.conversionText };
            }
          } catch {
            /* best-effort — runner derives its own floor */
          }
          if (goal) emit("log", { message: `using stored conversion goal for '${site}'` });

          const allReports: import("@/lib/tests/robustness/analyze").RobustnessReport[] = [];

          for (const targetUrl of urls) {
            try {
              await withBrowserPage({ pipeline: "robustness", site }, async (page) => {
                emit("log", { message: `[${targetUrl}] navigating` });
                await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeoutMs: 45000 });

                emit("log", {
                  message: `[${targetUrl}] auditing + applying (${personas.length} persona(s))`,
                });
                const reports = await runnerMod.runSnippetRobustness(page, {
                  url: targetUrl,
                  site,
                  personas,
                  snippetSource,
                  goal,
                  captureShots,
                  onShot: captureShots
                    ? (shot) =>
                        emit("shot", {
                          url: targetUrl,
                          persona: shot.persona,
                          phase: shot.phase,
                          jpeg: shot.jpegBase64,
                        })
                    : undefined,
                });
                for (const report of reports) {
                  allReports.push(report);
                  emit("report", { report });
                }
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              emit("site_error", { url: targetUrl, message });
              for (const persona of personas) {
                allReports.push(analyzeMod.failReport(targetUrl, site, persona, message));
              }
            }
          }

          emit("summary", { summary: analyzeMod.summarize(allReports) });
          emit("done", {});
        });
      },
    },
  },
});
