// Steg 10-hämtaren: db-vägen som matar sätet. Stubbat Supabase-objekt —
// grindarna som INTE kan ligga i de rena modulerna bor här: simulated-
// exkluderingen, skrubbade path-jämförelsen (läs == skriv), färskhets-
// fönstret och null-vägarna (granskningsfynd 2026-08-08: filen saknade
// test helt trots tre hårda kontrakt).
import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchSectionBehavior } from "../section-behavior";

interface CapturedQuery {
  eqs: Record<string, unknown>;
  gte: { column: string; value: string } | null;
  limit: number | null;
  or: string | null;
}

/** Minimal query-builder-stub: fångar filtren, resolvar med givna rader.
 *  Två frågor kan ställas per anrop — census-strömmen (type=section_engagement)
 *  och arm-stängslets exponerings-uppslag (type=adaptation_shown); stubben
 *  svarar per type så bägge kontrakten kan testas i samma körning. */
function stubDb(
  rows: unknown[],
  error: unknown = null,
  exposures: { rows?: unknown[]; error?: unknown; count?: number } = {},
): { db: SupabaseClient; q: CapturedQuery; exposureIds: string[][] } {
  const q: CapturedQuery = { eqs: {}, gte: null, limit: null, or: null };
  const exposureIds: string[][] = [];
  const makeBuilder = () => {
    const state: { type?: string; ins: string[] } = { ins: [] };
    const builder: Record<string, unknown> = {
      select: () => builder,
      or: (expr: string) => {
        if (state.type !== "adaptation_shown") q.or = expr;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        if (col === "type") state.type = String(val);
        // Census-frågans filter är de som testas; exponerings-uppslaget har
        // sina egna och ska inte skriva över dem.
        if (state.type !== "adaptation_shown") q.eqs[col] = val;
        return builder;
      },
      gte: (col: string, val: string) => {
        if (state.type !== "adaptation_shown") q.gte = { column: col, value: val };
        return builder;
      },
      in: (_col: string, vals: string[]) => {
        state.ins = vals;
        exposureIds.push(vals);
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        if (state.type === "adaptation_shown") {
          const err = exposures.error ?? null;
          const exRows = exposures.rows ?? [];
          return Promise.resolve({
            data: err ? null : exRows,
            error: err,
            // Serverns facit: default = precis så många som returnerades
            // (inget bortfall); testet kan sätta ett HÖGRE count för att
            // simulera ett serverradtak.
            count: exposures.count ?? exRows.length,
          });
        }
        q.limit = n;
        return Promise.resolve({ data: error ? null : rows, error });
      },
    };
    return builder;
  };
  const db = { from: () => makeBuilder() } as unknown as SupabaseClient;
  return { db, q, exposureIds };
}

const SECTIONS = [
  { id: "sec-2-pricing", type: "pricing", heading: "Simple honest pricing" },
  { id: "sec-3-testimonials", type: "testimonials", heading: "Loved by teams" },
];

const row = (over: Record<string, unknown> = {}) => ({
  payload: {
    path: "/artikel/[redacted]",
    sections: [
      { h: "Simple honest pricing", n: 1, d: 2000 },
      { h: "Loved by teams", n: 1, d: 0 },
    ],
    ...over,
  },
});

describe("fetchSectionBehavior", () => {
  it("jämför med SKRUBBAD path (läs == skriv) och filtrerar i SQL + färskhet", async () => {
    const rows = Array.from({ length: 1100 }, () => row());
    const { db, q } = stubDb(rows);
    // Rå sid-path med id — skriv-sidan lagrar "/artikel/[redacted]".
    const r = await fetchSectionBehavior(db, "acme", "/artikel/12345678", SECTIONS);
    expect(q.eqs["payload->>path"]).toBe("/artikel/[redacted]");
    expect(q.eqs["site"]).toBe("acme");
    expect(q.eqs["type"]).toBe("section_engagement");
    // Färskhetsfönstret: ~30 dagar bakåt.
    expect(q.gte?.column).toBe("created_at");
    const ageDays = (Date.now() - Date.parse(q.gte!.value)) / 86400000;
    expect(ageDays).toBeGreaterThan(29);
    expect(ageDays).toBeLessThan(31);
    // Lyckad väg: vikter på rätt id.
    expect(r).not.toBeNull();
    expect(r!.sectionWeight["sec-2-pricing"]).toBeCloseTo(1, 10);
    expect(r!.sectionWeight["sec-3-testimonials"]).toBeCloseTo(0, 10);
  });

  it("simulerade demo-rader exkluderas — syntetiska besök blir aldrig vikter", async () => {
    // 1100 riktiga + 5000 simulerade med skev signal: svaret får bara spegla
    // de riktiga (utan filtret hade de simulerade dominerat).
    const rows = [
      ...Array.from({ length: 5000 }, () =>
        row({
          simulated: true,
          sections: [
            { h: "Simple honest pricing", n: 1, d: 0 },
            { h: "Loved by teams", n: 1, d: 9000 },
          ],
        }),
      ),
      ...Array.from({ length: 1100 }, () => row()),
    ];
    const { db } = stubDb(rows);
    const r = await fetchSectionBehavior(db, "acme", "/artikel/12345678", SECTIONS);
    expect(r).not.toBeNull();
    expect(r!.sectionWeight["sec-2-pricing"]).toBeCloseTo(1, 10);
    expect(r!.sectionWeight["sec-3-testimonials"]).toBeCloseTo(0, 10);
  });

  it("ARM-MARKÖREN filtreras i SQL och respekteras även om filtret skulle glida", async () => {
    // Nya census-rader bär payload.adapted (0/1) — en exakt per-laddnings-
    // sanning. SQL-filtret ska be om de omarkerade + 0:orna, och en 1:a som
    // ändå kom med (glidande filter) ska ändå aldrig forma vikterna.
    const rows = [
      ...Array.from({ length: 4000 }, () => ({
        ...row({
          adapted: 1,
          sections: [
            { h: "Simple honest pricing", n: 1, d: 0 },
            { h: "Loved by teams", n: 1, d: 9000 },
          ],
        }),
        decision_id: "dec-any",
      })),
      ...Array.from({ length: 1100 }, () => ({ ...row({ adapted: 0 }), decision_id: "dec-any" })),
    ];
    const { db, q, exposureIds } = stubDb(rows);
    const r = await fetchSectionBehavior(db, "acme", "/artikel/12345678", SECTIONS);
    expect(q.or).toBe("payload->>adapted.is.null,payload->>adapted.eq.0");
    // Markerade rader behöver INGET decisionId-uppslag — det trubbiga
    // stängslet gäller bara den gamla svansen.
    expect(exposureIds).toEqual([]);
    expect(r).not.toBeNull();
    expect(r!.sectionWeight["sec-2-pricing"]).toBeCloseTo(1, 10);
    expect(r!.sectionWeight["sec-3-testimonials"]).toBeCloseTo(0, 10);
  });

  it("ARM-STÄNGSLET (äldre events utan markör): laddningar där varianten VISADES blir aldrig beteendevikter", async () => {
    // Den självförstärkande klassen (granskningsfynd 2026-08-08): en serverad
    // move_up lyfter testimonials ovanför folden ⇒ dwell stiger ⇒ nästa natt
    // rankar sätet samma sektion högst och menyraden påstår att BESÖKARNA
    // gjorde det. Här bär de exponerade raderna motsatt signal mot de
    // organiska; utan stängslet vinner vår egen omflyttning.
    const exposedRow = row({
      sections: [
        { h: "Simple honest pricing", n: 1, d: 0 },
        { h: "Loved by teams", n: 1, d: 9000 },
      ],
    });
    const rows = [
      ...Array.from({ length: 4000 }, () => ({ ...exposedRow, decision_id: "dec-exposed" })),
      ...Array.from({ length: 1100 }, () => ({ ...row(), decision_id: "dec-organic" })),
    ];
    const { db, exposureIds } = stubDb(rows, null, {
      rows: [{ decision_id: "dec-exposed" }],
    });
    const r = await fetchSectionBehavior(db, "acme", "/artikel/12345678", SECTIONS);
    // Uppslaget frågade på de distinkta id:n census-raderna bar.
    expect(exposureIds[0]).toEqual(["dec-exposed", "dec-organic"]);
    expect(r).not.toBeNull();
    // Bara de organiska raderna formade vikterna.
    expect(r!.sectionWeight["sec-2-pricing"]).toBeCloseTo(1, 10);
    expect(r!.sectionWeight["sec-3-testimonials"]).toBeCloseTo(0, 10);
  });

  it("stängslet måste kunna BEVISAS: exponerings-uppslaget faller ⇒ null (aldrig oprövad vikt)", async () => {
    const rows = Array.from({ length: 1100 }, () => ({ ...row(), decision_id: "dec-1" }));
    expect(
      await fetchSectionBehavior(
        stubDb(rows, null, { error: { message: "exposure lookup down" } }).db,
        "acme",
        "/artikel/12345678",
        SECTIONS,
      ),
    ).toBeNull();
    // Inga exponeringar alls ⇒ hela strömmen är organisk och svaret står kvar.
    const ok = await fetchSectionBehavior(
      stubDb(rows, null, { rows: [] }).db,
      "acme",
      "/artikel/12345678",
      SECTIONS,
    );
    expect(ok).not.toBeNull();
    expect(ok!.sectionWeight["sec-2-pricing"]).toBeCloseTo(1, 10);
  });

  it("serverns radtak (count > returnerade rader) stängslar HELA satsen", async () => {
    // Granskningsfynd 2026-08-08: trunkering mättes mot VÅR limit, så ett
    // server-radtak (PostgREST db-max-rows) hade gjort stängslet tyst
    // ofullständigt. Nu jämförs mot serverns eget count.
    const rows = Array.from({ length: 1100 }, () => ({ ...row(), decision_id: "dec-a" }));
    const r = await fetchSectionBehavior(
      // Servern svarar med EN rad men säger att det finns 9 999 ⇒ bortfall ⇒
      // hela satsen (inkl. "dec-a") stängslas ⇒ inget underlag kvar.
      stubDb(rows, null, { rows: [{ decision_id: "dec-b" }], count: 9999 }).db,
      "acme",
      "/artikel/12345678",
      SECTIONS,
    );
    expect(r).toBeNull();
  });

  it("stängslet kan tömma underlaget — då är svaret null, inte en tunn gissning", async () => {
    const rows = Array.from({ length: 1100 }, () => ({ ...row(), decision_id: "dec-exposed" }));
    const r = await fetchSectionBehavior(
      stubDb(rows, null, { rows: [{ decision_id: "dec-exposed" }] }).db,
      "acme",
      "/artikel/12345678",
      SECTIONS,
    );
    expect(r).toBeNull();
  });

  it("null-vägarna: db-fel ⇒ null, tunn data ⇒ null, tom ström ⇒ null", async () => {
    expect(
      await fetchSectionBehavior(stubDb([], { message: "boom" }).db, "acme", "/", SECTIONS),
    ).toBeNull();
    expect(
      await fetchSectionBehavior(
        stubDb(Array.from({ length: 50 }, () => row({ path: "/" }))).db,
        "acme",
        "/",
        SECTIONS,
      ),
    ).toBeNull(); // 50 laddningar < golvet
    expect(await fetchSectionBehavior(stubDb([]).db, "acme", "/", SECTIONS)).toBeNull();
  });
});
