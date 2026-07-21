import { describe, it, expect } from "vitest";

import { diffInventory, itemKey } from "../inventory-drift";
import type { ContentInventory, InventoryItem } from "../types";

function inv(items: InventoryItem[]): ContentInventory {
  const slots: ContentInventory["slots"] = {};
  for (const it of items) (slots[it.slot] ??= []).push(it);
  return { site: "demo", slots };
}

const cta = (id: string, text: string, selector?: string): InventoryItem => ({
  id,
  slot: "cta",
  text,
  selector,
});

describe("diffInventory", () => {
  it("treats the first crawl (no baseline) as all-added, not drift", () => {
    const next = inv([cta("cta-0", "Start free", "#a")]);
    const d = diffInventory(null, next);
    expect(d.hasBaseline).toBe(false);
    expect(d.counts).toMatchObject({ added: 1, removed: 0, changed: 0 });
  });

  it("detects an added item", () => {
    const prev = inv([cta("cta-0", "Start free", "#a")]);
    const next = inv([cta("cta-0", "Start free", "#a"), cta("cta-1", "Book demo", "#b")]);
    const d = diffInventory(prev, next);
    expect(d.counts).toMatchObject({ added: 1, removed: 0, changed: 0, unchanged: 1 });
    expect(d.added[0].text).toBe("Book demo");
  });

  it("detects a removed item", () => {
    const prev = inv([cta("cta-0", "Start free", "#a"), cta("cta-1", "Book demo", "#b")]);
    const next = inv([cta("cta-0", "Start free", "#a")]);
    const d = diffInventory(prev, next);
    expect(d.counts).toMatchObject({ added: 0, removed: 1, changed: 0, unchanged: 1 });
    expect(d.removed[0].text).toBe("Book demo");
  });

  it("flags a copy change on a selector-anchored item as 'changed'", () => {
    const prev = inv([cta("cta-0", "Start free", "#a")]);
    const next = inv([cta("cta-0", "Start your free trial", "#a")]);
    const d = diffInventory(prev, next);
    expect(d.counts).toMatchObject({ added: 0, removed: 0, changed: 1 });
    expect(d.changed[0]).toMatchObject({ before: "Start free", after: "Start your free trial" });
  });

  it("is stable under reordering (positional ids change, anchors don't)", () => {
    // Same two CTAs, opposite order, and the positional ids have swapped.
    const prev = inv([cta("cta-0", "Start free", "#a"), cta("cta-1", "Book demo", "#b")]);
    const next = inv([cta("cta-0", "Book demo", "#b"), cta("cta-1", "Start free", "#a")]);
    const d = diffInventory(prev, next);
    expect(d.counts).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 2 });
  });

  it("treats a text-only (selector-less) copy change as remove + add", () => {
    const prev = inv([{ id: "headline-0", slot: "headline", text: "Old headline" }]);
    const next = inv([{ id: "headline-0", slot: "headline", text: "New headline" }]);
    const d = diffInventory(prev, next);
    expect(d.counts).toMatchObject({ added: 1, removed: 1, changed: 0 });
  });

  it("ignores whitespace/case differences in the anchor", () => {
    const prev = inv([cta("cta-0", "Start  Free")]);
    const next = inv([cta("cta-0", "start free")]);
    const d = diffInventory(prev, next);
    expect(d.counts).toMatchObject({ added: 0, removed: 0, unchanged: 1 });
  });
});

describe("itemKey", () => {
  it("anchors on selector when present, else text, else id", () => {
    expect(itemKey({ id: "x", slot: "cta", text: "Buy", selector: "#a" })).toContain("sel");
    expect(itemKey({ id: "x", slot: "cta", text: "Buy" })).toContain("txt");
    expect(itemKey({ id: "cta-present", slot: "cta" })).toContain("id");
  });
});
