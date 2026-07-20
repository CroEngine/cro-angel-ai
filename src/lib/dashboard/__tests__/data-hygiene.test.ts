import { describe, expect, it } from "vitest";

import { cleanEvents } from "../data-hygiene";

import type { DashEvent } from "../aggregate";

const ev = (over: Partial<DashEvent> & { type: string }): DashEvent => ({
  payload: {},
  visitorHash: null,
  decisionId: null,
  createdAt: "2026-07-15T12:00:00Z",
  ...over,
  type: over.type,
});

describe("cleanEvents — datahygien (revisionen 2026-07-20)", () => {
  it("generella regler: /admin, angel_-paths och simulated ryker för ALLA sajter", () => {
    const events = [
      ev({ type: "pageview", payload: { path: "/admin/login" } }),
      ev({ type: "element_click", payload: { path: "/admin" } }),
      ev({ type: "pageview", payload: { path: "/?angel_source=twitter" } }),
      ev({ type: "pageview", payload: { path: "/", simulated: true } }),
      ev({ type: "pageview", payload: { path: "/" } }),
    ];
    const out = cleanEvents("annan-sajt.se", events);
    expect(out).toHaveLength(1);
    expect(out[0].payload.path).toBe("/");
  });

  it("burst-fönstren ryker för piloten men INTE för andra sajter", () => {
    const inWindow = ev({
      type: "pageview",
      payload: { path: "/" },
      createdAt: "2026-07-10T06:25:00Z",
    });
    expect(cleanEvents("glutenforum.se", [inWindow])).toHaveLength(0);
    expect(cleanEvents("annan-sajt.se", [inWindow])).toHaveLength(1);
    // Utanför fönstret: behålls även för piloten.
    const outside = ev({
      type: "pageview",
      payload: { path: "/" },
      createdAt: "2026-07-10T07:00:00Z",
    });
    expect(cleanEvents("glutenforum.se", [outside])).toHaveLength(1);
  });

  it("blocklistade hashar och ägarsessionen ryker", () => {
    const events = [
      ev({
        type: "element_click",
        visitorHash: "ed3badd9-c7fe-40c2-aa4d-b0efd6048121",
        payload: { path: "/", ref: "X" },
      }),
      ev({
        type: "page_leave",
        payload: { path: "/", sessionId: "4f5da1d5-3d83-4e21-9c77-08fcda495706" },
      }),
      ev({ type: "pageview", visitorHash: "vanlig-besokare", payload: { path: "/" } }),
    ];
    const out = cleanEvents("glutenforum.se", events);
    expect(out).toHaveLength(1);
    expect(out[0].visitorHash).toBe("vanlig-besokare");
  });

  it("simulatorkällor kaskaderar: HELA sessionen ryker, inte bara pageviewen", () => {
    const events = [
      ev({
        type: "pageview",
        payload: { path: "/", sessionId: "sim-1", trafficSource: "twitter" },
      }),
      ev({ type: "element_click", payload: { path: "/", sessionId: "sim-1", ref: "Knapp" } }),
      ev({ type: "page_leave", payload: { path: "/", sessionId: "sim-1", engagedMs: 5000 } }),
      ev({
        type: "pageview",
        payload: { path: "/", sessionId: "riktig-1", trafficSource: "google" },
      }),
    ];
    const out = cleanEvents("glutenforum.se", events);
    expect(out).toHaveLength(1);
    expect(out[0].payload.sessionId).toBe("riktig-1");
  });

  it("OWNER-2: conversion/cta_click före 2026-07-20 nollställs; nya passerar", () => {
    const events = [
      ev({ type: "conversion", payload: {}, createdAt: "2026-07-15T10:00:00Z" }),
      ev({ type: "cta_click", payload: { path: "goal" }, createdAt: "2026-07-19T10:00:00Z" }),
      ev({ type: "conversion", payload: {}, createdAt: "2026-07-21T10:00:00Z" }),
    ];
    const out = cleanEvents("glutenforum.se", events);
    expect(out).toHaveLength(1);
    expect(out[0].createdAt).toBe("2026-07-21T10:00:00Z");
  });

  it("conversion-dedup: samma session+decision inom 5 s → första vinner", () => {
    const events = [
      ev({
        type: "conversion",
        decisionId: "d1",
        payload: { sessionId: "s1" },
        createdAt: "2026-07-21T10:00:00Z",
      }),
      ev({
        type: "conversion",
        decisionId: "d1",
        payload: { sessionId: "s1" },
        createdAt: "2026-07-21T10:00:02Z",
      }),
      // Annan decision → egen konvertering, ingen dedup.
      ev({
        type: "conversion",
        decisionId: "d2",
        payload: { sessionId: "s1" },
        createdAt: "2026-07-21T10:00:03Z",
      }),
      // Samma nyckel men >5 s senare → äkta ny konvertering.
      ev({
        type: "conversion",
        decisionId: "d1",
        payload: { sessionId: "s1" },
        createdAt: "2026-07-21T10:00:30Z",
      }),
    ];
    const out = cleanEvents("glutenforum.se", events);
    expect(out.map((e) => e.createdAt)).toEqual([
      "2026-07-21T10:00:00Z",
      "2026-07-21T10:00:03Z",
      "2026-07-21T10:00:30Z",
    ]);
  });

  it("sajter utan hygienkonfiguration påverkas bara av generella regler", () => {
    const events = [
      ev({
        type: "pageview",
        visitorHash: "ed3badd9-c7fe-40c2-aa4d-b0efd6048121",
        payload: { path: "/", trafficSource: "twitter", sessionId: "x" },
      }),
    ];
    // Samma hash + källa som pilotens blocklista — men på en annan sajt är
    // den en helt vanlig besökare.
    expect(cleanEvents("annan-sajt.se", events)).toHaveLength(1);
  });
});
