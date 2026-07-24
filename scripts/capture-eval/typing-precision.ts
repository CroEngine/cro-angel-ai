#!/usr/bin/env bun
// Dumpar varje sektion typad som testimonials/pricing/faq (typerna med lösa
// rubrik-regexar) över hela korpusen → capture-eval/typing-<tag>.json. Kör före
// och efter regex-åtstramningen och diffa: vilka sektioner om-klassas (= de
// falska positiva) och inga ÄKTA bevis-sektioner tappas.  --tag=before|after
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { serializeVisibleHtml } from "../redesign/visible-dom";
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const tag = process.argv.find((a) => a.startsWith("--tag="))?.split("=")[1] ?? "run";
const WATCH = new Set(["testimonials", "pricing", "faq"]);
const rows: { site: string; type: string; heading: string }[] = [];
const b = await chromium.launch({ headless: true, executablePath: EXEC });
for (const root of ["fleet-e2e", "capture-corpus"]) {
  const names = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "frozen.html")))
    .map((d) => d.name);
  for (const name of names) {
    try {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
      const p = await ctx.newPage();
      await p.setContent(readFileSync(join(root, name, "frozen.html"), "utf8"), { waitUntil: "domcontentloaded", timeout: 12000 });
      await p.waitForTimeout(250);
      const m = extractContentModel(await serializeVisibleHtml(p));
      await ctx.close();
      for (const s of m.sections) if (WATCH.has(s.type)) rows.push({ site: name, type: s.type, heading: s.heading.slice(0, 60) });
    } catch { /* skip */ }
  }
}
await b.close();
writeFileSync(join("capture-eval", `typing-${tag}.json`), JSON.stringify(rows, null, 1));
const by = (t: string) => rows.filter((r) => r.type === t).length;
console.log(`[typing-${tag}] ${rows.length} evidence sections — testimonials ${by("testimonials")} pricing ${by("pricing")} faq ${by("faq")}`);
