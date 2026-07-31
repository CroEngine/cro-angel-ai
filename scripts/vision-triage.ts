#!/usr/bin/env bun
// Vision-triage av frys-/render-skärmbilder — prototypen bakom "skärmbilden är
// sanningen" (render-fidelity-lärdomen 2026-07-26: signaturkoll flaggade fel
// sajt och missade den enda trasiga rendern; skärmbilden avgjorde).
//
// Vad den gör: skickar varje skärmbild till Claude (vision) och får en STRIKT
// JSON-dom: ser detta ut som en komplett, riktig sida — eller syns någon av
// frysningens kända skador (svart mediehål, vit-på-vitt, blank/nära-blank,
// ostylad HTML, challenge/captcha, consent-vägg, felsida, platshållare)?
//
// Rollen är TRIAGE, inte domare: automation flaggar riktning, människa
// bekräftar de flaggade. Advisory by default (exit 0); --strict ger exit 1
// vid minst en "broken" — det är kroken när detta blir en nattlig grind.
//
//   bun run scripts/vision-triage.ts                       # corpus/*/screenshot.jpg
//   bun run scripts/vision-triage.ts --dir=render-fidelity # alla .jpg/.png i katalog
//   bun run scripts/vision-triage.ts --paths=a.jpg,b.png
//   bun run scripts/vision-triage.ts --dry-list            # visa bara input-listan
//   flaggor: --out=vision-triage.json --md=summary.md --model=… --conc=4 --strict
//
// Kräver ANTHROPIC_API_KEY (samma secret som breadth-verify/nightly-loop).
// Kostnad: ~Haiku-vision-öre per bild.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";

import jpeg from "jpeg-js";

type Problem =
  | "blank_or_near_blank"
  | "black_media_hole"
  | "white_on_white_text"
  | "unstyled_html"
  | "challenge_or_captcha"
  | "consent_wall_dominant"
  | "error_page"
  | "placeholder_or_wrong_content"
  | "partial_crop";

interface Verdict {
  file: string;
  verdict: "ok" | "suspect" | "broken";
  problems: Problem[];
  note: string;
  error?: string;
}

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}
const flag = (n: string) => process.argv.includes(`--${n}`);

function resolveInputs(): string[] {
  const paths = arg("paths");
  if (paths)
    return paths
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const dir = arg("dir");
  if (dir) {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (/\.(jpe?g|png)$/i.test(e)) out.push(p);
      }
    };
    walk(dir);
    return out.sort();
  }
  // Default: korpusens committade skärmbilder.
  const out: string[] = [];
  if (existsSync("corpus")) {
    for (const site of readdirSync("corpus")) {
      const p = join("corpus", site, "screenshot.jpg");
      if (existsSync(p)) out.push(p);
    }
  }
  return out.sort();
}

// ── Tiling ───────────────────────────────────────────────────────────────────
// Anthropics vision-API avvisar bilder där någon dimension överstiger 8000 px
// (första liveluppet 2026-07-30: 5/10 korpusskärmbilder föll, 9446–12685 px
// höga fullPage-captures). Höga bilder delas i vertikala tiles (överlapp så
// element vid snittet inte halveras) och skickas som FLERA bilder i SAMMA
// meddelande → en dom per sida, ingen aggregering. Cap 4 tiles (~24k px)
// räcker corpusens högsta med marginal; fler droppas med notis i loggen.
const MAX_DIM = 7500; // egen marginal under API:ts 8000
const TILE_H = 6000;
const TILE_OVERLAP = 200;
const MAX_TILES = 4;
const TILE_QUALITY = 72;

interface ImagePart {
  mediaType: "image/jpeg" | "image/png";
  base64: string;
}

function prepareParts(file: string): { parts: ImagePart[]; tiledFrom: number | null } {
  const bytes = readFileSync(file);
  const isPng = extname(file).toLowerCase() === ".png";
  if (isPng) {
    // PNG tilas inte i prototypen (jpeg-js är jpeg-only) — skickas som den är;
    // en >8000 px png ger API-fel som syns ärligt i verdict.error.
    return {
      parts: [{ mediaType: "image/png", base64: bytes.toString("base64") }],
      tiledFrom: null,
    };
  }
  const decoded = jpeg.decode(bytes, { maxMemoryUsageInMB: 768 });
  if (decoded.height <= MAX_DIM && decoded.width <= MAX_DIM) {
    return {
      parts: [{ mediaType: "image/jpeg", base64: bytes.toString("base64") }],
      tiledFrom: null,
    };
  }
  const rowBytes = decoded.width * 4;
  const parts: ImagePart[] = [];
  let y = 0;
  while (y < decoded.height && parts.length < MAX_TILES) {
    const h = Math.min(TILE_H, decoded.height - y);
    const slice = decoded.data.subarray(y * rowBytes, (y + h) * rowBytes);
    const encoded = jpeg.encode({ data: slice, width: decoded.width, height: h }, TILE_QUALITY);
    parts.push({ mediaType: "image/jpeg", base64: Buffer.from(encoded.data).toString("base64") });
    if (y + h >= decoded.height) break;
    y += TILE_H - TILE_OVERLAP;
  }
  return { parts, tiledFrom: decoded.height };
}

const PROMPT = `You are triaging a screenshot of a FROZEN COPY of a company web page (an offline capture that may have lost media, styling or content). If several images are attached, they are sequential top-to-bottom vertical tiles of ONE page (with slight overlap) — give ONE combined verdict for the whole page. Judge ONLY what is visible.

Answer with STRICT JSON, no prose, matching:
{"verdict":"ok"|"suspect"|"broken","problems":[…],"note":"≤120 chars"}

problems values (include all that apply, [] if none):
"blank_or_near_blank" — page is mostly empty/white with little or no content
"black_media_hole" — black/empty rectangle where a video or image clearly belongs
"white_on_white_text" — text invisible or barely visible against its background
"unstyled_html" — raw HTML look: default fonts, no layout, link lists
"challenge_or_captcha" — bot check / captcha / "verify you are human"
"consent_wall_dominant" — a cookie/consent dialog covers most of the page
"error_page" — 404/500/access denied/service unavailable
"placeholder_or_wrong_content" — lorem/placeholder boxes, or content that cannot be a company landing page
"partial_crop" — capture visibly cut off mid-layout

verdict: "broken" = a customer shown this would notice damage immediately; "suspect" = something looks off but might be the real design; "ok" = looks like a complete, real page.`;

function parseVerdict(raw: string): {
  verdict: Verdict["verdict"];
  problems: Problem[];
  note: string;
} {
  // Tolerant: modeller staket-inramar ibland trots instruktion (llm-json-lärdomen).
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const j = JSON.parse(stripped) as { verdict?: string; problems?: unknown; note?: unknown };
  const verdict =
    j.verdict === "ok" || j.verdict === "suspect" || j.verdict === "broken" ? j.verdict : "suspect";
  const problems = Array.isArray(j.problems)
    ? (j.problems.filter((p) => typeof p === "string") as Problem[])
    : [];
  const note = typeof j.note === "string" ? j.note.slice(0, 200) : "";
  return { verdict, problems, note };
}

async function triageOne(
  anthropic: import("@anthropic-ai/sdk").default,
  model: string,
  file: string,
): Promise<Verdict> {
  try {
    const { parts, tiledFrom } = prepareParts(file);
    if (tiledFrom) {
      console.log(
        `[vision-triage] ${file}: ${tiledFrom}px hög → ${parts.length} tile(s)` +
          (tiledFrom > TILE_H * MAX_TILES
            ? ` (botten under ~${TILE_H * MAX_TILES}px droppad)`
            : ""),
      );
    }
    const res = await anthropic.messages.create({
      model,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            ...parts.map(
              (p) =>
                ({
                  type: "image",
                  source: { type: "base64", media_type: p.mediaType, data: p.base64 },
                }) as const,
            ),
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { file, ...parseVerdict(text) };
  } catch (e) {
    return {
      file,
      verdict: "suspect",
      problems: [],
      note: "",
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    };
  }
}

async function mapPool<T, R>(items: T[], conc: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(conc, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const inputs = resolveInputs();
if (inputs.length === 0) {
  console.error(
    "[vision-triage] inga input-bilder (corpus/*/screenshot.jpg saknas; ange --dir=/--paths=)",
  );
  process.exit(1);
}
if (flag("dry-list")) {
  for (const f of inputs) console.log(f);
  console.log(`[vision-triage] ${inputs.length} bild(er) — dry-list, inga API-anrop.`);
  process.exit(0);
}
if (flag("probe-tiles")) {
  // Lokal validering av tilingen (decode → slice → re-encode) utan API-anrop.
  for (const f of inputs) {
    const t0 = Date.now();
    const { parts, tiledFrom } = prepareParts(f);
    const kb = parts.reduce((s, p) => s + Math.round((p.base64.length * 3) / 4 / 1024), 0);
    console.log(
      `${f}: ${parts.length} part(s)${tiledFrom ? ` (tiled från ${tiledFrom}px)` : ""} · ${kb}kb · ${Date.now() - t0}ms`,
    );
  }
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[vision-triage] ANTHROPIC_API_KEY saknas.");
  process.exit(1);
}
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const anthropic = new Anthropic();
const model = arg("model") ?? process.env.ANGEL_VISION_MODEL ?? "claude-haiku-4-5-20251001";
const conc = Number(arg("conc") ?? 4);

console.log(`[vision-triage] ${inputs.length} bild(er) · model=${model} · conc=${conc}`);
const verdicts = await mapPool(inputs, conc, (f) => triageOne(anthropic, model, f));

const counts = { ok: 0, suspect: 0, broken: 0, errored: 0 };
for (const v of verdicts) {
  if (v.error) counts.errored++;
  counts[v.verdict]++;
  const flagIcon = v.verdict === "ok" ? "  " : v.verdict === "suspect" ? "?!" : "XX";
  console.log(
    `${flagIcon} ${v.verdict.toUpperCase().padEnd(7)} ${basename(join(v.file, ".."))}/${basename(v.file)}` +
      (v.problems.length ? ` [${v.problems.join(",")}]` : "") +
      (v.note ? ` — ${v.note}` : "") +
      (v.error ? ` (API-fel: ${v.error})` : ""),
  );
}
console.log(
  `[vision-triage] ok ${counts.ok} · suspect ${counts.suspect} · broken ${counts.broken}` +
    (counts.errored ? ` · API-fel ${counts.errored}` : ""),
);

const outPath = arg("out") ?? "vision-triage.json";
writeFileSync(
  outPath,
  JSON.stringify({ model, generatedBy: "scripts/vision-triage.ts", verdicts }, null, 2),
);
console.log(`[vision-triage] verdicts -> ${outPath}`);

const mdPath = arg("md");
if (mdPath) {
  const rows = verdicts
    .map(
      (v) =>
        `| ${v.file} | ${v.verdict} | ${v.problems.join(", ") || "—"} | ${(v.note || v.error || "").replace(/\|/g, "\\|")} |`,
    )
    .join("\n");
  writeFileSync(
    mdPath,
    `## Vision-triage (${model})\n\n` +
      `ok **${counts.ok}** · suspect **${counts.suspect}** · broken **${counts.broken}**` +
      `${counts.errored ? ` · API-fel **${counts.errored}**` : ""}\n\n` +
      `| bild | dom | problem | not |\n|---|---|---|---|\n${rows}\n\n` +
      `_Triage, inte domare: automation flaggar riktning — människa bekräftar de flaggade (render-fidelity-lärdomen)._\n`,
  );
  console.log(`[vision-triage] markdown -> ${mdPath}`);
}

if (flag("strict") && counts.broken > 0) process.exit(1);
