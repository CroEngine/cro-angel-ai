// Handler-nivåtest för /api/public/stats: den lyckliga vägen ska vara
// CDN-cachebar (identiskt svar för alla ⇒ public, max-age=300) och felvägen
// ska vara ett ÄRLIGT 503 utan cache — gamla/halva siffror på en sida vars
// poäng är ärlighet vore värre än inga.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicStats } from "@/lib/public-stats/stats";

const fetchPublicStats = vi.fn<() => Promise<PublicStats>>();
vi.mock("@/lib/public-stats/stats.server", () => ({
  fetchPublicStats: () => fetchPublicStats(),
}));

import { Route } from "../stats";

const GET = () => {
  // Runtime-formen är stabil (samma mönster som consent-config-testet);
  // TanStack-typerna exponerar den inte strukturellt, så unknown-vägen.
  const h = (
    Route as unknown as {
      options?: { server?: { handlers?: { GET?: () => Promise<Response> } } };
    }
  ).options?.server?.handlers?.GET;
  if (!h) throw new Error("stats saknar GET-hanterare");
  return h;
};

describe("/api/public/stats GET — ärliga aggregat, cachebara", () => {
  beforeEach(() => fetchPublicStats.mockReset());

  it("lyckad hämtning ⇒ {ok, stats}, public max-age=300, CORS *", async () => {
    fetchPublicStats.mockResolvedValueOnce({
      awaitingApproval: 2,
      measuringNow: 1,
      provenWinners: 0,
      previewsBuilt: 9,
      lastEngineActionAt: "2026-08-17T03:38:06Z",
    });
    const res = await GET()();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      stats: {
        awaitingApproval: 2,
        measuringNow: 1,
        provenWinners: 0,
        previewsBuilt: 9,
        lastEngineActionAt: "2026-08-17T03:38:06Z",
      },
    });
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("hämtningen kastar ⇒ 503 unavailable, no-store — aldrig cachat fel", async () => {
    fetchPublicStats.mockRejectedValueOnce(new Error("db borta"));
    const res = await GET()();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "unavailable" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
