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

import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import { normalizePageAudit } from "../src/lib/tests/snapshot/normalize";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const strict = process.argv.includes("--strict");
// --replay: replay captures under --root (lenient) and check the live audit,
// for breadth captures that have no golden.json. Default reads golden.json.
const replay = process.argv.includes("--replay");
const root = arg("root") ?? "corpus";
const timeoutMs = Number(arg("timeout") ?? "120") * 1000;
// Auto-retry a failed replay (flakiness is often transient) so robustness noise
// doesn't mask real quality signal. Only used in --replay mode.
const retries = Number(arg("retries") ?? "1");

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
// A primary CTA that is actually an accessibility skip-link — a hard bug.
const SKIP_LINK = /^skip to (main )?(content|navigation|nav|search)/i;
// Informational link masquerading as a conversion CTA.
const WEAK_CTA = /^(learn more|read more|find out more|see more|explore)\b/i;
// Actual nav/UI items wrongly taken as a CTA. Narrower than NAV_LABEL: a CTA
// like "Get started"/"Sign up" is GOOD, so those must NOT be flagged here.
const CTA_NAV_LABEL =
  /^(home|menu|search|cart|shopping bag|wishlist|favou?rites|account|my account|log\s?in|sign\s?in)$/i;

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
    ctaSummary?: { total?: number; primary?: number; aboveFold?: number };
    trustSummary?: { total?: number; aboveFold?: number; byType?: Record<string, number> };
  };
  // Raw CTA list, only present in --replay mode (golden drops it). Lets us catch
  // a skip-link/nav item wrongly classified cta_primary, not just the count.
  rawCtas?: Array<{ text?: string; category?: string }>;
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

  // --- CTA quality ---
  const heroCta = (a.hero?.primaryCtaText ?? "").trim();
  if (!heroCta) {
    flags.push({ level: "WARN", code: "no-hero-cta", detail: "no primary CTA detected in hero" });
  } else if (SKIP_LINK.test(heroCta)) {
    flags.push({
      level: "ERROR",
      code: "hero-cta-skiplink",
      detail: `hero CTA is a skip-link: "${heroCta}"`,
    });
  } else if (CTA_NAV_LABEL.test(heroCta)) {
    flags.push({
      level: "WARN",
      code: "hero-cta-nav",
      detail: `hero CTA looks like a nav item: "${heroCta}"`,
    });
  } else if (WEAK_CTA.test(heroCta)) {
    flags.push({
      level: "WARN",
      code: "hero-cta-weak",
      detail: `hero CTA is informational, not conversion: "${heroCta}"`,
    });
  }
  if ((a.ctaSummary?.total ?? 0) === 0)
    flags.push({ level: "WARN", code: "no-ctas", detail: "no CTAs detected on the page" });
  // Replay-only: a skip-link/nav item classified cta_primary (count alone hides it).
  for (const cta of golden.rawCtas ?? []) {
    if (cta.category !== "cta_primary") continue;
    const t = (cta.text ?? "").trim();
    if (SKIP_LINK.test(t))
      flags.push({
        level: "ERROR",
        code: "skiplink-as-primary-cta",
        detail: `"${t}" classified cta_primary`,
      });
  }

  // --- Trust quality ---
  const trust = a.trustSummary;
  if (trust && (trust.total ?? 0) === 0)
    flags.push({ level: "WARN", code: "no-trust", detail: "no trust signals detected" });
  for (const [type, n] of Object.entries(trust?.byType ?? {}))
    if ((n as number) > 25)
      flags.push({
        level: "WARN",
        code: "trust-overcount",
        detail: `${n} ${type} — likely over-counted`,
      });

  return flags;
}

function listGoldens(): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "golden.json")))
    .map((d) => d.name)
    .sort();
}

// Recursively find capture dirs (page.mhtml) for --replay over nested breadth trees.
function findCaptures(dir: string, rel = ""): string[] {
  let entries;
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  if (
    entries.some(
      (e) => e.isFile() && (e.name === "page.mhtml" || e.name === "page.mhtml.asset.json"),
    )
  )
    return [rel];
  const out: string[] = [];
  for (const e of entries)
    if (e.isDirectory()) out.push(...findCaptures(dir, rel ? join(rel, e.name) : e.name));
  return out.sort();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`replay timeout ${ms / 1000}s (${label})`)), ms),
    ),
  ]);
}

// Resolve a site to { pageAudit } (the shape checkGolden reads): replay+normalize
// in --replay mode, else read the committed golden.
async function loadAudit(name: string): Promise<GoldenAudit | { error: string }> {
  if (!replay) return JSON.parse(readFileSync(join(root, name, "golden.json"), "utf8"));
  try {
    const fresh = await withTimeout(
      replayCorpus(name, root, { lenientCanary: true }),
      timeoutMs,
      name,
    );
    const rawPa = fresh.pageAudit as { ctas?: Array<{ text?: string; category?: string }> };
    return { pageAudit: normalizePageAudit(fresh.pageAudit), rawCtas: rawPa?.ctas ?? [] };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : String(e) };
  }
}

async function main(): Promise<number> {
  const sites = replay ? findCaptures(root) : listGoldens();
  console.log("");
  console.log(c(BOLD, `Audit-quality check — ${root}${replay ? " (replay)" : ""}`));
  console.log(c(DIM, `${sites.length} site(s) · heuristic accuracy proxies (not ground truth)`));
  console.log("");

  let errors = 0;
  let warns = 0;
  let failed = 0;
  for (const name of sites) {
    let loaded = await loadAudit(name);
    for (let attempt = 0; replay && "error" in loaded && attempt < retries; attempt++) {
      loaded = await loadAudit(name);
    }
    if ("error" in loaded) {
      failed++;
      console.log(`${c(YELLOW, "?")} ${name}`);
      console.log(`    ${c(DIM, "replay-failed")} ${loaded.error}`);
      continue;
    }
    const flags = checkGolden(loaded);
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
      `${warns > 0 ? c(YELLOW, warns + " warns") : "0 warns"}` +
      `${failed ? ` · ${c(YELLOW, failed + " replay-failed")}` : ""}`,
  );
  console.log("");
  return errors > 0 || (strict && warns > 0) ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
