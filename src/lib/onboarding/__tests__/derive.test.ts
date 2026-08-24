// Onboardingens rena del: härledningen (URL → domän/slug/namn) och
// localStorage-handoffens kodek med TTL-vakt. Regeln som låses: allt
// prospektet redan gett oss härleds — och en trasig/gammal handoff blir null,
// aldrig ett kast mitt i auth-flödet.
import { describe, expect, it } from "vitest";

import { decodePendingActivation, deriveActivation, encodePendingActivation } from "../derive";

const JOB = "3c9638e9-07d6-4a01-b012-c8cbfcce8a93";

describe("deriveActivation — URL ur demo-jobbet → sajtens allt", () => {
  it("vanlig https-URL ⇒ domän = slug, namn utan www", () => {
    expect(deriveActivation("https://www.glutenforum.se/")).toEqual({
      domain: "glutenforum.se",
      slug: "glutenforum.se",
      name: "glutenforum.se",
    });
  });

  it("djup väg och port påverkar inte härledningen", () => {
    const d = deriveActivation("https://kund.se:8443/sida/djupt?x=1");
    expect(d?.domain).toBe("kund.se");
    expect(d?.slug).toBe("kund.se");
  });

  it("icke-normaliserbar värd (en etikett / trasig URL) ⇒ null, inget kast", () => {
    expect(deriveActivation("inte en url")).toBeNull();
    expect(deriveActivation("https://localhost/")).toBeNull();
  });
});

describe("handoffens kodek — try → signup → welcome", () => {
  it("rund tur inom TTL ⇒ jobb-id:t tillbaka", () => {
    const raw = encodePendingActivation(JOB, 1_000);
    expect(decodePendingActivation(raw, 1_000 + 3600_000)).toEqual({ jobId: JOB });
  });

  it("äldre än 24h ⇒ null (aktivera inte ett bortglömt jobb)", () => {
    const raw = encodePendingActivation(JOB, 0);
    expect(decodePendingActivation(raw, 24 * 3600_000 + 1)).toBeNull();
  });

  it("trasig JSON, fel form eller icke-uuid ⇒ null, aldrig kast", () => {
    expect(decodePendingActivation("{trasig", 0)).toBeNull();
    expect(decodePendingActivation(JSON.stringify({ jobId: 7, at: 0 }), 0)).toBeNull();
    expect(decodePendingActivation(JSON.stringify({ jobId: "x", at: 0 }), 0)).toBeNull();
    expect(decodePendingActivation(null, 0)).toBeNull();
  });
});
