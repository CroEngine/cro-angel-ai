#!/usr/bin/env bun
// Audit-quality check — measures whether findings are *plausibly correct*, not
// just *deterministic*. The snapshot suite proves "same DOM → same golden"; it
// says nothing about whether the golden is right. This applies correctness
// heuristics to each committed golden.json and flags likely-wrong findings —
// the kind a CRO customer would see as broken (empty hero, a nav label as the
// hero, a hero that doesn't match the page's h1, a duplicated headline).
//
//   bun run scripts/audit-quality.ts                # all corpus/<name>/golden.json
//   bun run scripts/audit-quality.ts --root=corpus
//   bun run scripts/audit-quality.ts --strict       # exit 1 on WARN too (default: ERROR only)
//
// Heuristic, not ground truth — proxies for accuracy. ERROR = unambiguous bug;
// WARN = suspicious, worth a human/vision look. Validate the heuristics against
// the screenshots (the real ground truth) before trusting them as a gate.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const strict = process.argv.includes("--strict");
const root = arg("root") ?? "corpus";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (color ? `${code}${s}${RESET}` : s);

// Nav/UI labels that show up when hero detection grabs the wrong element.
const NAV_LABEL =
  /^(home|menu|search|log\s?in|sign\s?(in|up)|shopping bag|cart|categories|highlights|products?|explore|or|and|skip to (main )?content|get started|learn more)$/i;

interface Flag {
  level: "ERROR" | "WARN";
  code: string;
  detail: string;
}

// Does `hero` correspond to one of the page's h1s? (substring either way, after
// lowercasing + whitespace collapse) — the hero headline is normally the h1.
function heroMatchesH1(hero: string, h1s: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const h = norm(hero);
  if (!h) return false;
  return h1s.some((x) => {
    const n = norm(x);
    return n.length > 0 && (n.includes(h) || h.includes(n));
  });
}

// Smallest >=3-word periodic unit < whole → the duplication bug (regression guard).
function isDuplicated(s: string): boolean {
  const w = s.split(" ");
  for (let p = 3; p <= w.length / 2; p++) {
    if (w.length % p !== 0) continue;
    let ok = true;
    for (let i = p; i < w.length; i++)
      if (w[i] !== w[i % p]) {
        ok = false;
        break;
      }
    if (ok) return true;
  }
  return false;
}

interface GoldenAudit {
  pageAudit?: {
    hero?: { headline?: string; primaryCtaText?: string };
    headings?: { h1?: string[]; h1Count?: number };
  };
}

function checkGolden(golden: GoldenAudit): Flag[] {
  const flags: Flag[] = [];
  const a = golden?.pageAudit;
  if (!a) return [{ level: "ERROR", code: "no-pageAudit", detail: "golden has no pageAudit" }];

  const hero = (a.hero?.headline ?? "").trim();
  const h1s: string[] = a.headings?.h1 ?? [];
  const heroWords = hero ? hero.split(/\s+/).length : 0;

  if (!hero) {
    flags.push({ level: "ERROR", code: "hero-empty", detail: "no hero headline extracted" });
  } else {
    if (isDuplicated(hero))
      flags.push({ level: "ERROR", code: "hero-duplicated", detail: `"${hero.slice(0, 60)}…"` });
    if (NAV_LABEL.test(hero) || heroWords < 2)
      flags.push({
        level: "WARN",
        code: "hero-nav-label",
        detail: `"${hero}" looks like a UI label, not a headline`,
      });
    if (h1s.length > 0 && !heroMatchesH1(hero, h1s))
      flags.push({
        level: "WARN",
        code: "hero-h1-mismatch",
        detail: `hero "${hero}" not found in h1 ${JSON.stringify(h1s.map((s) => s.slice(0, 40)))}`,
      });
  }

  if ((a.headings?.h1Count ?? 0) === 0)
    flags.push({ level: "WARN", code: "no-h1", detail: "page has no <h1>" });
  if (!(a.hero?.primaryCtaText ?? "").trim())
    flags.push({ level: "WARN", code: "no-hero-cta", detail: "no primary CTA detected in hero" });

  return flags;
}

function listGoldens(): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "golden.json")))
    .map((d) => d.name)
    .sort();
}

const sites = listGoldens();
console.log("");
console.log(c(BOLD, `Audit-quality check — ${root}`));
console.log(c(DIM, `${sites.length} golden(s) · heuristic accuracy proxies (not ground truth)`));
console.log("");

let errors = 0;
let warns = 0;
for (const name of sites) {
  const golden = JSON.parse(readFileSync(join(root, name, "golden.json"), "utf8"));
  const flags = checkGolden(golden);
  const e = flags.filter((f) => f.level === "ERROR").length;
  const w = flags.filter((f) => f.level === "WARN").length;
  errors += e;
  warns += w;
  const badge = e > 0 ? c(RED, "✗") : w > 0 ? c(YELLOW, "!") : c(GREEN, "✓");
  console.log(`${badge} ${name}`);
  for (const f of flags) {
    const lvl = f.level === "ERROR" ? c(RED, "ERROR") : c(YELLOW, "WARN ");
    console.log(`    ${lvl} ${f.code.padEnd(18)} ${f.detail}`);
  }
}

console.log("");
console.log(
  `${c(BOLD, "Summary:")} ${sites.length} sites · ` +
    `${errors > 0 ? c(RED, errors + " errors") : "0 errors"} · ` +
    `${warns > 0 ? c(YELLOW, warns + " warns") : "0 warns"}`,
);
console.log("");

process.exit(errors > 0 || (strict && warns > 0) ? 1 : 0);
