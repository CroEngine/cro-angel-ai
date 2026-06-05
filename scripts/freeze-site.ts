#!/usr/bin/env bun
// CLI wrapper for snapshot/freeze.server.ts
//
// Preferred (SSOT-baserat — slår upp i corpus/sites.ts):
//   bun run scripts/freeze-site.ts --name=hibob
//   bun run scripts/freeze-site.ts --name=hubspot
//
// Override (one-off, kringgår SSOT — använd sparsamt, t.ex. för smoketests):
//   bun run scripts/freeze-site.ts --name=foo --url=https://foo.com \
//        --consent='#accept' --consent-check=detached
//
// CLI-flaggor är override, inte enda källa. Det vanliga flödet är att lägga
// till en site i corpus/sites.ts och köra bara --name=<name>.

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";
import { getSite } from "../corpus/sites";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const name = arg("name");
if (!name) {
  console.error(
    "Usage: bun run scripts/freeze-site.ts --name=<name> [--url=...] [--consent='<css>'] [--consent-check=detached|hidden] [--consent-act='...'] [--notes='...']",
  );
  process.exit(1);
}

const spec = getSite(name);
const url = arg("url") ?? spec?.url;
const consentSelector = arg("consent") ?? spec?.consentSelector;
const consentCheckArg = arg("consent-check") as "detached" | "hidden" | undefined;
const consentDismissCheck = consentCheckArg ?? spec?.consentDismissCheck;
const consentInstruction = arg("consent-act") ?? spec?.consentInstruction;
const notes = arg("notes") ?? spec?.notes ?? undefined;

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

console.log(`Freezing ${url} -> corpus/${name}/ (consent=${consentSelector ?? "(act)"} check=${consentDismissCheck ?? "detached"})`);
freezeSite({ url, name, consentSelector, consentDismissCheck, consentInstruction, notes })
  .then((r) => {
    console.log(
      `OK · ${r.dir} · mhtml ${Math.round(r.mhtmlBytes / 1024)}kb · screenshot ${Math.round(r.screenshotBytes / 1024)}kb`,
    );
  })
  .catch((e) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
