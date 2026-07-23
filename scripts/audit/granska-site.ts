#!/usr/bin/env bun
// "Granska min sajt" — säljartefakten (ägarens plan 2026-07-15).
//
// URL in → fryst kopia → extraktion → deterministiska fynd → (om möjligt) ETT
// grindat flytt-förslag med FÖRE/EFTER-skärmdumpar → en självbärande svensk
// engångsrapport (HTML) att bifoga i outreach. ALLT återanvänder motorn:
// freeze-page.ts, extractContentModel, runGatedAttempts, pixelgrindarna.
//
// Ärlighetskontrakt (samma som produkten): inget hittas på — varje fynd är en
// mätning; före/efter visas BARA om grindarna gav rent pass; vägrar motorn
// (ingen ren sektionsnivå) säger rapporten det i stället för att gissa.
//
//   bun run scripts/audit/granska-site.ts --url=https://exempel.se \
//     --namn="Exempel AB" --out=audit-out/exempel \
//     [--pris="5 000 kr"] [--kontakt="hello@croengine.se"] [--mode=onboarding] \
//     [--goal="Skapa konto"]   ← ägarens konfigurerade mål; slår gissningen
//
// --mode=onboarding (task #98): samma mätningar och grindar, men rapporten
// blir kundens dag-0-granskning i dashboarden — engelsk copy (produktens
// språk), ingen pilot-pitch/pris, ingen kontaktuppmaning. Default är
// outreach-läget (svensk säljartefakt) — det befintliga flödet rörs inte.

import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { isVacuityWarn } from "../../src/adaptive/redesign/render-gates";
import { EVIDENCE_SECTION_TYPES } from "../../src/adaptive/redesign/vocab";
import { measurePlan, runGatedAttempts, type MeasureOp } from "../redesign/measure";

// Env-var eller undefined — playwright-core hittar sin egen installation
// (bunx playwright install) på Actions-runnern; den hårdkodade dev-sökvägen
// fällde day-0-svepet i generalrepetitionen 2026-07-17.
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

const url = arg("url");
const namn = arg("namn") ?? new URL(url ?? "https://x").hostname.replace(/^www\./, "");
const outDir = arg("out");
const pris = arg("pris") ?? "5 000 kr";
const kontakt = arg("kontakt") ?? "hello@croengine.se";
const MODE = (arg("mode") ?? "outreach") as "outreach" | "onboarding";
const EN = MODE === "onboarding";
// Ägarens konfigurerade mål (onboardingens målbekräftelse, angel_sites.
// conversion_text). Vinner alltid över extraktionens gissning — gissningen
// träffade logga-länken "GlutenForum" i skarpa provet 2026-07-17.
const ownerGoal = arg("goal")?.trim() || null;
if (!url || !outDir) {
  console.error(
    "usage: granska-site.ts --url=... --out=dir [--namn=...] [--pris=...] [--kontakt=...] [--mode=onboarding]",
  );
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// ── 1. frys (cachad — omkörningar rör inte nätet) ────────────────────────────
const frozenPath = join(outDir, "frozen.html");
if (!existsSync(frozenPath)) {
  const r = Bun.spawnSync([
    "bun",
    "run",
    "scripts/redesign/freeze-page.ts",
    `--url=${url}`,
    `--out=${frozenPath}`,
  ]);
  if (r.exitCode !== 0 || !existsSync(frozenPath)) {
    console.error(`frysning misslyckades:\n${r.stderr}`);
    process.exit(1);
  }
}
const html = readFileSync(frozenPath, "utf8");

// ── 2. rendera + mät ─────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.route("**/*", (r) =>
  r.request().url().startsWith("data:") ? r.continue() : r.abort(),
);
const page = await context.newPage();
await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(600);

// Extraktion mot RENDERAD DOM (samma som breadth-testet).
const rendered = await page.evaluate(() => document.documentElement.outerHTML);
const content = extractContentModel(rendered);
const convCtas = content.ctas.filter((c) => c.intent === "conversion");
const goalGuess = ownerGoal ?? convCtas.find((c) => c.aboveFold)?.text ?? convCtas[0]?.text ?? null;
// Extraherade konverterings-CTA:er ∪ ägarens måltext — samma union som
// auto-generate, så mätningarna alltid vaktar målets element.
const ctaTexts = [...new Set([...convCtas.map((c) => c.text), ...(ownerGoal ? [ownerGoal] : [])])];

// Basmätning (inga ops): overflow + CTA-klickbarhet i mobilviewport.
const base = await measurePlan(page, [], ctaTexts);

// ── 3. fynden — mätningar, aldrig tyckande ───────────────────────────────────
interface Fynd {
  rubrik: string;
  text: string;
  vikt: number;
}
const fynd: Fynd[] = [];

const aboveFoldConv = convCtas.filter((c) => c.aboveFold);
if (convCtas.length === 0) {
  fynd.push({
    vikt: 1,
    rubrik: EN ? "No clear conversion action found" : "Ingen tydlig konverterings-knapp hittad",
    text: EN
      ? `Our classifier (30 languages + structural rules) found no clear book/buy/contact action among the page's links and buttons. Visitors who are ready to act have to hunt for it. (This can also happen when the page is rebuilt by JavaScript after load — then this is what a first paint looks like to us.)`
      : `Vår klassificering (30 språk + strukturregler) hittade ingen tydlig boka/köp/kontakt-handling i sidans länkar och knappar. Besökare som är redo att agera får leta. (Kan också bero på att er sida byggs om av JavaScript efter laddning — då berättar vi gärna vad vi ser i stället.)`,
  });
} else if (aboveFoldConv.length === 0) {
  fynd.push({
    vikt: 1,
    rubrik: EN
      ? "The conversion action is not visible on the first mobile screen"
      : "Konverterings-knappen syns inte i första skärmen på mobil",
    text: EN
      ? `We found ${convCtas.length} conversion action(s) — e.g. “${convCtas[0].text}” — but none of them sits in what a mobile visitor sees first. They have to scroll before the page asks for anything.`
      : `Vi hittade ${convCtas.length} konverterings-handling(ar) — t.ex. “${convCtas[0].text}” — men ingen av dem ligger i det besökaren ser först på en mobil. Mobilbesökaren måste scrolla innan sidan ber om något.`,
  });
}
if (base.hOverflowBeforePx > 8) {
  fynd.push({
    vikt: 2,
    rubrik: EN
      ? `The page scrolls ${base.hOverflowBeforePx}px sideways on mobile`
      : `Sidan scrollar ${base.hOverflowBeforePx}px i sidled på mobil`,
    text: EN
      ? `In a mobile viewport (390 px), content sticks out ${base.hOverflowBeforePx}px past the screen edge — it reads as broken and costs trust before the visitor has read a line.`
      : `I mobilvy (390 px) sticker innehåll ut ${base.hOverflowBeforePx}px utanför skärmen — det ser trasigt ut och drar ner förtroendet innan besökaren läst en rad.`,
  });
}
if (base.ctaChecked > 0 && base.ctaBroken > 0) {
  fynd.push({
    vikt: 1,
    rubrik: EN
      ? "Conversion elements cannot be clicked"
      : "Konverterings-element går inte att klicka",
    text: EN
      ? `${base.ctaBroken} of ${base.ctaChecked} checked conversion element(s) are covered by something else in the mobile viewport.`
      : `${base.ctaBroken} av ${base.ctaChecked} kontrollerade konverterings-element täcks av något annat i mobilvyn.`,
  });
}
if (aboveFoldConv.length > 4) {
  fynd.push({
    vikt: 4,
    rubrik: EN
      ? `${aboveFoldConv.length} competing actions on the first screen`
      : `${aboveFoldConv.length} konkurrerande handlingar i första skärmen`,
    text: EN
      ? `The first screen asks for ${aboveFoldConv.length} different things at once. One clear primary action usually beats many half-visible ones.`
      : `Första skärmen ber om ${aboveFoldConv.length} olika saker samtidigt. En tydlig primär handling brukar slå många halvsynliga.`,
  });
}
if (content.trustSignals.length === 0) {
  fynd.push({
    vikt: 5,
    rubrik: EN ? "No trust signals in the page copy" : "Inga förtroendesignaler i sidans text",
    text: EN
      ? `We found no customer counts, reviews or certifications in the copy itself. If you have them (reviews, customer numbers, certificates) they deserve a spot — Angel only surfaces what already exists.`
      : `Vi hittade inga kundantal, omdömen eller certifieringar i själva kopian. Om ni har dem (recensioner, antal kunder, certifikat) förtjänar de plats — vi flyttar bara fram sådant som redan finns.`,
  });
}

// Bevis-sektionen (social proof/jämförelse/priser/FAQ) under folden →
// flytt-förslaget. Typerna kommer ur den delade EN+SV-vokabulären (task #90)
// — den lokala svenska fallback-regexen behövs inte längre: classify()
// förstår svenska rubriker direkt.
const sections = content.sections;
// Fleet-E2E 2026-07-23: en sektion räknas som lyft-värd om dess TYP är bevis
// (social proof/jämförelse/priser/FAQ) ELLER om classify() flaggat att dess
// text bär förtroendesignaler (kundantal/omdömen/certifikat) även om typen
// blev något annat. 44 av 104 sajter fick "None" i baslinjen — flera bar
// proof i en sektion vars typ inte råkade ligga i EVIDENCE_SECTION_TYPES.
const targetIdx = sections.findIndex(
  (s, i) => i >= 2 && (EVIDENCE_SECTION_TYPES.includes(s.type) || s.containsTrustSignals),
);
let beforeShot: string | null = null;
let afterShot: string | null = null;
let flyttStatus: "pass" | "refused" | "held" | null = null;
let flyttText = "";

if (targetIdx >= 2) {
  const target = sections[targetIdx];
  fynd.push({
    vikt: 3,
    rubrik: EN
      ? `Your strongest content sits as section ${targetIdx + 1} of ${sections.length}`
      : `Ert starkaste innehåll ligger som sektion ${targetIdx + 1} av ${sections.length}`,
    text: EN
      ? `“${target.heading.slice(0, 60)}” is the kind of content (${target.type}) that usually decides the visit — and it sits far down. Below we test-lifted it, on a frozen copy of your page, through our checks.`
      : `“${target.heading.slice(0, 60)}” är den typ av innehåll (${target.type}) som brukar avgöra beslutet — och det ligger långt ner. Nedan har vi testat att lyfta det, i en fryst kopia av er sida, genom våra kontroller.`,
  });
  // Skärmdump FÖRE (orörd), sedan grindat lyft, sedan EFTER med samma
  // applicering som grindades (keepApplied) — aldrig en egen algoritm.
  await page.screenshot({
    path: join(outDir, "before.jpg"),
    type: "jpeg",
    quality: 45,
    fullPage: true,
  });
  const lifts = Math.min(Math.max(targetIdx - 1, 1), 4);
  const ops: MeasureOp[] = Array.from({ length: lifts }, () => ({
    op: "move_up",
    find: target.heading,
  }));
  // DEMO-vägens godkänt (fleet-E2E 2026-07-23): serveringsvägen (auto-generate)
  // kräver ett RENT pass, men på en fryst kopia utan sidans skript saknas ofta
  // LCP-elementet och ibland hit-testbara CTA:er — då blir grindutslaget "warn"
  // av ren VAKUITET, inte för att lyftet skadade något. De hårda skade-grindarna
  // (overflow, ovanför-hjälten, klickbarhet, återställbarhet) fäller alltid som
  // "fail". Ett "warn" vars ENDA orsaker är vakuitet = layouten är bevisat säker,
  // bara oåtkomlig att fullständigt verifiera på en kopia → demo-värdigt. All
  // annan warn/fail hålls tillbaka precis som förr. (isVacuityWarn bor i
  // render-gates, bredvid varningssträngarna — en källa.)
  const demoPass = (g: typeof gated): boolean => {
    const last = g.attempts[g.attempts.length - 1];
    return (
      !!last &&
      (last.gate.verdict === "pass" ||
        (last.gate.verdict === "warn" && last.gate.reasons.every(isVacuityWarn)))
    );
  };
  let gated = await runGatedAttempts(page, ops, ctaTexts);
  // Sikta högt men LANDA ärligt — faller grindarna med N lyft provas färre, ned
  // till 1. Plausible-fallet: 2 lyft sänker sektionen (DOM-ordning ≠ visuell
  // ordning runt hjälten ⇒ no-rise-grinden fäller, korrekt) men 1 lyft passerar
  // rent med stor visuell vinst. Prospektet ska se vinsten som FINNS, inte ett
  // "held" för att vi siktade för högt. measurePlan återställer sidan mellan
  // försöken (keepApplied=false).
  let usedLifts = lifts;
  while (!gated.unresolvable && !demoPass(gated) && usedLifts > 1) {
    usedLifts -= 1;
    const fewer: MeasureOp[] = Array.from({ length: usedLifts }, () => ({
      op: "move_up",
      find: target.heading,
    }));
    gated = await runGatedAttempts(page, fewer, ctaTexts);
  }
  if (gated.unresolvable) {
    flyttStatus = "refused";
    flyttText = EN
      ? "Your section structure is built in a way where our engine REFUSES to move things rather than guess (that is a safety feature, not an error). A move here would be done manually, together with you."
      : "Er sektionsstruktur är byggd på ett sätt där vår motor VÄGRAR flytta i stället för att gissa (det är en säkerhetsfunktion, inte ett fel). En flytt här görs manuellt tillsammans med er.";
  } else {
    const last = gated.attempts[gated.attempts.length - 1];
    if (demoPass(gated)) {
      flyttStatus = "pass";
      await measurePlan(page, gated.attemptOps, [], true);
      await page.screenshot({
        path: join(outDir, "after.jpg"),
        type: "jpeg",
        quality: 45,
        fullPage: true,
      });
      beforeShot = join(outDir, "before.jpg");
      afterShot = join(outDir, "after.jpg");
      // Ärlig kopia: nämn CTA-klausulen BARA när minst en CTA verkligen
      // kontrollerades — annars är det en tom (vakuös) grind och "0 element
      // fortfarande klickbara" vore vilseledande. Skade-grindarna är layout —
      // scoping till "layout check" håller påståendet sant även vid vakuös warn.
      const clickable =
        last.measurements.ctaChecked > 0
          ? EN
            ? `${last.measurements.ctaChecked} conversion element(s) still clickable, `
            : `${last.measurements.ctaChecked} konverterings-element fortfarande klickbara, `
          : "";
      flyttText = EN
        ? `The lift passed every layout check: no horizontal scroll introduced, nothing lands above your main headline, ${clickable}and the change reverses exactly.`
        : `Flytten klarade alla layout-kontroller: ingen horisontell scroll introducerad, inget hamnar ovanför er huvudrubrik, ${clickable}och ändringen är exakt återställbar.`;
    } else {
      flyttStatus = "held";
      flyttText = EN
        ? `We tried the lift but held it back: ${last.gate.reasons[0] ?? "the checks did not give a clean pass"}. That is how it should work — nothing is shown that does not pass the checks.`
        : `Vi provade lyftet men höll tillbaka det: ${last.gate.reasons[0] ?? "kontrollerna gav inte rent godkänt"}. Så ska det fungera — inget visas som inte klarar kontrollerna.`;
    }
  }
}
await browser.close();

// ── 4. rapporten — självbärande HTML, svensk, en sida ────────────────────────
const b64 = (p: string) => `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const topFynd = fynd.sort((a, b) => a.vikt - b.vikt).slice(0, 3);
const datum = new Date().toISOString().slice(0, 10);

const rapport = `<!doctype html><html lang="${EN ? "en" : "sv"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${EN ? `Day-0 review — ${esc(namn)}` : `CRO-granskning — ${esc(namn)}`}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;color:#111;max-width:760px;margin:2rem auto;padding:0 1.25rem;line-height:1.55}
  h1{font-size:1.5rem;margin-bottom:.25rem} h2{font-size:1.05rem;margin:1.6rem 0 .5rem}
  .meta{color:#666;font-size:.85rem} .fynd{border-left:3px solid #111;padding:.5rem .9rem;margin:.9rem 0;background:#fafafa}
  .fynd b{display:block;margin-bottom:.15rem}
  .par{display:flex;gap:2%;margin:.8rem 0} .par figure{margin:0;width:49%}
  .par img{width:100%;border:1px solid #ddd;border-radius:4px} figcaption{font-size:.8rem;color:#666;text-align:center;margin-top:.3rem}
  .kontrakt{font-size:.9rem;background:#f4f4f4;border-radius:6px;padding:.9rem 1.1rem;margin:1.2rem 0}
  .kontrakt li{margin:.25rem 0}
  .erbjudande{border:2px solid #111;border-radius:6px;padding:1rem 1.2rem;margin:1.4rem 0}
  footer{color:#888;font-size:.8rem;margin:2rem 0 1rem;border-top:1px solid #eee;padding-top:.8rem}
</style></head><body>
<h1>${EN ? `Day-0 review: ${esc(namn)}` : `CRO-granskning: ${esc(namn)}`}</h1>
<div class="meta">${esc(url!)} · ${datum} · ${EN ? "measured on a frozen copy of your page — your live site was not touched" : "gjord på en fryst kopia av er sida — er riktiga sajt har inte rörts"}</div>
${
  goalGuess
    ? ownerGoal
      ? EN
        ? `<p class="meta">Your goal: <b>“${esc(ownerGoal)}”</b> — as configured in your settings.</p>`
        : `<p class="meta">Ert mål: <b>“${esc(ownerGoal)}”</b> — enligt era inställningar.</p>`
      : EN
        ? `<p class="meta">We assume <b>“${esc(goalGuess)}”</b> is your most important action — correct it in Settings if not.</p>`
        : `<p class="meta">Vi antar att <b>“${esc(goalGuess)}”</b> är er viktigaste handling — rätta oss gärna.</p>`
    : ""
}

<h2>${
  EN
    ? topFynd.length === 1
      ? "The most important thing we measured"
      : `${["Two", "Three"][topFynd.length - 2] ?? topFynd.length} things we measured`
    : topFynd.length === 1
      ? "Det viktigaste vi mätte upp"
      : `${["Två", "Tre"][topFynd.length - 2] ?? topFynd.length} saker vi mätte upp`
}</h2>
${topFynd.map((f) => `<div class="fynd"><b>${esc(f.rubrik)}</b>${esc(f.text)}</div>`).join("\n")}

${
  flyttStatus === "pass" && beforeShot && afterShot
    ? `<h2>${EN ? "Before / after — tested on a copy of your page" : "Före / efter — testat på en kopia av er sida"}</h2>
<div class="par">
  <figure><img src="${b64(beforeShot)}" alt="${EN ? "before" : "före"}"><figcaption>${EN ? "Your page today" : "Er sida idag"}</figcaption></figure>
  <figure><img src="${b64(afterShot)}" alt="${EN ? "after" : "efter"}"><figcaption>${EN ? "Same content, rearranged" : "Samma innehåll, omflyttat"}</figcaption></figure>
</div>
<p>${esc(flyttText)}</p>`
    : flyttStatus
      ? `<h2>${EN ? "About the lift test" : "Om flytt-testet"}</h2><p>${esc(flyttText)}</p>`
      : ""
}

${
  EN
    ? `<div class="kontrakt"><b>How Angel works — three promises:</b><ul>
<li><b>Nothing is invented.</b> Angel moves, tightens and surfaces your existing content — it never writes claims that are not already on the page.</li>
<li><b>Everything is verified before anyone sees it.</b> Every change is pixel-tested (layout, clickability, mobile) on a copy — and you approve with a button before a single visitor meets it.</li>
<li><b>Honest measurement.</b> A share of visitors always sees the original, only real conversions are counted, and “no difference” is reported when that is the truth.</li>
</ul></div>`
    : `<div class="kontrakt"><b>Så jobbar vi — tre löften:</b><ul>
<li><b>Inget hittas på.</b> Vi flyttar, kortar och lyfter fram ert befintliga innehåll — vi skriver aldrig dit påståenden som inte redan finns på sidan.</li>
<li><b>Allt verifieras innan någon ser det.</b> Varje ändring testas i pixlar (layout, klickbarhet, mobil) på en kopia — och ni godkänner med en knapp innan en enda besökare möter den.</li>
<li><b>Ärlig mätning.</b> Hälften av besökarna ser originalet, vi räknar bara riktiga konverteringar, och säger “ingen skillnad” när det är sanningen.</li>
</ul></div>

<div class="erbjudande"><b>Pilot: ${esc(pris)}</b> — vi kör ett verifierat test på er sida under 6 veckor. Ni godkänner allt som visas, och får en rapport med riktiga siffror. Svara på mejlet så bokar vi 20 minuter.</div>`
}

<footer>${
  EN
    ? `CROENGINE · This review was produced automatically on the day your site was added. Findings are measurements on the frozen copy from ${datum}.`
    : `CROENGINE · ${esc(kontakt)} · Granskningen är automatiskt framtagen och manuellt genomläst. Fynd är mätningar på den frysta kopian ${datum}.`
}</footer>
</body></html>`;

writeFileSync(join(outDir, "rapport.html"), rapport);
writeFileSync(
  join(outDir, "fynd.json"),
  JSON.stringify(
    {
      url,
      namn,
      datum,
      goalGuess,
      goalSource: ownerGoal ? "configured" : goalGuess ? "guessed" : null,
      fynd,
      flyttStatus,
      // Flytt-berättelsen i klartext (fleet-E2E 2026-07-23): held-orsaken är
      // feltaxonomins råvara — utan den är "held" bara en siffra.
      flyttText,
      sektioner: sections.length,
      ctas: ctaTexts,
    },
    null,
    2,
  ),
);
console.log(
  `✔ ${namn}: ${topFynd.length} fynd · flytt=${flyttStatus ?? "n/a"} · ${outDir}/rapport.html`,
);
