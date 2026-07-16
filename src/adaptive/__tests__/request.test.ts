import { describe, it, expect } from "vitest";

import { readServerSignals, buildVisitorContext } from "../context";
import { decide } from "../decide";
import { getDemoInventory } from "../inventory";
import type { ClientSignals } from "../types";

// Exercises the exact server-side path that POST /api/adaptive/decide runs:
//   Request headers -> readServerSignals -> buildVisitorContext -> decide.
// This is the integration seam between the HTTP layer and the engine, tested on
// real Request objects (the dev server can't bind in this sandbox's no-IPv6
// environment, so we drive the handler's inputs directly).

const CHROME_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("https://app.angel.example/api/adaptive/decide", {
    method: "POST",
    headers,
  });
}

function runDecision(headers: Record<string, string>, client: ClientSignals) {
  const server = readServerSignals(makeRequest(headers));
  const context = buildVisitorContext(server, client);
  return { context, decision: decide(client.site, context, getDemoInventory()) };
}

describe("server request path", () => {
  it("classifies a LinkedIn desktop visitor from headers + signals and books a demo", () => {
    const { context, decision } = runDecision(
      {
        "user-agent": CHROME_DESKTOP,
        "accept-language": "en-US,en;q=0.9",
        referer: "https://www.linkedin.com/feed/",
        "cf-ipcountry": "US",
      },
      { site: "demo", url: "https://acme.com/", utmSource: "linkedin" },
    );

    expect(context.trafficSource).toBe("linkedin");
    expect(context.device).toBe("desktop");
    expect(context.browser).toBe("chrome");
    expect(context.os).toBe("macos");
    expect(context.country).toBe("US");

    const patterns = decision.adaptations.map((a) => a.pattern);
    // v1: logo-flytten är nivå 3 (layout) → declined som standard; guidnings-
    // mönstren bär B2B-anpassningen.
    expect(patterns).not.toContain("show_customer_logos_early");
    expect(patterns).toContain("show_case_study");
    expect(decision.adaptations.find((a) => a.pattern === "clarify_cta")?.value).toBe(
      "Book a demo",
    );
  });

  it("classifies an iPhone visitor as mobile from the UA alone", () => {
    const { context, decision } = runDecision(
      { "user-agent": SAFARI_IPHONE, "accept-language": "sv-SE,sv;q=0.9" },
      { site: "demo", url: "https://acme.com/", utmSource: "google" },
    );

    expect(context.device).toBe("mobile");
    expect(context.os).toBe("ios");
    expect(context.language).toBe("sv");

    const patterns = decision.adaptations.map((a) => a.pattern);
    // v1: hero-komprimeringen är nivå 3 → declined som standard på mobil.
    expect(patterns).not.toContain("shorten_hero");
    expect(decision.adaptations.find((a) => a.pattern === "clarify_cta")?.value).toBe(
      "Start Free Trial",
    );
  });

  it("returns a well-formed Decision payload (the JSON contract the snippet expects)", () => {
    const { decision } = runDecision(
      { "user-agent": CHROME_DESKTOP },
      { site: "demo", url: "https://acme.com/" },
    );
    expect(typeof decision.decisionId).toBe("string");
    expect(decision.decisionId).toMatch(/^[0-9a-f]{8}$/);
    expect(decision.site).toBe("demo");
    expect(Array.isArray(decision.adaptations)).toBe(true);
    for (const a of decision.adaptations) {
      expect(a).toHaveProperty("op");
      expect(a).toHaveProperty("target");
      expect(a).toHaveProperty("reason");
      expect(typeof a.priority).toBe("number");
    }
  });
});

describe("route modules load", () => {
  it("decide + events route modules import and expose a Route", async () => {
    const decideRoute = await import("@/routes/api/adaptive/decide");
    const eventsRoute = await import("@/routes/api/adaptive/events");
    expect(decideRoute.Route).toBeTruthy();
    expect(eventsRoute.Route).toBeTruthy();
  });
});

describe("classifyPageType", () => {
  it("classifies home / conversion / content, EN + SV", async () => {
    const { classifyPageType } = await import("../context");
    expect(classifyPageType("https://x.se/")).toBe("home");
    expect(classifyPageType("https://x.se/skapa-konto")).toBe("conversion");
    expect(classifyPageType("https://x.se/signup")).toBe("conversion");
    expect(classifyPageType("https://x.se/kassa")).toBe("conversion");
    expect(classifyPageType("https://x.se/checkout/step-2")).toBe("conversion");
    expect(classifyPageType("https://x.se/recept/glutenfri-pizza")).toBe("content");
    expect(classifyPageType("not a url")).toBe("other");
  });

  it("A3: login/account pages are auth, never conversion", async () => {
    const { classifyPageType } = await import("../context");
    expect(classifyPageType("https://x.se/login")).toBe("auth");
    expect(classifyPageType("https://x.se/logga-in")).toBe("auth");
    expect(classifyPageType("https://x.se/sign-in")).toBe("auth");
    expect(classifyPageType("https://x.se/inloggning")).toBe("auth");
    expect(classifyPageType("https://x.se/mina-sidor")).toBe("auth");
    // auth wins even when the query/next hop mentions a conversion path
    expect(classifyPageType("https://x.se/login/checkout-redirect")).toBe("auth");
  });
});

describe("classifyCtaIntent — Swedish", () => {
  it("maps SV labels to intents", async () => {
    const { classifyCtaIntent } = await import("../crawler-inventory");
    expect(classifyCtaIntent("Boka demo")).toBe("demo");
    expect(classifyCtaIntent("Kontakta oss")).toBe("sales");
    expect(classifyCtaIntent("Begär offert")).toBe("sales");
    expect(classifyCtaIntent("Skapa konto")).toBe("trial");
    expect(classifyCtaIntent("Prova gratis")).toBe("trial");
  });
});

describe("classifyTrafficSource — intern navigation + sökmotorer", () => {
  it("referrer från sajtens egen domän är intern navigation → direct, inte other", async () => {
    const { classifyTrafficSource } = await import("../context");
    expect(
      classifyTrafficSource({
        referrer: "https://glutenforum.se/recept",
        pageUrl: "https://glutenforum.se/",
      }),
    ).toBe("direct");
    // www-varianten och subdomäner räknas som samma sajt
    expect(
      classifyTrafficSource({
        referrer: "https://www.glutenforum.se/",
        pageUrl: "https://glutenforum.se/om",
      }),
    ).toBe("direct");
    expect(
      classifyTrafficSource({
        referrer: "https://shop.glutenforum.se/",
        pageUrl: "https://glutenforum.se/",
      }),
    ).toBe("direct");
  });

  it("extern okänd referrer förblir other; utan referrer direct", async () => {
    const { classifyTrafficSource } = await import("../context");
    expect(
      classifyTrafficSource({
        referrer: "https://nagon-blogg.se/",
        pageUrl: "https://glutenforum.se/",
      }),
    ).toBe("other");
    expect(classifyTrafficSource({ pageUrl: "https://glutenforum.se/" })).toBe("direct");
  });

  it("sökmotorer utanför google/bing klassas som search", async () => {
    const { classifyTrafficSource } = await import("../context");
    expect(classifyTrafficSource({ referrer: "https://duckduckgo.com/" })).toBe("search");
    expect(classifyTrafficSource({ referrer: "https://www.ecosia.org/search?q=x" })).toBe("search");
    expect(classifyTrafficSource({ referrer: "https://search.yahoo.com/search" })).toBe("search");
    expect(classifyTrafficSource({ utmSource: "duckduckgo" })).toBe("search");
    // "elakexempel": sajt vars namn INNEHÅLLER en sökmotor får inte matcha
    expect(classifyTrafficSource({ referrer: "https://notduckduckgood.com/" })).toBe("other");
  });

  it("UTM vinner över intern referrer", async () => {
    const { classifyTrafficSource } = await import("../context");
    expect(
      classifyTrafficSource({
        utmSource: "newsletter",
        referrer: "https://glutenforum.se/",
        pageUrl: "https://glutenforum.se/kampanj",
      }),
    ).toBe("newsletter");
  });
});
