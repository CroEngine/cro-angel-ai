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

  it("PII-scrubs the ref and path free-text fields (email/phone redacted)", () => {
    const events: AngelEvent[] = [
      {
        type: "element_click",
        payload: { seq: 3, ref: "Maila john@doe.com", path: "/tack?email=john@doe.com" },
      },
      { type: "form_abandon", payload: { ref: "Ring 070-123 45 67", kind: "other" } },
    ];
    const rows = buildEventRows("acme", "v", events, null);
    const p0 = rows[0].payload as Record<string, unknown>;
    expect(p0.ref).toBe("Maila [redacted]");
    expect(p0.path).toBe("/tack?email=[redacted]");
    const p1 = rows[1].payload as Record<string, unknown>;
    expect(p1.ref).toContain("[redacted]");
  });

  it("omits sessionId when none is provided (anonymous-safe default)", () => {
    const rows = buildEventRows("acme", "v", [{ type: "page_leave", payload: {} }], null);
    expect((rows[0].payload as Record<string, unknown>).sessionId).toBeUndefined();
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
});
