// The shared contract between the Angel Adaptive snippet (browser) and the
// server. This is the ONLY module imported by both the snippet build and the
// Worker/server code.
//
// IMPORTANT: the snippet must stay tiny (< 30 KB gzip), so it imports ONLY TYPES
// from this file (`import type { … }`) — zod is never pulled into the snippet
// bundle. The server imports the runtime schemas for validation.

import { z } from "zod";

/* ─────────────────────────────  ingestion wire format  ─────────────────────── */

// A single behavioral event as the snippet emits it. Kept compact; the server
// stamps received_at + geo. `selector` keys element-scoped events to the content
// inventory; `value` carries scroll %, dwell ms, etc.
export const IngestEventSchema = z.object({
  type: z.enum(["page_view", "scroll", "cta_click", "hover", "exit", "plan_stale"]),
  ts: z.number(), // client epoch ms
  url: z.string(),
  selector: z.string().optional(),
  value: z.number().optional(),
});
export type IngestEvent = z.infer<typeof IngestEventSchema>;
export type IngestEventType = IngestEvent["type"];

// Per-session acquisition context — sent once per batch, cheap. Geo is NOT here:
// it is derived server-side from the edge request, never sent by the snippet.
export const VisitorSignalsSchema = z.object({
  referrer: z.string().optional(),
  utm: z.record(z.string()).optional(),
  language: z.string().optional(),
  screenW: z.number().optional(),
  screenH: z.number().optional(),
  viewportW: z.number().optional(),
  viewportH: z.number().optional(),
  tzOffset: z.number().optional(),
  returning: z.boolean().optional(),
  userAgent: z.string().optional(), // parsed server-side into device/browser/os
});
export type VisitorSignals = z.infer<typeof VisitorSignalsSchema>;

// One batch POSTed to /api/ingest.
export const IngestBatchSchema = z.object({
  siteKey: z.string().min(1), // the public data-site-id
  visitorKey: z.string().min(1), // pseudonymous first-party id (hashed server-side)
  sessionId: z.string().min(1),
  sig: VisitorSignalsSchema.optional(),
  events: z.array(IngestEventSchema).max(200),
});
export type IngestBatch = z.infer<typeof IngestBatchSchema>;

/* ───────────────────────────  safe-adaptation contract  ────────────────────── */
// Used from M4. Defined now because it is the structural guarantee that Angel can
// never invent content — every op only rearranges/reveals elements PROVEN to exist
// in the content inventory. There is no opcode that accepts arbitrary HTML or free
// text: microcopy can only point at recorded inventory text by id. The snippet
// interpreter will consume exactly this shape.

const InventoryRef = z.object({
  selector: z.string().min(1), // single-match, from buildSelector()
  inventoryId: z.string().uuid().optional(), // ties the op to a proven content row
});

export const AdaptationOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reorderSections"), order: z.array(z.string().min(1)).min(2) }),
  z.object({ op: z.literal("showElement"), ...InventoryRef.shape }),
  z.object({ op: z.literal("hideElement"), ...InventoryRef.shape }),
  z.object({
    op: z.literal("moveElement"),
    ...InventoryRef.shape,
    position: z.enum(["before", "after"]),
    anchorSelector: z.string().min(1),
  }),
  z.object({
    op: z.literal("emphasizeCta"),
    ...InventoryRef.shape,
    style: z.enum(["emphasize", "sticky", "primary-swap"]),
  }),
  z.object({
    op: z.literal("switchCta"),
    fromSelector: z.string().min(1),
    toInventoryId: z.string().uuid(),
  }),
  z.object({
    op: z.literal("swapImage"),
    selector: z.string().min(1),
    toInventoryId: z.string().uuid(),
  }),
  z.object({ op: z.literal("reorderNav"), order: z.array(z.string().min(1)).min(2) }),
  z.object({
    op: z.literal("showMicrocopy"),
    slotSelector: z.string().min(1),
    fromInventoryId: z.string().uuid(),
  }),
]);
export type AdaptationOp = z.infer<typeof AdaptationOpSchema>;

export const AdaptationPlanSchema = z.object({
  planId: z.string(),
  siteId: z.string().uuid(),
  segmentId: z.string().uuid(),
  extractorVersion: z.string(), // must match the current inventory snapshot to be served
  ops: z.array(AdaptationOpSchema).max(12), // bounded — small, reviewable plans only
  fallback: z.literal("noop").default("noop"),
});
export type AdaptationPlan = z.infer<typeof AdaptationPlanSchema>;
