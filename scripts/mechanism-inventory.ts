#!/usr/bin/env bun
/**
 * Grind 0 — Mechanism Inventory
 *
 * Scans frozen MHTMLs in fixtures/drift-survey/ for PRESENCE of frameworks
 * known a-priori to be non-deterministic. Output is a presence-inventory,
 * NOT drift evidence. Two-freeze drift is only observed by
 * scripts/freeze-determinism-check.ts (Grind 1).
 *
 * Score-impact axis is per-mechanism, not per-site:
 *   - neutral: instrumentation that the extractor ignores or that doesn't
 *     affect the scored surface (CSRF tokens, nonces, cache-busters, MHTML
 *     Date headers, session-recording probes).
 *   - sample-defining: content varies — A/B frameworks, personalization,
 *     ad injection. Conservative default; presence on a site does not prove
 *     the hero is affected (could run on checkout/account pages).
 *
 *   bun run scripts/mechanism-inventory.ts
 */
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Mechanism {
  id: string;
  category: string;
  scoreImpact: "neutral" | "sample-defining";
  patterns: RegExp[];
  note: string;
}

const MECHANISMS: Mechanism[] = [
  {
    id: "consent-cmp:onetrust",
    category: "consent / CMP",
    scoreImpact: "neutral",
    patterns: [/optanon|data-domain-script|onetrust/i],
    note: "OneTrust CMP. Session-ID surfaces in attributes (optanon-*, data-domain-script). Extractor-neutral.",
  },
  {
    id: "session-token:hubspot-laboratory",
    category: "session / security tokens",
    scoreImpact: "neutral",
    patterns: [/laboratory-identifier|hs-laboratory|window\.hsLaboratory/i],
    note: "HubSpot Laboratory framework. Per-session bucket ID surfaces as <meta name=\"laboratory-identifier-*\" content=\"anon<32hex>\">. Whitelist envelope is the meta-attr value only (see fixtures/determinism/WHITELIST.md round3, 2026-06-17). Reclassified from ab:* to session-token:* because the narrowed envelope covers only the session-ID surface — the body-structure variance round2 attributed to it (bot-tarpit anchor at <body> open) is heuristic/bot-score-driven, NOT bucket-deterministic, and is explicitly NOT whitelisted.",
  },

  {
    id: "consent-cmp:other",
    category: "consent / CMP",
    scoreImpact: "neutral",
    patterns: [/usercentrics|didomi|cookieyes|cookielaw/i],
    note: "Other CMPs (Usercentrics, Didomi, CookieYes, CookieLaw). Same shape as OneTrust.",
  },
  {
    id: "ab:optimizely",
    category: "A/B experimentation",
    scoreImpact: "sample-defining",
    patterns: [/optimizely|optly\.|window\._optimizely/i],
    note: "Optimizely. Bucket selection per session → content varies. Conservative: hero impact unconfirmed until determinism-check observes drift there.",
  },
  {
    id: "ab:vwo",
    category: "A/B experimentation",
    scoreImpact: "sample-defining",
    patterns: [/_vis_opt_|data-vwo-|__vwo/i],
    note: "VWO (Visual Website Optimizer). Same shape as Optimizely.",
  },
  {
    id: "ab:adobe-target",
    category: "A/B experimentation",
    scoreImpact: "sample-defining",
    patterns: [/adobe-target|mboxDefault|at\.js/i],
    note: "Adobe Target. Conservative sample-defining.",
  },
  {
    id: "personalization:dynamic-yield",
    category: "personalization",
    scoreImpact: "sample-defining",
    patterns: [/dynamic-yield|dy-rec-|window\.DY\b/i],
    note: "Dynamic Yield. Per-session recommendation slots.",
  },
  {
    id: "personalization:monetate",
    category: "personalization",
    scoreImpact: "sample-defining",
    patterns: [/monetate/i],
    note: "Monetate. Per-session recommendations.",
  },
  {
    id: "ads:googletag",
    category: "ad injection",
    scoreImpact: "sample-defining",
    patterns: [/googletag\.cmd|googlesyndication|pubads|prebid|aps_publisherId/i],
    note: "Google Ad Manager / Prebid / Amazon APS. Auction outcome varies per request.",
  },
  {
    id: "session-token:csrf",
    category: "session / security tokens",
    scoreImpact: "neutral",
    patterns: [/<meta name="csrf-token"|data-csrf|xsrf-token/i],
    note: "CSRF tokens. Per-session, security-by-design. Whitelisted; extractor ignores.",
  },
  {
    id: "session-token:nonce",
    category: "session / security tokens",
    scoreImpact: "neutral",
    patterns: [/\bnonce="[a-zA-Z0-9+/=_-]{8,}"/],
    note: "CSP nonces, per-request. Whitelisted; extractor ignores.",
  },
  {
    id: "cdn-bust:hash-query",
    category: "CDN / build-hash artifacts",
    scoreImpact: "neutral",
    patterns: [/[?&](v|t|ts|cb|cache|version|build|hash)=[a-z0-9.-]{4,}/i],
    note: "CDN cache-busting query params. Whitelisted.",
  },
  {
    id: "cdn-bust:filename-hash",
    category: "CDN / build-hash artifacts",
    scoreImpact: "neutral",
    patterns: [/\.[a-f0-9]{8,}\.(js|css|woff2?|png|jpe?g|svg)/i],
    note: "Build-time content hashes in filenames. Stable within a deploy, rotates on redeploy. Whitelisted.",
  },
  {
    id: "session-recording",
    category: "session-recording (instrumentation)",
    scoreImpact: "neutral",
    patterns: [/_uxa|usabilla|fullstory|_hjSettings|hotjar|mouseflow|clarity\.ms/i],
    note: "Session-recording probes (Contentsquare _uxa, Usabilla, FullStory, Hotjar, Mouseflow, MS Clarity). Send-only telemetry; does NOT inject visible variants. Extractor-neutral.",
  },
];

const ROOT = "fixtures/drift-survey";
const PRESENCE: Record<string, { sites: string[]; sampleFragments: Record<string, string> }> = {};
for (const m of MECHANISMS) PRESENCE[m.id] = { sites: [], sampleFragments: {} };

const SKIPPED: Array<{ site: string; reason: string }> = [];
const SCANNED: string[] = [];

function walkSites(dir: string): Array<{ category: string; site: string; path: string }> {
  const out: Array<{ category: string; site: string; path: string }> = [];
  for (const cat of readdirSync(dir)) {
    const catDir = join(dir, cat);
    if (!statSync(catDir).isDirectory()) continue;
    for (const site of readdirSync(catDir)) {
      const siteDir = join(catDir, site);
      if (!statSync(siteDir).isDirectory()) continue;
      out.push({ category: cat, site, path: siteDir });
    }
  }
  return out;
}

for (const { category, site, path } of walkSites(ROOT)) {
  const mhtmlPath = join(path, "page.mhtml");
  const ptrPath = join(path, "page.mhtml.asset.json");
  const key = `${category}/${site}`;
  if (!existsSync(mhtmlPath)) {
    if (existsSync(ptrPath)) SKIPPED.push({ site: key, reason: "externalized-to-cdn" });
    else SKIPPED.push({ site: key, reason: "no-mhtml (capture failed)" });
    continue;
  }
  let raw: string;
  try {
    raw = readFileSync(mhtmlPath, "utf8");
  } catch {
    SKIPPED.push({ site: key, reason: "unreadable" });
    continue;
  }
  SCANNED.push(key);
  for (const m of MECHANISMS) {
    for (const re of m.patterns) {
      const hit = raw.match(re);
      if (hit) {
        PRESENCE[m.id].sites.push(key);
        PRESENCE[m.id].sampleFragments[key] = hit[0].slice(0, 160);
        break;
      }
    }
  }
}

// Group by category for output
const byCategory: Record<string, Mechanism[]> = {};
for (const m of MECHANISMS) {
  (byCategory[m.category] ??= []).push(m);
}

let md = `# Mechanism Inventory — Auto-Generated\n\n`;
md += `> Source: \`scripts/mechanism-inventory.ts\` over \`fixtures/drift-survey/**/page.mhtml\`.\n`;
md += `> Generated: ${new Date().toISOString()}\n`;
md += `> Scanned: ${SCANNED.length} MHTML files. Skipped: ${SKIPPED.length}.\n\n`;
md += `**This is a presence inventory, not drift evidence.** Two-freeze drift is only observed by \`scripts/freeze-determinism-check.ts\` (Grind 1).\n\n`;

for (const [cat, mechs] of Object.entries(byCategory)) {
  md += `## ${cat}\n\n`;
  md += `| Mechanism | score-impact | sites (n) | sample fragment |\n|---|---|---|---|\n`;
  for (const m of mechs) {
    const p = PRESENCE[m.id];
    const n = p.sites.length;
    const sample = n > 0 ? "`" + (p.sampleFragments[p.sites[0]] ?? "").replace(/\|/g, "\\|").replace(/`/g, "ʼ") + "`" : "—";
    md += `| \`${m.id}\` | ${m.scoreImpact} | ${n} | ${sample} |\n`;
  }
  md += `\n`;
  for (const m of mechs) {
    const p = PRESENCE[m.id];
    if (p.sites.length === 0) continue;
    md += `- **${m.id}** (${m.scoreImpact}) — ${m.note}\n  - Sites: ${p.sites.join(", ")}\n`;
  }
  md += `\n`;
}

md += `## Skipped sites\n\n`;
for (const s of SKIPPED) md += `- \`${s.site}\` — ${s.reason}\n`;
md += `\n## Unclassified\n\nManual review required: if a site is in SCANNED but shows zero mechanism hits, it is NOT auto-listed as "no drift" — it just means none of the regex categories matched. The mechanism set is a closed-list; expanding it is a human decision per row, not auto-fill.\n`;

const outPath = "fixtures/drift-survey/MECHANISM-INVENTORY.md";
writeFileSync(outPath, md);
// eslint-disable-next-line no-console
console.log(`[mechanism-inventory] -> ${outPath}`);
// eslint-disable-next-line no-console
console.log(`[mechanism-inventory] scanned=${SCANNED.length} skipped=${SKIPPED.length}`);
for (const m of MECHANISMS) {
  const n = PRESENCE[m.id].sites.length;
  if (n > 0) console.log(`  ${m.id}: ${n} sites (${m.scoreImpact})`);
}
