// GRÄNSSNITTET nattloopen ↔ verify: plans.json skrivs av en process och läses
// av en annan, som `as PlanIn[]` utan körtidsvalidering. tsc ser ingenting av
// det (scripts/ ligger utanför app-tsconfigen, och plans-arrayen är unknown[]),
// så ett fältnamn som glider isär hade tyst tappat katalogens reserver eller
// varje variants härkomst — medan loopen fortsatte rapportera VERIFIED.
// Granskningsfynd 2026-08-08: den serverade vägens sömm hade noll test.
//
// Det här testet kör den RIKTIGA verify-processen (bun + riktig Chromium, samma
// kommandorad nattloopen bygger) mot en fryst fixtur och läser dess rapport:
//   1. planSource överlever gränsen (provenansen ägaren ser i dashboarden),
//   2. altOps överlever gränsen OCH används när huvudvalet faller i
//      valideringen (reserv-stegen — förut dog cellen tyst där),
//   3. serve_ops bär exakt de ops som grindades.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright-core";

import { planRow } from "../../loop/cell-plan";

import type { RedesignOp } from "../../../src/adaptive/redesign/generate";

const REPO = join(import.meta.dirname, "..", "..", "..");

// Samma probe/skip-mönster som repots övriga browser-tester (applier,
// section-observe, snapshot): utan chromium hoppas testet över i stället för
// att fälla sviten på en maskin som saknar browsern. CI installerar den.
let chromiumAvailable = false;
beforeAll(async () => {
  try {
    const b = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
    await b.close();
    chromiumAvailable = true;
  } catch {
    chromiumAvailable = false;
  }
});

/** Fryst fixtur: hjälte + tre sektioner, gott om luft så en flytt inte
 *  kolliderar (grindarna är inte det som testas här — gränssnittet är det). */
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Boundary fixture</title><style>
  body{margin:0;font-family:system-ui}
  section{padding:32px 20px;min-height:320px}
  h1{font-size:30px;margin:0 0 12px}h2{font-size:22px;margin:0 0 12px}
  p{margin:0 0 10px;line-height:1.6}
  .cta{display:inline-block;padding:12px 22px;background:#111;color:#fff;text-decoration:none}
</style></head><body><main>
<section id="s1"><h1>Run your marketing on autopilot</h1>
<p>${"Hero body copy. ".repeat(20)}</p>
<a class="cta" href="/signup">Start free trial</a></section>
<section id="s2"><h2>How the platform works</h2><p>${"Feature copy. ".repeat(50)}</p></section>
<section id="s3"><h2>Loved by more than 4000 teams</h2><p>${"Customer quote. ".repeat(50)}</p></section>
<section id="s4"><h2>Simple honest pricing</h2><p>${"Pricing copy. ".repeat(50)}</p></section>
</main></body></html>`;

interface VerifyRow {
  verdict: string;
  path: string;
  key: string;
  ops?: { op: string; targetId: string }[];
  serveOps?: { op: string; locator?: { tag?: string; text?: string }; why?: string }[];
  evidence?: Record<string, unknown>;
  planSource?: string;
  reason?: string;
}

function runVerify(plans: unknown[], extraPages: Record<string, string> = {}): VerifyRow[] {
  const dir = mkdtempSync(join(tmpdir(), "verify-boundary-"));
  const frozen = join(dir, "home.html");
  writeFileSync(frozen, HTML);
  const pages: Record<string, string> = { "/": frozen };
  // Extra frysta sidor (återbrukets källsidor): path → html-innehåll.
  let n = 0;
  for (const [p, html] of Object.entries(extraPages)) {
    const f = join(dir, `extra-${n++}.html`);
    writeFileSync(f, html);
    pages[p] = f;
  }
  writeFileSync(join(dir, "pages.json"), JSON.stringify(pages));
  writeFileSync(join(dir, "plans.json"), JSON.stringify(plans));
  const run = spawnSync(
    "bun",
    [
      "run",
      "scripts/redesign/auto-generate.ts",
      "--mode=verify",
      `--plans=${join(dir, "plans.json")}`,
      `--pages=${join(dir, "pages.json")}`,
      "--site=boundary-test",
      "--base-url=https://example.invalid",
      `--out=${dir}`,
    ],
    {
      cwd: REPO,
      encoding: "utf8",
      timeout: 180_000,
      // Ingen LLM i verify-läget: designern är en stubb som ekar planens ops,
      // och berikningslagren är fail-open utan nyckel. Nyckeln tas bort så
      // testet är deterministiskt även på en maskin som har en.
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    },
  );
  if (run.status !== 0) {
    throw new Error(
      `verify föll (exit ${run.status}): ${(run.stderr || "").slice(-2000)}\n${(run.stdout || "").slice(-2000)}`,
    );
  }
  return JSON.parse(readFileSync(join(dir, "verify-report.json"), "utf8")) as VerifyRow[];
}

const basePlan = {
  path: "/",
  // Mobil-pinnad nyckel ⇒ EN viewport att grinda (snabbare, samma kodväg).
  key: "google·mobile",
  total: { visits: 4000, conversions: 120 },
  observations: ["Testfixtur — ingen riktig besöksdata."],
  sourcePaths: [],
};

const moveOp = (targetId: string): RedesignOp => ({
  op: "move_up",
  targetId,
  detail: "",
  why: "proof closer to the decision",
});

describe("plans.json → verify (riktig process, riktig Chromium)", () => {
  it("planSource och altOps överlever gränsen; reserven räddar ett valideringsavslag", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Raderna byggs av nattloopens EGEN producent — glider planRow och
    // PlanIn isär faller det här testet, inte produktionen en natt i tysthet.
    const rows = runVerify([
      // 1) Vanlig katalogplan: härkomsten ska ekas tillbaka oförändrad.
      planRow({
        ...basePlan,
        ops: [moveOp("sec-4-pricing")],
        altOps: [[moveOp("sec-3-testimonials")]],
        planSource: "katalog/selector",
      }),
      // 2) Huvudvalet pekar på ett sektions-id som INTE finns (samma form som
      //    när verify validerar mot en berikad modell där katalogens id
      //    skrivits om) ⇒ valideringen fäller det ⇒ reserven ska ta över.
      planRow({
        ...basePlan,
        key: "direkt·mobile",
        ops: [moveOp("sec-9-finns-inte")],
        altOps: [[moveOp("sec-4-pricing")]],
        planSource: "katalog/floor",
      }),
    ]);

    expect(rows).toHaveLength(2);

    const [main, recovered] = rows;
    // 1) Provenansen är kvar hela vägen ut i resultatet.
    expect(main.verdict).toBe("verified");
    expect(main.planSource).toBe("katalog/selector");
    expect(main.ops?.map((o) => o.targetId)).toEqual(["sec-4-pricing"]);
    // serve_ops är det KLIENTEN kommer att applicera. Antalsjämförelsen mot
    // ops var vakuös (granskningsfynd 2026-08-08: båda härleds ur samma
    // lista, så likheten höll även om lokatorn pekat fel). Kontraktet är
    // EXAKT form: rätt verb, rätt tagg och rätt rubriktext — sektionen som
    // faktiskt grindades, inte någon annan på sidan.
    expect(main.serveOps).toEqual([
      {
        op: "move_up",
        locator: { tag: "h2", text: "Simple honest pricing" },
        why: "proof closer to the decision",
      },
    ]);

    // 2) Reserven räddade cellen — förut blev den rejected_by_validation och
    //    natten gav ingenting för den cellen.
    expect(recovered.verdict).toBe("verified");
    expect(recovered.planSource).toBe("katalog/floor");
    expect(recovered.ops?.map((o) => o.targetId)).toEqual(["sec-4-pricing"]);
    // Reservens lokator — INTE huvudvalets (som pekade på en sektion som
    // inte finns): serve-vägen bär den plan som faktiskt grindades.
    expect(recovered.serveOps).toEqual([
      {
        op: "move_up",
        locator: { tag: "h2", text: "Simple honest pricing" },
        why: "proof closer to the decision",
      },
    ]);
    expect(recovered.evidence?.validationRecovery).toBe("alt:1");
    // Återhämtningen syns även på RADEN, inte bara i evidence — annars är
    // den osynlig i just de fall cellen sedan faller i grinden.
    expect((recovered as unknown as { validationRecovery?: string }).validationRecovery).toBe(
      "alt:1",
    );
  }, 240_000);

  it("utan reserv är ett valideringsavslag fortfarande ett ÄRLIGT nej", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const rows = runVerify([
      planRow({ ...basePlan, ops: [moveOp("sec-9-finns-inte")], planSource: "katalog/floor" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("rejected_by_validation");
    expect(rows[0].reason).toBeTruthy();
  }, 240_000);

  it("evidence.reuse skrivs när blocket överlever — och ALDRIG när fallbacken bytte bort det", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Källsidan vars frysta whitelist validerar citatet (extractQuotables:
    // en löv-rad med pris). Texten nedan är EXAKT whitelist-raden.
    const QUOTE = "Från 299 kr per månad – avsluta när du vill";
    const PRISER_HTML = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>Priser</title></head><body><main>
<section><h1>Våra priser</h1><p>${QUOTE}</p><p>${"Prisdetaljer. ".repeat(30)}</p></section>
<section><h2>Vanliga frågor</h2><p>${"Svar. ".repeat(40)}</p></section>
</main></body></html>`;
    const offer = {
      variantId: "11111111-aaaa-bbbb-cccc-000000000001",
      provedOnPath: "/enterprise",
      sourcePath: "/priser",
      text: QUOTE,
    };
    const reuseInsert: RedesignOp = {
      op: "insert_snippet",
      targetId: "hero",
      detail: QUOTE,
      sourcePath: "/priser",
      why: "proven block reused",
    };
    const rows = runVerify(
      [
        // 1) Återbruket ÄR huvudvalet och överlever grinden ⇒ proveniens.
        planRow({
          ...basePlan,
          ops: [reuseInsert],
          planSource: "katalog/selector",
          reuseOffers: [offer],
        }),
        // 2) Huvudvalet faller i valideringen, reserven (en flytt) tar
        //    över ⇒ blocket bärs INTE av finalOps ⇒ INGEN proveniens —
        //    en proof-etikett på en variant utan blocket vore en lögn.
        planRow({
          ...basePlan,
          key: "direkt·mobile",
          ops: [moveOp("sec-9-finns-inte")],
          altOps: [[moveOp("sec-4-pricing")]],
          planSource: "katalog/selector",
          reuseOffers: [offer],
        }),
      ],
      { "/priser": PRISER_HTML },
    );
    expect(rows).toHaveLength(2);
    const [survived, swapped] = rows;
    expect(survived.verdict).toBe("verified");
    expect(survived.evidence?.reuse).toEqual({
      variantId: offer.variantId,
      provedOnPath: "/enterprise",
    });
    // Driftsvepets kontrakt följer med gratis: beroendet deklarerat.
    expect(survived.evidence?.dependencies).toEqual([{ path: "/priser", textSnapshot: QUOTE }]);
    expect(swapped.verdict).toBe("verified");
    expect(swapped.ops?.map((o) => o.targetId)).toEqual(["sec-4-pricing"]);
    expect(swapped.evidence?.reuse).toBeUndefined();
  }, 240_000);
});
