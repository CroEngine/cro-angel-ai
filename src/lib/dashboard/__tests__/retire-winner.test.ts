// Enhetstest för retireWinner (granskningsfynd 2026-08-13): winner→retired
// skrev tidigare tillbaka HELA evidence-objektet (läst före skrivningen) med
// wasWinner tillagt — det optimistiska .eq(status)-låset skyddade bara status,
// så en SAMTIDIG nattloop-skrivning av evidence.comparison klobbrades tyst.
// Fixen: en atomisk RPC (angel_retire_winner) som gör `evidence || wasWinner`
// server-sidigt. Testet pinnar att vägen (a) anropar RPC:n med rätt args,
// (b) ALDRIG rör en evidence-blob-update, (c) tolkar false som no-op och fel
// som write failed.
import { describe, expect, it, vi } from "vitest";

import { retireWinner } from "../dashboard.functions";

describe("retireWinner — atomisk winner→retired utan evidence-klobbring", () => {
  it("anropar angel_retire_winner-RPC:n med site + variant (aldrig en blob-update)", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    // .from finns med bara för att bevisa att den ALDRIG rörs på denna väg —
    // en anropad from() vore just den läs-modifiera-skriv-vägen fixen tog bort.
    const from = vi.fn(() => {
      throw new Error("retireWinner får inte skriva evidence via .from().update()");
    });
    const res = await retireWinner(
      { rpc, from } as never,
      "kund",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("angel_retire_winner", {
      p_site: "kund",
      p_variant: "11111111-1111-1111-1111-111111111111",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("RPC returnerar false (raden var inte längre winner) ⇒ no-op, illegal transition", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const res = await retireWinner({ rpc } as never, "kund", "v1");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("illegal transition");
  });

  it("RPC-fel ⇒ write failed (bryter aldrig tyst)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const res = await retireWinner({ rpc } as never, "kund", "v1");
    expect(res).toEqual({ ok: false, reason: "write failed" });
  });
});

// Regressionsvakt på migrationens SQL: ett `||`-merge, inte en replace. En
// "förenkling" tillbaka till `evidence = '{"wasWinner":true}'` skulle
// återinföra klobbringen — och den bor i SQL där typkontrollen inte når.
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("angel_retire_winner-migrationen mergar evidence (klobbrar inte)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260813090000_angel_retire_winner.sql"),
    "utf8",
  );
  it("använder jsonb-konkatenering (||) för wasWinner, inte en ersättning", () => {
    expect(sql).toMatch(/evidence\s*=\s*coalesce\(evidence[^)]*\)\s*\|\|/i);
    expect(sql).toContain('"wasWinner": true');
  });
  it("låser på status = winner (optimistiskt lås bevarat)", () => {
    expect(sql).toMatch(/status\s*=\s*'winner'/i);
  });
});
