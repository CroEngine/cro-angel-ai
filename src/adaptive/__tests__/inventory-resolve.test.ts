import { describe, it, expect } from "vitest";

import { resolveInventory } from "../inventory.server";

// End-to-end resolution: with no service-role key configured in the test env,
// the DB step fails gracefully and resolution falls through to the corpus
// snapshot / empty inventory — exactly the production order. (/demo och dess
// server-fixture-specialfall är borttagna; sandboxen är verifieringsytan.)

describe("resolveInventory", () => {
  it('returns real corpus-derived content for a captured site ("hubspot")', async () => {
    const inv = await resolveInventory("hubspot");
    expect(inv.site).toBe("hubspot");
    expect((inv.slots.cta ?? []).length).toBeGreaterThan(0);
    expect((inv.slots.headline ?? []).length).toBeGreaterThan(0);
  });

  it('the retired "demo" slug resolves like any unknown site — empty, never the fixture', async () => {
    const inv = await resolveInventory("demo");
    expect(inv.site).toBe("demo");
    expect(Object.keys(inv.slots).length).toBe(0);
  });

  it("returns an empty inventory for an unknown site (never invents)", async () => {
    const inv = await resolveInventory("totally-unknown-site");
    expect(inv.site).toBe("totally-unknown-site");
    expect(Object.keys(inv.slots).length).toBe(0);
  });
});
