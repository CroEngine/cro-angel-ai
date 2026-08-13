// Handler-nivåtest för den interna testytans auktoriseringsvakt
// (granskningsfynd 2026-08-13): $runId.stream.ts DEFINIERADE vakten men
// ANROPADE den aldrig — routen startade riktiga Browserbase-sessioner mot en
// anroparstyrd URL och skrev inventarium till en anroparnamngiven sajt, helt
// oautentiserat (SSRF + kostnads-DoS + tvärtenant-skriv). En vaktdefinition
// utan anrop är osynlig för enhetstester på vakten själv; detta test kör den
// RIKTIGA GET-hanteraren och bevisar 403 FÖRE något browserarbete.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Route as CrawlRoute } from "../crawl.stream";
import { Route as RobustnessRoute } from "../robustness.stream";
import { Route as RunIdRoute } from "../$runId.stream";

type Handler = (ctx: {
  params: Record<string, string>;
  request: Request;
}) => Promise<Response> | Response;

// TanStack-routens typer exponerar inte hanterarobjektet strukturellt; formen
// är stabil i runtime (bevisat av testerna), så vi når den via unknown.
const getHandler = (route: unknown): Handler => {
  const h = (route as { options?: { server?: { handlers?: { GET?: Handler } } } }).options?.server
    ?.handlers?.GET;
  if (!h) throw new Error("route saknar GET-hanterare");
  return h;
};

// Varje rutt + en request MED giltiga parametrar (så en utebliven vakt skulle
// falla vidare till 400/browserarbete i stället för att stoppa på 403).
const ROUTES: {
  name: string;
  handler: Handler;
  params: Record<string, string>;
  primedUrl: string;
}[] = [
  {
    name: "crawl.stream",
    handler: getHandler(CrawlRoute),
    params: {},
    primedUrl: "https://x.test/api/tests/crawl/stream?url=https://victim.example/&site=someslug",
  },
  {
    name: "robustness.stream",
    handler: getHandler(RobustnessRoute),
    params: {},
    primedUrl: "https://x.test/api/tests/robustness/stream?url=https://victim.example/",
  },
  {
    name: "$runId.stream",
    handler: getHandler(RunIdRoute),
    params: { runId: "r1" },
    // sessionId + url satta: FÖRE fixen nådde detta buildSteps + runSteps.
    primedUrl:
      "https://x.test/api/tests/r1/stream?sessionId=s1&url=https://victim.example/&ingestSite=anyones-site",
  },
];

const priorFlag = process.env.ANGEL_INTERNAL_TESTS;
afterEach(() => {
  if (priorFlag === undefined) delete process.env.ANGEL_INTERNAL_TESTS;
  else process.env.ANGEL_INTERNAL_TESTS = priorFlag;
});

describe("intern testyta — auktoriseringsvakt på handler-nivå", () => {
  describe("AVSTÄNGD i drift (ANGEL_INTERNAL_TESTS osatt) ⇒ 403 före allt arbete", () => {
    beforeEach(() => {
      delete process.env.ANGEL_INTERNAL_TESTS;
    });
    for (const r of ROUTES) {
      it(`${r.name}: 403 även med giltiga parametrar (inget browserarbete startar)`, async () => {
        const res = await r.handler({
          params: r.params,
          request: new Request(r.primedUrl),
        });
        expect(res.status).toBe(403);
      });
    }
  });

  describe("PÅSLAGEN (dev) ⇒ vakten släpper förbi till parametervalidering", () => {
    beforeEach(() => {
      process.env.ANGEL_INTERNAL_TESTS = "1";
    });
    for (const r of ROUTES) {
      it(`${r.name}: utan parametrar ⇒ 400 (passerade 403, men inget spawnas)`, async () => {
        const base = r.primedUrl.split("?")[0];
        const res = await r.handler({ params: r.params, request: new Request(base) });
        // 400 = vakten passerade OCH parametervalideringen stoppade före
        // Browserbase — bevisar att grinden inte är en no-op när flaggan är på.
        expect(res.status).toBe(400);
      });
    }
  });
});
