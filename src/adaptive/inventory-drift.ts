// Angel Adaptive — content-inventory drift detection (pure).
//
// Compares a freshly-crawled ContentInventory against the previously-stored one
// and reports what changed on the site (added / removed / changed items). This
// is the lightweight "keep up with site changes" layer: it reuses what the
// crawler already produces and needs no byte-level snapshot.
//
// Why not match on item.id: the persisted id is POSITIONAL (`${slot}-${index}`,
// see crawler-inventory.ts), so inserting or reordering an element shifts every
// later id and would surface as noise. We anchor on a stable signature instead
// (selector → text → id), so the diff tracks real DOM/content identity.

import type { ContentInventory, InventoryItem, InventorySlot } from "./types";

export interface InventoryChange {
  slot: InventorySlot;
  key: string;
  before: string;
  after: string;
  selector?: string;
}

export interface InventoryDrift {
  /** false on the first crawl — no stored baseline to compare against. */
  hasBaseline: boolean;
  added: InventoryItem[];
  removed: InventoryItem[];
  changed: InventoryChange[];
  counts: { added: number; removed: number; changed: number; unchanged: number };
}

function norm(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Stable cross-crawl identity for an inventory item. Anchors on the selector
 * when present (a stable DOM target), else the normalized lowercased text, else
 * the item id (presence-only items such as "${slot}-present"). Encoded as a
 * JSON tuple so the slot/kind/value segments stay unambiguous for any content.
 */
export function itemKey(item: InventoryItem): string {
  if (item.selector) return JSON.stringify([item.slot, "sel", item.selector]);
  if (item.text) return JSON.stringify([item.slot, "txt", norm(item.text).toLowerCase()]);
  return JSON.stringify([item.slot, "id", item.id]);
}

function flatten(inv: ContentInventory | null): Map<string, InventoryItem> {
  const map = new Map<string, InventoryItem>();
  if (!inv) return map;
  for (const items of Object.values(inv.slots)) {
    for (const item of items ?? []) {
      const k = itemKey(item);
      // First occurrence wins; the builder already dedups within a slot.
      if (!map.has(k)) map.set(k, item);
    }
  }
  return map;
}

/**
 * Compare the previously-stored inventory against a freshly-crawled one.
 *
 * - added:   anchors present now but not before
 * - removed: anchors present before but not now
 * - changed: selector-anchored items whose text changed (same DOM target, new
 *            copy). Text-anchored items can't "change" — a different text is a
 *            different anchor, i.e. it shows up as an add + a remove.
 *
 * `prev === null` means there is no baseline yet (first crawl): everything is
 * reported as added and `hasBaseline` is false, so callers can skip recording
 * the first crawl as drift.
 */
export function diffInventory(
  prev: ContentInventory | null,
  next: ContentInventory,
): InventoryDrift {
  const prevMap = flatten(prev);
  const nextMap = flatten(next);

  const added: InventoryItem[] = [];
  const removed: InventoryItem[] = [];
  const changed: InventoryChange[] = [];
  let unchanged = 0;

  for (const [key, item] of nextMap) {
    const before = prevMap.get(key);
    if (!before) {
      added.push(item);
      continue;
    }
    if (item.selector && norm(before.text) !== norm(item.text)) {
      changed.push({
        slot: item.slot,
        key,
        before: norm(before.text),
        after: norm(item.text),
        selector: item.selector,
      });
    } else {
      unchanged++;
    }
  }
  for (const [key, item] of prevMap) {
    if (!nextMap.has(key)) removed.push(item);
  }

  return {
    hasBaseline: prev !== null,
    added,
    removed,
    changed,
    counts: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged,
    },
  };
}
