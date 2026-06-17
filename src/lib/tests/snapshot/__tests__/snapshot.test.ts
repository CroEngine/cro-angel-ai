// Snapshot regression tests: for each frozen corpus/<name>/, replay through
// the collector + pageAudit, normalize, and diff against golden.json.
//
// First-time use per corpus:
//   1. `bun run freeze --url=... --name=<name>`
//   2. `bun run snapshot:update` (writes golden.json from a fresh replay)
//   3. Commit corpus/<name>/{page.mhtml,screenshot.jpg,meta.json,golden.json}
//
// Day-to-day:
//   `bun run snapshot` runs the diff. Non-empty diff = a regression OR an
//   intentional change. If intentional, re-run snapshot:update and commit.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

import { replayCorpus } from "../harness.server";
import { normalizeCollect, normalizePageAudit, diffNormalized } from "../normalize";

const CORPUS_ROOT = "corpus";
const UPDATE = process.env.SNAPSHOT_UPDATE === "1";

function listCorpus(): string[] {
  if (!existsSync(CORPUS_ROOT)) return [];
  return readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CORPUS_ROOT, d.name, "page.mhtml")))
    .map((d) => d.name);
}

const sites = listCorpus();

// Same pattern as render-canary.test.ts: probe chromium, skip suite if the
// sandbox lacks sysdeps. CI installs --with-deps so probe succeeds and every
// corpus site runs normally.
let chromiumAvailable = false;
let probeBrowser: Browser | undefined;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    probeBrowser = await chromium.launch({ headless: true, executablePath });
    await probeBrowser.close();
    probeBrowser = undefined;
    chromiumAvailable = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[snapshot.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  if (probeBrowser) {
    try {
      await probeBrowser.close();
    } catch {
      /* best-effort */
    }
  }
});

describe.skipIf(sites.length === 0)("snapshot diff", () => {
  for (const name of sites) {
    // C2: hibob deferred — consent-blockerare + stale fontlös MHTML.
    // Separat utredning (geo-pinning först). Branchen verifierar hubspot ensam.
    const run = name === "hibob" ? it.skip : it;
    run(
      name,
      async (ctx) => {
        if (!chromiumAvailable) return ctx.skip();
        const fresh = await replayCorpus(name, CORPUS_ROOT);

        // Skip-link suspect-räknare: observation, ej gate. När korpus
        // expanderar ser vi per-sajt-läckage direkt i CI-loggen.
        const suspects = (fresh.collect.elements ?? []).filter(
          (e) => e.suspectOffFlow,
        );
        // eslint-disable-next-line no-console
        console.log(`[snapshot] ${name}: ${suspects.length} off-flow suspects`);
        if (suspects.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[snapshot] ${name} suspect selectors:`,
            suspects.slice(0, 5).map((e) => e.selector),
          );
        }

        const normalized = {
          collect: normalizeCollect(fresh.collect),
          pageAudit: normalizePageAudit(fresh.pageAudit),
        };

        const goldenPath = join(CORPUS_ROOT, name, "golden.json");

        if (UPDATE || !existsSync(goldenPath)) {
          writeFileSync(goldenPath, JSON.stringify(normalized, null, 2));
          return;
        }

        const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
        const diff = diffNormalized(golden, normalized);

        if (diff.length > 0) {
          writeFileSync(
            join(CORPUS_ROOT, name, "actual.json"),
            JSON.stringify(normalized, null, 2),
          );
        }

        expect(diff, diff.slice(0, 50).join("\n")).toEqual([]);
      },
      120_000,
    );
  }
});

if (sites.length === 0) {
  // eslint-disable-next-line no-console
  console.warn(
    "snapshot.test.ts: no frozen corpus sites found — run `bun run freeze` first.",
  );
}
