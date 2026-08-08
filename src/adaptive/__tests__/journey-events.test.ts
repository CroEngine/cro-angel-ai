import { describe, it, expect } from "vitest";

import { buildEventRows } from "../persistence.server";
import type { AngelEvent } from "../types";

// The journey privacy boundary: buildEventRows is the single choke point that
// turns client events into DB rows. It must scrub the free-text journey fields
// (ref/path) and attach the anonymous session id — never leak PII.

describe("buildEventRows — journey privacy boundary", () => {
  it("attaches the anonymous session id to every event's payload (capped)", () => {
    const events: AngelEvent[] = [
      { type: "element_click", payload: { seq: 1, ref: "#book-demo" } },
      { type: "page_leave", payload: { engagedMs: 4200, exit: true } },
    ];
    const rows = buildEventRows("acme", "v-123", events, "s-abc");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect((r.payload as Record<string, unknown>).sessionId).toBe("s-abc");
      expect(r.visitor_hash).toBe("v-123");
      expect(r.site).toBe("acme");
    }
    // Over-long session id is capped, not trusted verbatim.
    const long = buildEventRows("acme", null, events, "s".repeat(200));
    expect(((long[0].payload as Record<string, unknown>).sessionId as string).length).toBe(80);
  });

  it("PII-scrubs ref/path: email, phone, AND path-embedded tokens/UUIDs", () => {
    const events: AngelEvent[] = [
      {
        type: "element_click",
        payload: { seq: 3, ref: "Maila john@doe.com", path: "/tack?email=john@doe.com" },
      },
      { type: "form_abandon", payload: { ref: "Ring 070-123 45 67", kind: "other" } },
      // Reset-token i en PATH-segment (klientens query-allowlist kan inte
      // strippa den) → scrubbas server-side.
      { type: "page_leave", payload: { path: "/reset/tok_ABCdef123GHIjkl456MNO", engagedMs: 100 } },
    ];
    const rows = buildEventRows("acme", "v", events, null);
    expect((rows[0].payload as Record<string, unknown>).ref).toBe("Maila [redacted]");
    // Sedan pilotfyndet 2026-07-17 strippas HELA queryn (sididentitet, aldrig
    // spårning) — e-posten lagras inte ens i redigerad form.
    expect((rows[0].payload as Record<string, unknown>).path).toBe("/tack");
    expect((rows[1].payload as Record<string, unknown>).ref).toContain("[redacted]");
    expect((rows[2].payload as Record<string, unknown>).path).toContain("[id]");
  });

  it("omits sessionId when none is provided (anonymous-safe default)", () => {
    const rows = buildEventRows("acme", "v", [{ type: "page_leave", payload: {} }], null);
    expect((rows[0].payload as Record<string, unknown>).sessionId).toBeUndefined();
  });

  it("section_engagement: cappar, klampar och PII-skrubbar sections-aggregatet", () => {
    // PII/trasiga poster FÖRST (cap-slicen tar de 24 första — läggs de sist
    // testar vi ingenting), sedan filler över 24-taket.
    const sections: unknown[] = [
      { h: "Ring 070-123 45 67 idag", n: 99, d: 9e9 }, // skrubb + klamp
      { h: "", n: 1, d: 5 }, // tom rubrik — släpps
      "garbage", // fel form — släpps
    ];
    for (let i = 0; i < 28; i++) sections.push({ h: `Section ${i}`, n: 1, d: 1000 });
    const rows = buildEventRows(
      "acme",
      "v",
      [{ type: "section_engagement", payload: { sections, path: "/" } }],
      "s1",
    );
    const p = rows[0].payload as { sections: { h: string; n: number; d: number }[] };
    expect(p.sections.length).toBeLessThanOrEqual(24);
    const first = p.sections[0];
    expect(first.h).not.toContain("070-123"); // cleanText-redaktion
    expect(first.n).toBe(9); // 99 → taket
    expect(first.d).toBe(600000); // 9e9 → taket
    expect(p.sections.some((s) => s.h === "")).toBe(false);
    for (const s of p.sections) {
      expect(s.n).toBeGreaterThanOrEqual(1);
      expect(s.d).toBeGreaterThanOrEqual(0);
      expect(s.h.length).toBeLessThanOrEqual(120);
    }
  });

  it("preserves non-text journey fields untouched (seq, engagedMs, kind)", () => {
    const rows = buildEventRows(
      "acme",
      "v",
      [{ type: "form_start", payload: { ref: "#newsletter", kind: "newsletter", seq: 2 } }],
      "s1",
    );
    const p = rows[0].payload as Record<string, unknown>;
    expect(p.kind).toBe("newsletter");
    expect(p.seq).toBe(2);
    expect(p.ref).toBe("#newsletter"); // no PII → unchanged
  });

  it("cleanText-skrubbar söktermen (site_search): mejl + långa tal redakteras, längden kapas", () => {
    const rows = buildEventRows(
      "acme",
      "v",
      [
        {
          type: "site_search",
          payload: { term: "boka bord anna@example.com 0701234567 " + "x".repeat(200) },
        },
      ],
      "s1",
    );
    const term = (rows[0].payload as Record<string, unknown>).term as string;
    expect(term).not.toContain("anna@example.com");
    expect(term).not.toContain("0701234567");
    expect(term).toContain("[redacted]");
    expect(term.length).toBeLessThanOrEqual(80);
    expect(term).toContain("boka bord");
  });
});
