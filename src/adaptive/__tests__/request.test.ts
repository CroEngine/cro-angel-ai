import { describe, it, expect } from "vitest";

import { readServerSignals, buildVisitorContext } from "../context";
import { decide } from "../decide";
import { loadInventory } from "../inventory";
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
  return { context, decision: decide(client.site, context, loadInventory(client.site)) };
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
    expect(patterns).toContain("show_customer_logos_early");
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
    expect(patterns).toContain("shorten_hero");
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
