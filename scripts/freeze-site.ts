#!/usr/bin/env bun
// CLI wrapper for snapshot/freeze.server.ts
//
// Usage:
//   bun run scripts/freeze-site.ts --url=https://hibob.com --name=hibob
//   bun run scripts/freeze-site.ts --url=... --name=... --consent='#onetrust-accept-btn-handler'
//   bun run scripts/freeze-site.ts --url=... --name=... --consent-act='click Accept all cookies'

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const url = arg("url");
const name = arg("name");
const consentSelector = arg("consent");
const consentInstruction = arg("consent-act");
const notes = arg("notes");

if (!url || !name) {
  console.error(
    "Usage: bun run scripts/freeze-site.ts --url=<url> --name=<name> [--consent='<css>'] [--consent-act='<instruction>'] [--notes='...']",
  );
  process.exit(1);
}

console.log(`Freezing ${url} -> corpus/${name}/ ...`);
freezeSite({ url, name, consentSelector, consentInstruction, notes })
  .then((r) => {
    console.log(
      `OK · ${r.dir} · mhtml ${Math.round(r.mhtmlBytes / 1024)}kb · screenshot ${Math.round(r.screenshotBytes / 1024)}kb`,
    );
  })
  .catch((e) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
