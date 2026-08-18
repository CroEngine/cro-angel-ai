// Låser att de publika räknarna speglar SERVERINGSVÄGENS villkor
// (granskningsfynd 2026-08-18), inte bara status-kolumnen:
//   - hållna varianter (held_reason satt) räknas aldrig — vaktsvepet höll dem
//     för att skada/drift upptäcktes; "mäts just nu" vore lögn
//   - "serving" räknas bara på sajter med serving_enabled=true
//   - previews räknar DISTINKTA adresser, inte jobbrader
// Falsk supabase-klient som spelar in filterkedjan och svarar per tabell —
// samma mock-söm (client.server) som rutt-testerna använder.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  table: string;
  select: string;
  filters: [string, ...unknown[]][];
}

type Responder = (q: Captured) => {
  count?: number | null;
  data?: unknown;
  error?: { message: string } | null;
};

let respond: Responder = () => ({ count: 0, data: [], error: null });
const queries: Captured[] = [];

function makeBuilder(table: string) {
  const cap: Captured = { table, select: "", filters: [] };
  const builder: Record<string, unknown> = {};
  const chain =
    (name: string) =>
    (...args: unknown[]) => {
      if (name === "select") cap.select = String(args[0]);
      else cap.filters.push([name, ...args]);
      return builder;
    };
  for (const m of ["select", "eq", "neq", "is", "in", "order", "limit"]) {
    builder[m] = chain(m);
  }
  const resolve = () => {
    queries.push(cap);
    const r = respond(cap);
    return { count: r.count ?? null, data: r.data ?? null, error: r.error ?? null };
  };
  builder.maybeSingle = () => Promise.resolve(resolve());
  // head:true-räknare awaitas direkt på buildern ⇒ thenable.
  builder.then = (onOk: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onOk);
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

import { fetchPublicStats } from "../stats.server";

const filtersFor = (table: string, status: string) =>
  queries.find((q) => q.table === table && q.filters.some((f) => f[0] === "eq" && f[2] === status))
    ?.filters;

describe("fetchPublicStats — räknarna speglar serveringsvägen", () => {
  beforeEach(() => {
    queries.length = 0;
    respond = () => ({ count: 0, data: [], error: null });
  });

  it("varje variant-räknare kräver held_reason null (hållna räknas aldrig)", async () => {
    respond = (q) =>
      q.table === "angel_sites"
        ? { data: [{ slug: "kund" }] }
        : { count: 0, data: [], error: null };
    await fetchPublicStats();
    for (const status of ["verified", "serving", "winner"]) {
      const f = filtersFor("angel_variants", status);
      expect(f, `filter för ${status}`).toBeDefined();
      expect(f).toContainEqual(["is", "held_reason", null]);
    }
  });

  it("'serving' räknas bara på serving_enabled-sajter (in-listan), labbet borträknat", async () => {
    respond = (q) =>
      q.table === "angel_sites"
        ? { data: [{ slug: "kund" }, { slug: "synthetic-lab" }] }
        : { count: 3, data: [], error: null };
    const stats = await fetchPublicStats();
    const f = filtersFor("angel_variants", "serving");
    expect(f).toContainEqual(["in", "site", ["kund"]]);
    expect(stats.measuringNow).toBe(3);
  });

  it("inga serving-sajter ⇒ measuringNow 0 UTAN variantfråga", async () => {
    respond = (q) =>
      q.table === "angel_sites" ? { data: [] } : { count: 7, data: [], error: null };
    const stats = await fetchPublicStats();
    expect(stats.measuringNow).toBe(0);
    expect(filtersFor("angel_variants", "serving")).toBeUndefined();
  });

  it("previews räknar distinkta adresser, inte jobbrader", async () => {
    respond = (q) => {
      if (q.table === "angel_sites") return { data: [] };
      if (q.table === "angel_preview_jobs")
        return {
          data: [{ url: "https://a.se/" }, { url: "https://a.se/" }, { url: "https://b.se/" }],
        };
      return { count: 0, data: [], error: null };
    };
    const stats = await fetchPublicStats();
    expect(stats.previewsBuilt).toBe(2);
  });

  it("fel i en fråga kastar — hellre 503 än halva siffror", async () => {
    respond = (q) =>
      q.table === "angel_sites"
        ? { data: [{ slug: "kund" }] }
        : { count: null, data: null, error: { message: "db borta" } };
    await expect(fetchPublicStats()).rejects.toThrow();
  });
});
