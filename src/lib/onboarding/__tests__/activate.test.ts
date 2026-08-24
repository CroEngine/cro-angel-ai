// Aktiveringens kärna mot falsk supabase-klient (husets mock-söm, samma som
// stats.server-testet). Låser reglerna som speglar createSite:
//   - domän tagen av ANNAN slug ⇒ vägra (domänen är unik över alla sajter)
//   - slug ägd av annan användare ⇒ vägra (admin får adoptera)
//   - befintlig rad behåller sin nyckel (en nyklad rad 403:ar live-installen)
//   - ny rad stämplas created_from = "preview:<jobId>" (trattens härkomst)
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  table: string;
  op: "select" | "insert" | "upsert";
  filters: [string, ...unknown[]][];
  row?: Record<string, unknown>;
}

type Responder = (q: Captured) => { data?: unknown; error?: { message: string } | null };

let respond: Responder = () => ({ data: null, error: null });
const queries: Captured[] = [];

function makeBuilder(table: string) {
  const cap: Captured = { table, op: "select", filters: [] };
  const builder: Record<string, unknown> = {};
  const chain =
    (name: string) =>
    (...args: unknown[]) => {
      cap.filters.push([name, ...args]);
      return builder;
    };
  for (const m of ["select", "eq", "neq", "ilike"]) builder[m] = chain(m);
  const resolve = () => {
    queries.push(cap);
    const r = respond(cap);
    return { data: r.data ?? null, error: r.error ?? null };
  };
  builder.maybeSingle = () => Promise.resolve(resolve());
  builder.then = (onOk: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onOk);
  builder.insert = (row: Record<string, unknown>) => {
    cap.op = "insert";
    cap.row = row;
    return Promise.resolve(resolve());
  };
  builder.upsert = (row: Record<string, unknown>) => {
    cap.op = "upsert";
    cap.row = row;
    return Promise.resolve(resolve());
  };
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

import { performActivation } from "../activate.server";

const JOB = "3c9638e9-07d6-4a01-b012-c8cbfcce8a93";
const USER = { userId: "user-1", isAdmin: false };

/** Standardvärld: jobb finns, domän fri, inga medlemmar, ingen rad. */
const world =
  (over: Partial<Record<string, (q: Captured) => unknown>> = {}): Responder =>
  (q) => {
    const key = `${q.table}:${q.op}`;
    if (over[key]) return { data: over[key]!(q), error: null };
    if (q.table === "angel_preview_jobs") return { data: { url: "https://kund.se/" } };
    return { data: null, error: null };
  };

describe("performActivation — demo-jobb → sajt", () => {
  beforeEach(() => {
    queries.length = 0;
    respond = world();
  });

  it("lycklig väg: sajt skapas med härledd domän, nyckel och preview-härkomst", async () => {
    const r = await performActivation(USER, JOB);
    expect(r.ok).toBe(true);
    expect(r.slug).toBe("kund.se");
    expect(r.domain).toBe("kund.se");
    expect(r.ingestKey).toMatch(/^ak_/);
    const insert = queries.find((q) => q.table === "angel_sites" && q.op === "insert");
    expect(insert?.row).toMatchObject({
      slug: "kund.se",
      domain: "kund.se",
      billing_status: "none",
      created_from: `preview:${JOB}`,
    });
    const member = queries.find((q) => q.table === "angel_site_members" && q.op === "upsert");
    expect(member?.row).toMatchObject({ user_id: "user-1", site_slug: "kund.se" });
  });

  it("jobbet saknas ⇒ job_not_found, inget skapas", async () => {
    respond = (q) =>
      q.table === "angel_preview_jobs" ? { data: null } : { data: null, error: null };
    const r = await performActivation(USER, JOB);
    expect(r).toMatchObject({ ok: false, reason: "job_not_found" });
    expect(queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("domänen registrerad på annan slug ⇒ domain_taken", async () => {
    respond = world({
      "angel_sites:select": (q) =>
        q.filters.some((f) => f[0] === "ilike") ? { slug: "annan" } : null,
    });
    const r = await performActivation(USER, JOB);
    expect(r).toMatchObject({ ok: false, reason: "domain_taken" });
  });

  it("slug ägd av annan användare ⇒ taken — men admin får adoptera", async () => {
    respond = world({ "angel_site_members:select": () => [{ user_id: "annan-anvandare" }] });
    expect(await performActivation(USER, JOB)).toMatchObject({ ok: false, reason: "taken" });

    queries.length = 0;
    respond = world({ "angel_site_members:select": () => [{ user_id: "annan-anvandare" }] });
    const admin = await performActivation({ userId: "admin-1", isAdmin: true }, JOB);
    expect(admin.ok).toBe(true);
  });

  it("domänen pekar på anroparens EGEN andra slug ⇒ adoptera den, vägra inte", async () => {
    // Granskningsfynd 2026-08-19: ägaren skapade 'kund' manuellt med domänen
    // kund.se, kör sedan demon och aktiverar — domain_taken mot sig själv
    // vore en vilseledande återvändsgränd. Aktiveringsvägen adopterar.
    respond = world({
      "angel_sites:select": (q) =>
        q.filters.some((f) => f[0] === "ilike") ? { slug: "kund" } : { ingest_key: "ak_gammal" },
      "angel_site_members:select": () => [{ user_id: "user-1" }],
    });
    const r = await performActivation(USER, JOB);
    expect(r.ok).toBe(true);
    expect(r.slug).toBe("kund");
    expect(r.ingestKey).toBe("ak_gammal");
    expect(queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("befintlig rad ⇒ ingen insert, nyckeln lämnas orörd", async () => {
    respond = world({
      "angel_sites:select": (q) =>
        q.filters.some((f) => f[0] === "ilike") ? null : { ingest_key: "ak_gammal" },
    });
    const r = await performActivation(USER, JOB);
    expect(r.ok).toBe(true);
    expect(r.ingestKey).toBe("ak_gammal");
    expect(queries.some((q) => q.op === "insert")).toBe(false);
  });
});
