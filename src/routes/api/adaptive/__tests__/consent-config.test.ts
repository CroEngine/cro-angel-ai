// Handler-nivåtest för consent-config (granskningsfynd 2026-08-13):
//  A) Grinden nyckla på RÅ cfg.domain men originVerdict klassar via
//     normalizeDomain — en sann men icke-normaliserbar domän (en-etiketts
//     "localhost") gav alltid proved:false ⇒ sajten TYST låst till ANON för
//     varje origin (attesterat läge/holdout/konvertering avstängt).
//  B) Den cachebara proved-configen (public, max-age=300) saknade Vary:Origin
//     ⇒ en delad CDN-cache kunde servera konverteringstratten till obevisad
//     anropare.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteConfig } from "@/adaptive/persistence.server";

const loadSiteConfig = vi.fn<(slug: string) => Promise<SiteConfig>>();
vi.mock("@/adaptive/persistence.server", () => ({
  loadSiteConfig: (slug: string) => loadSiteConfig(slug),
}));

import { Route } from "../consent-config";

const GET = () => {
  // Runtime-formen är stabil (bevisat av testerna); TanStack-typerna
  // exponerar den inte strukturellt, så vi når hanteraren via unknown.
  const h = (
    Route as unknown as {
      options?: {
        server?: { handlers?: { GET?: (ctx: { request: Request }) => Promise<Response> } };
      };
    }
  ).options?.server?.handlers?.GET;
  if (!h) throw new Error("consent-config saknar GET-hanterare");
  return h;
};

const cfg = (over: Partial<SiteConfig>): SiteConfig => ({
  mode: "attested",
  holdoutPct: 10,
  conversionUrl: "/tack",
  conversionSelector: "#kop",
  conversionText: "Köp nu",
  conversionKind: "purchase",
  ingestKey: "hemlig-nyckel",
  layoutPatternsEnabled: false,
  adaptationsEnabled: true,
  servingEnabled: true,
  observeSections: true,
  rampPct: 10,
  billingStatus: "active",
  domain: null,
  domainVerifiedAt: null,
  ...over,
});

const req = (site: string, origin?: string) =>
  new Request(`https://x.test/api/adaptive/consent-config?site=${site}`, {
    headers: origin ? { origin } : {},
  });

describe("consent-config GET — origin-grind + cache-säkerhet", () => {
  beforeEach(() => loadSiteConfig.mockReset());

  it("registrerad domän + matchande Origin ⇒ full config, cachebar MED Vary:Origin", async () => {
    loadSiteConfig.mockResolvedValueOnce(cfg({ domain: "kund.se" }));
    const res = await GET()({ request: req("kund", "https://kund.se") });
    const body = await res.json();
    expect(body.mode).toBe("attested");
    expect(body.conversion.selector).toBe("#kop");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    // Utan detta serverar en delad cache proved-svaret till obevisade.
    expect(res.headers.get("vary")).toBe("Origin");
    // Serverhemligheten får ALDRIG läcka i publika svaret.
    expect(JSON.stringify(body)).not.toContain("hemlig-nyckel");
  });

  it("registrerad domän + fel/ingen Origin ⇒ ANON, no-store", async () => {
    loadSiteConfig.mockResolvedValueOnce(cfg({ domain: "kund.se" }));
    const res = await GET()({ request: req("kund", "https://angripare.se") });
    const body = await res.json();
    expect(body.mode).toBe("anonymous");
    expect(body.conversion).toEqual({ url: null, selector: null, text: null });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("en-etiketts-domän (icke-normaliserbar) ⇒ legacy-beteende, INTE tyst låst till ANON", async () => {
    // Regressionen: "localhost" är sann men normalizeDomain→null, så proved
    // blev alltid false och sajten fick ANON för varje origin. Nu faller den
    // till legacy allowed-grenen och servar full config (som före grinden).
    loadSiteConfig.mockResolvedValueOnce(cfg({ domain: "localhost" }));
    const res = await GET()({ request: req("labbsajt", "https://labbsajt.example") });
    const body = await res.json();
    expect(body.mode).toBe("attested");
    expect(body.observeSections).toBe(true);
  });

  it("legacy-sajt utan domän ⇒ full config oavsett origin (inget att bevisa mot)", async () => {
    loadSiteConfig.mockResolvedValueOnce(cfg({ domain: null }));
    const res = await GET()({ request: req("legacy") });
    const body = await res.json();
    expect(body.mode).toBe("attested");
  });

  it("utan ?site ⇒ ANON, no-store, cachas aldrig", async () => {
    const res = await GET()({
      request: new Request("https://x.test/api/adaptive/consent-config"),
    });
    expect((await res.json()).mode).toBe("anonymous");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(loadSiteConfig).not.toHaveBeenCalled();
  });
});
