// PSI-körningarnas kontrakt (granskningsfynd 2026-08-14): bara senaste
// körningen får skriva state (stale svar från förra URL:en ignoreras),
// remount efter flikbyte re-fyrar inte, och Enter i URL-fältet startar
// ingen körning — bara explicit Run gör det.
import { describe, it, expect } from "vitest";

import { createPsiRunStore, shouldAutoRun } from "../PageInsightsView";
import type { PsiStrategyResult } from "@/lib/tests/pagespeed.functions";

const result = (strategy: "mobile" | "desktop", performance: number): PsiStrategyResult => ({
  strategy,
  fetchedAt: "2026-08-14T00:00:00.000Z",
  scores: { performance, accessibility: null, bestPractices: null, seo: null },
  vitals: {
    lcpMs: null,
    fcpMs: null,
    tbtMs: null,
    cls: null,
    speedIndexMs: null,
    ttiMs: null,
    fieldLcpMs: null,
    fieldFcpMs: null,
    fieldClsP75: null,
    fieldInpMs: null,
    hasFieldData: false,
  },
  audits: { opportunities: [], diagnostics: [] },
  resourceSummary: {
    totalKib: null,
    scriptKib: null,
    imageKib: null,
    stylesheetKib: null,
    fontKib: null,
    documentKib: null,
    mediaKib: null,
    otherKib: null,
    thirdPartyKib: null,
    totalRequests: null,
  },
  renderBlockingResources: [],
  thirdPartyEntities: [],
  thirdPartyBlockingTotalMs: 0,
  thirdPartyAuditMissing: false,
  error: null,
});

describe("shouldAutoRun", () => {
  it("kör inte på mount utan Run (runKey === 0)", () => {
    expect(shouldAutoRun(0, 0)).toBe(false);
  });

  it("kör på första explicita Run", () => {
    expect(shouldAutoRun(1, 0)).toBe(true);
  });

  it("kör inte om vid remount efter flikbyte (runKey redan hanterad)", () => {
    expect(shouldAutoRun(1, 1)).toBe(false);
    expect(shouldAutoRun(3, 3)).toBe(false);
  });

  it("kör igen på varje ny explicit Run", () => {
    expect(shouldAutoRun(2, 1)).toBe(true);
    expect(shouldAutoRun(4, 3)).toBe(true);
  });

  it("kör inte på mount-guarden även om hanterad nyckel är högre (t.ex. HMR-reset)", () => {
    expect(shouldAutoRun(0, 3)).toBe(false);
  });
});

describe("createPsiRunStore", () => {
  it("start nollar resultat och tänder båda loading-flaggorna", () => {
    const store = createPsiRunStore();
    expect(store.getState()).toBeNull();
    store.start("https://a.example/");
    expect(store.getState()).toEqual({
      url: "https://a.example/",
      mobile: null,
      desktop: null,
      mobileLoading: true,
      desktopLoading: true,
    });
  });

  it("settle från senaste körningen skriver resultat och släcker sin flagga", () => {
    const store = createPsiRunStore();
    const settle = store.start("https://a.example/");
    settle({ mobile: result("mobile", 90), mobileLoading: false });
    expect(store.getState()).toMatchObject({
      url: "https://a.example/",
      mobile: { strategy: "mobile", scores: { performance: 90 } },
      mobileLoading: false,
      desktopLoading: true,
    });
  });

  it("stale settle från en tidigare körning skriver aldrig över en nyare", () => {
    const store = createPsiRunStore();
    const settleA = store.start("https://a.example/");
    const settleB = store.start("https://b.example/");
    // A:s sena svar landar EFTER att B startats — måste ignoreras helt.
    settleA({ mobile: result("mobile", 11), mobileLoading: false });
    expect(store.getState()).toMatchObject({
      url: "https://b.example/",
      mobile: null,
      mobileLoading: true,
    });
    settleB({ mobile: result("mobile", 90), mobileLoading: false });
    expect(store.getState()).toMatchObject({
      url: "https://b.example/",
      mobile: { scores: { performance: 90 } },
      mobileLoading: false,
    });
  });

  it("stale settle släcker inte den nya körningens loading-flaggor i förtid", () => {
    const store = createPsiRunStore();
    const settleA = store.start("https://a.example/");
    store.start("https://b.example/");
    settleA({ mobileLoading: false });
    settleA({ desktopLoading: false });
    expect(store.getState()).toMatchObject({ mobileLoading: true, desktopLoading: true });
  });

  it("settle för ena strategin behåller den andras redan skrivna resultat", () => {
    const store = createPsiRunStore();
    const settle = store.start("https://a.example/");
    settle({ mobile: result("mobile", 80), mobileLoading: false });
    settle({ desktop: result("desktop", 95), desktopLoading: false });
    expect(store.getState()).toMatchObject({
      mobile: { strategy: "mobile", scores: { performance: 80 } },
      desktop: { strategy: "desktop", scores: { performance: 95 } },
      mobileLoading: false,
      desktopLoading: false,
    });
  });

  it("subscribe notifieras vid start och settle; avregistrering stoppar notiser", () => {
    const store = createPsiRunStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    const settle = store.start("https://a.example/");
    expect(calls).toBe(1);
    settle({ mobile: result("mobile", 90), mobileLoading: false });
    expect(calls).toBe(2);
    unsubscribe();
    settle({ desktop: result("desktop", 90), desktopLoading: false });
    expect(calls).toBe(2);
    // Statet uppdaterades ändå — bara notisen uteblev.
    expect(store.getState()?.desktop?.strategy).toBe("desktop");
  });

  it("stale settle notifierar inte prenumeranter (ingen onödig re-render)", () => {
    const store = createPsiRunStore();
    const settleA = store.start("https://a.example/");
    store.start("https://b.example/");
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    settleA({ mobile: result("mobile", 11), mobileLoading: false });
    expect(calls).toBe(0);
  });

  // reset() nollar storen vid ny BrowserShell-session (granskningsfynd
  // 2026-08-14, regression): utan den läckte förra sessionens resultat till
  // default-URL:en och en inflygande settle kunde skriva efter nollningen.
  it("reset() nollar statet OCH gör en inflygande settle från förra sessionen till no-op", () => {
    const store = createPsiRunStore();
    const settle = store.start("https://a.example/");
    settle({ mobile: result("mobile", 90), mobileLoading: false });
    expect(store.getState()?.url).toBe("https://a.example/");

    store.reset();
    expect(store.getState()).toBeNull();

    // Ett sent svar från körningen FÖRE nollningen får aldrig återuppliva statet.
    settle({ desktop: result("desktop", 50), desktopLoading: false });
    expect(store.getState()).toBeNull();
  });

  it("reset() notifierar prenumeranter så vyn ritar om till tomt", () => {
    const store = createPsiRunStore();
    store.start("https://a.example/");
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.reset();
    expect(calls).toBe(1);
    expect(store.getState()).toBeNull();
  });
});
