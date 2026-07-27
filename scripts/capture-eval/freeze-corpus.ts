#!/usr/bin/env bun
// Fryser en BRED, mångsidig sajtkorpus (bortom flottans SaaS-landningssidor —
// e-handel, media, dev, fintech, konsument) för capture-eval:s skala-test
// (kapacitet steg 1). Statisk frysning (curl-vägen fungerar lokalt); sajter som
// bot-blockar/timear hoppas (freeze_failed). Återupptagbart: redan frysta hoppas.
//
//   bun run scripts/capture-eval/freeze-corpus.ts [--conc=6]

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const CONC = Math.max(1, Number(arg("conc") ?? 6));
const OUT = "capture-corpus";
mkdirSync(OUT, { recursive: true });

// ~160 riktiga, upplösbara domäner tvärs sidtyper. Overlap med flottan är ok —
// separat korpus. Vikten ligger på ICKE-SaaS (e-handel/media/konsument) där
// capture-robusthet aldrig testats.
import { CORPUS_DOMAINS as DOMAINS } from "./corpus-domains";

const names = [...new Set(DOMAINS)].map((d) => ({ name: d.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/gi, "-"), url: `https://${d}/` }));
console.log(`[freeze-corpus] ${names.length} domäner`);

let idx = 0;
let ok = 0;
let fail = 0;
async function worker(): Promise<void> {
  while (idx < names.length) {
    const site = names[idx++];
    const out = join(OUT, site.name, "frozen.html");
    if (existsSync(out)) {
      ok++;
      continue;
    }
    mkdirSync(join(OUT, site.name), { recursive: true });
    const proc = Bun.spawn(
      ["bun", "run", "scripts/redesign/freeze-page.ts", `--url=${site.url}`, `--out=${out}`],
      { stdout: "ignore", stderr: "ignore" },
    );
    const timer = setTimeout(() => proc.kill(), 60_000);
    const code = await proc.exited;
    clearTimeout(timer);
    if (code === 0 && existsSync(out)) {
      ok++;
    } else {
      fail++;
    }
    if ((ok + fail) % 20 === 0) console.log(`  … ${ok} frozen, ${fail} failed`);
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));
console.log(`[freeze-corpus] klart: ${ok} frozen, ${fail} failed`);
