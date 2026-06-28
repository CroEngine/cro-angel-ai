import { describe, it, expect } from "vitest";

import { resolveInventory } from "../inventory.server";

// End-to-end resolution: with no service-role key configured in the test env,
// the DB step fails gracefully and resolution falls through to the corpus
// snapshot / demo fixture / empty inventory — exactly the production order.

describe("resolveInventory", () => {
  it('returns real corpus-derived content for a captured site ("hubspot")', async () => {
    const inv = await resolveInventory("hubspot");
    expect(inv.site).toBe("hubspot");
    expect((inv.slots.cta ?? []).length).toBeGreaterThan(0);
    expect((inv.slots.headline ?? []).length).toBeGreaterThan(0);
  });

  it("returns the demo fixture for the demo site", async () => {
    const inv = await resolveInventory("demo");
    expect(inv.site).toBe("demo");
    expect(inv.slots.cta?.some((c) => c.meta?.intent === "demo")).toBe(true);
  });

  it("returns an empty inventory for an unknown site (never invents)", async () => {
    const inv = await resolveInventory("totally-unknown-site");
    expect(inv.site).toBe("totally-unknown-site");
    expect(Object.keys(inv.slots).length).toBe(0);
  });
});
