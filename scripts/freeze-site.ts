#!/usr/bin/env bun
// CLI wrapper for snapshot/freeze.server.ts
//
// Preferred (SSOT-baserat — slår upp i corpus/sites.ts):
//   bun run scripts/freeze-site.ts --name=hibob
//   bun run scripts/freeze-site.ts --name=hubspot
//
// Debug-flaggor (för 6-site-utrullning):
//   --dry-run                      Skriv inget till corpus/. Receipt -> /tmp.
//   --screenshot-before-dismiss    Extra screenshot innan consent-klick.
//
// Override (one-off, kringgår SSOT):
//   --url=... --consent='<css>' --consent-check=detached|hidden --consent-act='...'
//
// Det vanliga flödet är att lägga till en site i corpus/sites.ts och köra
// bara --name=<name>. CLI-flaggor är override, inte enda källa.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";
import { getSite } from "../corpus/sites";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const name = arg("name");
if (!name) {
  console.error(
    "Usage: bun run scripts/freeze-site.ts --name=<name> " +
      "[--url=...] [--consent='<css>'] [--consent-check=detached|hidden] " +
      "[--consent-act='...'] [--notes='...'] [--dry-run] [--screenshot-before-dismiss]",
  );
  process.exit(1);
}

const spec = getSite(name);
const url = arg("url") ?? spec?.url;
const consentSelector = arg("consent") ?? spec?.consentSelector;
const consentCheckArg = arg("consent-check") as "detached" | "hidden" | undefined;
const consentDismissCheck = consentCheckArg ?? spec?.consentDismissCheck;
const consentInstruction = arg("consent-act") ?? spec?.consentInstruction;
const consentFrame = arg("consent-frame") ?? spec?.consentFrame;
const notes = arg("notes") ?? spec?.notes ?? undefined;
const removeSelectors = spec?.removeSelectors;
const dryRun = flag("dry-run");
const screenshotBeforeDismiss = flag("screenshot-before-dismiss");

if (!url) {
  console.error(
    `[freeze] ingen url för name="${name}". Lägg till i corpus/sites.ts eller skicka --url=.`,
  );
  process.exit(1);
}

if (!spec && !consentSelector && !consentInstruction) {
  console.error(
    `[freeze] name="${name}" saknas i corpus/sites.ts och ingen --consent angavs. ` +
      `Vi vägrar freeza utan att ha tagit ställning till consent. ` +
      `Lägg till en SiteSpec i corpus/sites.ts eller skicka --consent='<css>'.`,
  );
  process.exit(1);
}

const mode = dryRun ? "DRY-RUN" : "WRITE";
console.log(
  `[freeze ${mode}] ${url} -> corpus/${name}/ ` +
    `consent=${consentSelector ?? "(act)"} check=${consentDismissCheck ?? "detached"}` +
    (screenshotBeforeDismiss ? " +before-screenshot" : ""),
);

freezeSite({
  url,
  name,
  consentSelector,
  consentDismissCheck,
  consentInstruction,
  consentFrame,
  notes,
  removeSelectors,
  dryRun,
  screenshotBeforeDismiss,
})
  .then((r) => {
    // Spegla binärerna till public/corpus/<name>/ så Cloudflare Worker-builden
    // kan serva dem same-origin. JSON läses via Vite-bundle vid build.
    if (!dryRun) {
      const publicDir = join("public", "corpus", name);
      mkdirSync(publicDir, { recursive: true });
      for (const f of ["page.mhtml", "screenshot.jpg"]) {
        const src = join(r.dir, f);
        if (existsSync(src)) copyFileSync(src, join(publicDir, f));
      }
      console.log(`[freeze] mirrored binaries -> ${publicDir}/`);
    }
    console.log(
      `OK · ${r.dir} · mhtml ${Math.round(r.mhtmlBytes / 1024)}kb · ` +
        `screenshot ${Math.round(r.screenshotBytes / 1024)}kb · report ${r.reportPath}`,
    );
  })
  .catch((e) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    console.error("Se freeze-report.json för fältmätningarna vid felögonblicket.");
    process.exit(1);
  });
