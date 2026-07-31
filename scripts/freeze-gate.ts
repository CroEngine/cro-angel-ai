#!/usr/bin/env bun
// Nattlig frys-kvalitetsGRIND — svaret på "how will we make the freeze good
// enough?" steg 2 (genomgången 2026-07-30): #179:s mätverktyg upphöjda från
// rapport till BLOCKERANDE grind med tröskel.
//
// Per sajt i provuppsättningen:
//   1. freeze-page (browser-först, produktionens väg) → frozen.html + live-ref
//   2. freeze-fidelity → offline media-kompletthet (huvudmåttet: renderas
//      HELT offline — 100 % = självbärande kopia)
//   3. freeze-shot → skärmdumpar av frysta kopian
//   4. vision-triage (Claude, "skärmbilden är sanningen") över dumparna
//
// GRINDADE sajter (floor) fäller körningen (exit 1) vid:
//   frysning misslyckas · felsida · overallCompleteness < floor · vision "broken"
// OBSERVERADE sajter (floor null — kända trasiga klasser, t.ex. anyfins
// JS-challenge som väntar på CDP-asset-infångningen) rapporteras alltid men
// fäller aldrig — ärlig mätning utan permanent röd grind.
//
//   bun run scripts/freeze-gate.ts [--only=tibber,voi] [--out=gate-out]
//   env: FREEZE_GATE_FLOOR (default 90) · ANTHROPIC_API_KEY (vision; hoppas
//   med varning om den saknas) · BROWSERBASE_* (frysningens browser-väg)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface GateSite {
  name: string;
  url: string;
  /** Offline-kompletthetsgolv i %. null = observeras, grindar aldrig. */
  floor: number | null;
  note?: string;
}

// Provuppsättning: uppmätta sajter ur #179:s media-kompletthetsarbete.
// Golvet 90 ligger under de uppmätta friska nivåerna (96–100 %) men långt
// över de trasiga klasserna (sats 3,7 %, lovable 25 %, fika 51,6 %) — det
// fångar kollapser, inte brus. URL:er ur section-atlas (verifierade mot
// flottan 2026-07-28) + korpusen.
const DEFAULT_FLOOR = Number(process.env.FREEZE_GATE_FLOOR ?? 90);
const SITES: GateSite[] = [
  {
    name: "tibber",
    url: "https://tibber.com/se",
    floor: DEFAULT_FLOOR,
    note: "uppmätt 96,3 % efter lazy/karusell-fixarna",
  },
  { name: "voi", url: "https://www.voi.com/sv", floor: DEFAULT_FLOOR, note: "uppmätt 100 %" },
  { name: "lassie", url: "https://www.lassie.co/", floor: DEFAULT_FLOOR, note: "uppmätt 98,1 %" },
  { name: "hibob", url: "https://www.hibob.com", floor: DEFAULT_FLOOR, note: "uppmätt 99,8 %" },
  {
    name: "klarna",
    url: "https://www.klarna.com/se/",
    floor: DEFAULT_FLOOR,
    note: "uppmätt 97,3 % efter poster-fixen",
  },
  // Kända trasiga klasser — observeras tills sina designsteg landat:
  {
    name: "anyfin",
    url: "https://anyfin.se/",
    floor: null,
    note: "JS-challenge → HTML-skal; väntar på CDP-asset-infångning",
  },
  {
    name: "sats",
    url: "https://www.sats.se/",
    floor: null,
    note: "bakgrunds-CSS-klassen (3,7 % uppmätt) — browservägens verkan följs här",
  },
];

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = arg("out") ?? "gate-out";
const only = arg("only")?.split(",").filter(Boolean);
const sites = only ? SITES.filter((s) => only.includes(s.name)) : SITES;
if (sites.length === 0) {
  console.error(`[freeze-gate] inga sajter matchade --only=${only?.join(",")}`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

async function run(cmd: string[], timeoutMs: number): Promise<{ code: number; tail: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  const tail = (out + "\n" + err).trim().split("\n").slice(-6).join("\n");
  return { code, tail };
}

interface SiteResult {
  name: string;
  gated: boolean;
  floor: number | null;
  ok: boolean;
  completeness: number | null;
  completenessOnline: number | null;
  errorPage: boolean | null;
  vision: string | null;
  visionProblems: string[];
  fail: string[];
  warn: string[];
}

const results: SiteResult[] = [];

for (const site of sites) {
  const dir = join(OUT, site.name);
  const shots = join(dir, "shots");
  mkdirSync(shots, { recursive: true });
  const frozen = join(dir, "frozen.html");
  const r: SiteResult = {
    name: site.name,
    gated: site.floor !== null,
    floor: site.floor,
    ok: true,
    completeness: null,
    completenessOnline: null,
    errorPage: null,
    vision: null,
    visionProblems: [],
    fail: [],
    warn: [],
  };
  results.push(r);
  console.log(
    `\n[freeze-gate] ── ${site.name} (${site.url}) ${site.floor === null ? "· OBSERVERAD" : `· golv ${site.floor}%`}`,
  );

  const freeze = await run(
    [
      "bun",
      "run",
      "scripts/redesign/freeze-page.ts",
      `--url=${site.url}`,
      `--out=${frozen}`,
      `--ref-shot=${join(shots, "ref.png")}`,
      `--stats-out=${join(shots, "live-stats.json")}`,
    ],
    300_000,
  );
  if (freeze.code !== 0 || !existsSync(frozen)) {
    r.fail.push(`frysningen misslyckades (exit ${freeze.code})`);
    console.log(freeze.tail);
    continue;
  }

  const refArg = existsSync(join(shots, "ref.png")) ? [`--ref=${join(shots, "ref.png")}`] : [];
  const fidelity = await run(
    [
      "bun",
      "run",
      "scripts/diag/freeze-fidelity.ts",
      `--frozen=${frozen}`,
      ...refArg,
      `--out=${shots}`,
    ],
    240_000,
  );
  const fidelityPath = join(shots, "fidelity.json");
  if (fidelity.code !== 0 || !existsSync(fidelityPath)) {
    r.fail.push(`fidelity-mätningen misslyckades (exit ${fidelity.code})`);
    console.log(fidelity.tail);
    continue;
  }
  const f = JSON.parse(readFileSync(fidelityPath, "utf8")) as {
    overallCompleteness: number;
    overallCompletenessOnline?: number;
    errorPage?: boolean;
  };
  r.completeness = f.overallCompleteness;
  r.completenessOnline = f.overallCompletenessOnline ?? null;
  r.errorPage = f.errorPage ?? false;
  console.log(
    `[freeze-gate] ${site.name}: offline ${r.completeness}%` +
      (r.completenessOnline !== null ? ` · online ${r.completenessOnline}%` : "") +
      (r.errorPage ? " · FELSIDA" : ""),
  );
  if (r.errorPage) r.fail.push("frysningen är en felsida");
  if (site.floor !== null && r.completeness !== null && r.completeness < site.floor) {
    r.fail.push(`offline-kompletthet ${r.completeness}% < golv ${site.floor}%`);
  }

  await run(
    ["bun", "run", "scripts/diag/freeze-shot.ts", `--frozen=${frozen}`, `--out=${shots}`],
    120_000,
  );
}

// ── Vision-pass över de frysta kopiornas skärmdumpar (en batch) ─────────────
const shotPaths = results
  .map((r) => join(OUT, r.name, "shots", "fullpage.jpg"))
  .filter((p) => existsSync(p));
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[freeze-gate] ANTHROPIC_API_KEY saknas — vision-passet hoppas (grinden gäller ändå kompletthetsgolvet).",
  );
} else if (shotPaths.length > 0) {
  const vt = await run(
    [
      "bun",
      "run",
      "scripts/vision-triage.ts",
      `--paths=${shotPaths.join(",")}`,
      `--out=${join(OUT, "vision-triage.json")}`,
      `--md=${join(OUT, "vision-triage.md")}`,
    ],
    240_000,
  );
  if (existsSync(join(OUT, "vision-triage.json"))) {
    const verdicts = (
      JSON.parse(readFileSync(join(OUT, "vision-triage.json"), "utf8")) as {
        verdicts: Array<{ file: string; verdict: string; problems: string[]; error?: string }>;
      }
    ).verdicts;
    for (const v of verdicts) {
      const r = results.find((x) => v.file.includes(`/${x.name}/`));
      if (!r) continue;
      r.vision = v.error ? `api-fel: ${v.error.slice(0, 80)}` : v.verdict;
      r.visionProblems = v.problems;
      if (v.verdict === "broken") r.fail.push(`vision: broken [${v.problems.join(",")}]`);
      else if (v.verdict === "suspect" && !v.error)
        r.warn.push(`vision: suspect [${v.problems.join(",")}]`);
    }
  } else {
    console.warn(
      `[freeze-gate] vision-triage gav ingen utdata (exit ${vt.code}) — behandlas som varning`,
    );
    console.log(vt.tail);
  }
}

// ── Domslut + rapport ────────────────────────────────────────────────────────
let gateFailed = false;
const rows: string[] = [];
for (const r of results) {
  r.ok = r.fail.length === 0;
  const gatedFail = r.gated && !r.ok;
  if (gatedFail) gateFailed = true;
  const status = r.ok ? "PASS" : r.gated ? "FAIL" : "obs-fail";
  console.log(
    `[freeze-gate] ${status.padEnd(8)} ${r.name} · offline ${r.completeness ?? "—"}%` +
      (r.vision ? ` · vision ${r.vision}` : "") +
      (r.fail.length ? ` · ${r.fail.join("; ")}` : "") +
      (r.warn.length ? ` · varning: ${r.warn.join("; ")}` : ""),
  );
  rows.push(
    `| ${r.name} | ${r.gated ? `${r.floor}%` : "obs"} | ${r.completeness ?? "—"}% | ${r.completenessOnline ?? "—"}% | ${r.vision ?? "—"} | ${status} | ${[...r.fail, ...r.warn].join("; ").replace(/\|/g, "\\|") || "—"} |`,
  );
}

const gatedCount = results.filter((r) => r.gated).length;
const gatedPass = results.filter((r) => r.gated && r.ok).length;
writeFileSync(join(OUT, "freeze-gate.json"), JSON.stringify({ results }, null, 2));
writeFileSync(
  join(OUT, "freeze-gate.md"),
  `## Freeze-grind — ${gatedPass}/${gatedCount} grindade PASS${gateFailed ? " · **RÖD**" : " · grön"}\n\n` +
    `| sajt | golv | offline | online | vision | status | detalj |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}\n\n` +
    `_Offline-kompletthet = frysta kopian renderad med ALLT nätverk blockerat (självbärande-måttet ur #179). ` +
    `Observerade sajter (obs) är kända trasiga klasser som mäts men inte grindar._\n`,
);
console.log(
  `\n[freeze-gate] ${gatedPass}/${gatedCount} grindade PASS → ${OUT}/freeze-gate.{json,md}`,
);
process.exit(gateFailed ? 1 : 0);
