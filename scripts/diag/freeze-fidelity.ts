#!/usr/bin/env bun
// Frysningens KOMPLETTHET (ägarfråga 2026-07-28 "hur vet du att den fryser
// komplett?"). Första ansatsen var pixeljämförelse mot en live-referens —
// återvändsgränd: live och fryst har olika totalhöjd (sidan flödar om), så
// position-för-position-jämförelse förväxlar SAKNAT med FÖRSKJUTET och blir
// meningslös. Rätt fråga ställs mot INNEHÅLLET, inte bilden:
//
//   • TEXT är komplett per konstruktion — den frysta kopian ÄR den renderade
//     DOM:en minus JavaScript, så varje rubrik/stycke/knapp browsern såg är
//     kvar ordagrant. Vi rapporterar räknare (rubriker/tecken) som sanity.
//   • MEDIA är det enda som kan gå förlorat. Varje <img>/<video>/<source>/
//     poster + CSS-url() klassas efter sin frysta källa:
//        inlined  = data:-URI  → renderas ALLTID (även offline). Golvet.
//        linked   = absolut http(s) → renderas i växlaren (CSP tillåter
//                   https), men kräver nät. Täckt, ej offline-garanterat.
//        lost     = 1×1-placeholder / tom / trasig → VERKLIG förlust.
//
//   Kompletthet = (inlined + linked) / total media.
//   Offline-kompletthet = inlined / total media  ← ÄRLIGA GOLVET.
//   Alignment-fritt, nätfritt.
//
// TVÅ KÄNDA GRÄNSER (dokumenterade, inte dolda):
//   1. "linked" ANTAR att en absolut URL renderar — falskt för bot-vägg-
//      sajter (anyfin: _next/image-länkarna returnerar challenge-HTML, inte
//      bilder). Därför är offline-completeness (inlinat) det ärliga golvet
//      och completeness ett tak. Ett nät-stickprov skulle skärpa "linked"
//      men gör måttet flakigt — medvetet bortvalt.
//   2. Måttet mäter täckning av det som FINNS i kopian, inte om det är RÄTT
//      sida. looksLikeErrorPage-vakten fångar uppenbara 404/challenge (titel/
//      h1), men inte alla. Sid-identiteten är freeze-pages ansvar uppströms.
//
//   bun run scripts/diag/freeze-fidelity.ts --frozen=<html> [--out=dir]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FROZEN = arg("frozen");
const OUT = arg("out") ?? "fidelity-out";
if (!FROZEN) {
  console.error("usage: --frozen=<frozen.html> [--out=dir]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const html = readFileSync(FROZEN, "utf8");

// En källa klassas per sin form. Placeholder-signaturerna täcker de vanliga
// lazy-mönstren (Nexts 1×1-gif, tomma/blur-data, spacer-pixlar).
const PLACEHOLDER =
  /R0lGOD|data:image\/gif;base64,[A-Za-z0-9+/]{0,40}=?$|data:image\/svg\+xml.{0,30}$|^data:,$/i;
type Klass = "inlined" | "linked" | "lost";
const classify = (src: string | undefined | null): Klass => {
  const s = (src ?? "").trim();
  if (!s) return "lost";
  if (s.startsWith("data:")) {
    // data:-URI: äkta inlining om den bär rimlig nyttolast; annars placeholder.
    if (PLACEHOLDER.test(s) || s.length < 120) return "lost";
    return "inlined";
  }
  if (/^(https?:)?\/\//i.test(s) || s.startsWith("/")) return "linked";
  return "lost"; // relativ/skräp — laddar ingenstans ur en fristående kopia
};

interface MediaRow {
  kind: string;
  src: string;
  klass: Klass;
}
const media: MediaRow[] = [];

// <img>, <video>, <source> — src-attribut (srcset är redan strippat i frysen).
for (const m of html.matchAll(/<(img|video|source)\b[^>]*>/gi)) {
  const tag = m[0];
  const kind = m[1].toLowerCase();
  const src = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const val = src ? (src[2] ?? src[3] ?? src[4]) : null;
  // <video>/<source> utan src men med poster fångas nedan; en <video> med
  // barn-<source> saknar egen src och räknas inte dubbelt.
  if (kind === "video" && !val) continue;
  media.push({ kind, src: (val ?? "").slice(0, 90), klass: classify(val) });
}
// poster-attribut på video/mux-player.
for (const m of html.matchAll(/<(?:video|mux-player)\b[^>]*\bposter\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
  const val = m[2] ?? m[3];
  media.push({ kind: "poster", src: (val ?? "").slice(0, 90), klass: classify(val) });
}
// CSS url(...) — bakgrunder + typsnitt (data: räknas som inlined, absolut som linked).
for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
  const val = m[2];
  if (!val || val.startsWith("#")) continue;
  const kind = /\.(woff2?|ttf|otf)/i.test(val) ? "font" : "css-bg";
  media.push({ kind, src: val.slice(0, 90), klass: classify(val) });
}

const total = media.length;
const inlined = media.filter((m) => m.klass === "inlined").length;
const linked = media.filter((m) => m.klass === "linked").length;
const lost = media.filter((m) => m.klass === "lost").length;
const pct = (n: number) => Math.round((n / Math.max(1, total)) * 1000) / 10;

// Text-sanity (komplett per konstruktion — räknarna gör det synligt).
const headings = (html.match(/<h[1-3]\b/gi) ?? []).length;
const textChars = html
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim().length;
const frozenAt = html.match(/angel-frozen-at:([^\s]+)/)?.[1] ?? null;

// FÄLLLUCKAN (anyfin-fyndet 2026-07-28): måttet mäter täckning av det som
// FINNS i kopian, inte om det är RÄTT sida. En bot-vägg (anyfin frös sin
// 404/challenge) får då falskt 100 %. Grov identitetsvakt: fel-/challenge-
// signaturer eller misstänkt tunt innehåll ⇒ täckningen är opålitlig, säg
// det rakt ut. (Den riktiga fixen är uppströms — freeze-page ska vägra en
// challenge-sida; den anyfin-stealthen är en känd öppen post.)
// Markörerna testas BARA mot titel + h1 (fyndet 2026-07-28: en lös svep över
// hela markupen matchade "404"/"403" inuti base64-hashar i hibobs kod — falskt
// larm). En riktig felsida annonserar sig i titeln/rubriken; en tunn sida
// fångas separat av teckenräknaren.
const errorMarkers =
  /\b404\b|\b403\b|not found|sidan (du letar|kunde inte)|page not found|access denied|are you a robot|verify you are human|checking your browser|attention required|just a moment/i;
const titleText = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
const h1Text = html.match(/<h1\b[^>]*>([\s\S]{0,120}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "";
const looksLikeErrorPage = errorMarkers.test(`${titleText} ${h1Text}`) || textChars < 600;

const lostRows = media.filter((m) => m.klass === "lost").slice(0, 8);
const report = {
  completeness: pct(inlined + linked), // (inlined+linked)/total
  offlineCompleteness: pct(inlined), // inlined/total
  looksLikeErrorPage, // true ⇒ täckningen mäter kanske FEL sida
  media: { total, inlined, linked, lost },
  text: { headings, chars: textChars },
  frozenAt,
  lostSamples: lostRows.map((m) => `${m.kind}: ${m.src}`),
};
writeFileSync(join(OUT, "fidelity.json"), JSON.stringify(report, null, 2));

if (looksLikeErrorPage) {
  console.log(
    `[fidelity] ⚠️ VARNING: kopian ser ut som en fel-/challenge-sida (${textChars} tecken) — täckningen nedan mäter kanske FEL sida, inte den riktiga.`,
  );
}
console.log(
  `[fidelity] KOMPLETTHET: ${report.completeness}% av ${total} media renderar (${inlined} inlinade + ${linked} länkade); ${lost} förlorade`,
);
console.log(`[fidelity] offline-komplett (inlinat): ${report.offlineCompleteness}%`);
console.log(`[fidelity] text (komplett per konstruktion): ${headings} rubriker · ${textChars} tecken`);
if (lostRows.length) console.log(`[fidelity] förlorade (topp): ${report.lostSamples.join(" · ")}`);
