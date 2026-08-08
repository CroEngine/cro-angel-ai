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
}

/** Minimal query-builder-stub: fångar filtren, resolvar med givna rader. */
function stubDb(rows: unknown[], error: unknown = null): { db: SupabaseClient; q: CapturedQuery } {
  const q: CapturedQuery = { eqs: {}, gte: null, limit: null };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      q.eqs[col] = val;
      return builder;
    },
    gte: (col: string, val: string) => {
      q.gte = { column: col, value: val };
      return builder;
    },
    order: () => builder,
    limit: (n: number) => {
      q.limit = n;
      return Promise.resolve({ data: error ? null : rows, error });
    },
  };
  const db = { from: () => builder } as unknown as SupabaseClient;
  return { db, q };
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
