// "What Angel is doing" — the owner-facing view of the decision engine. For each
// segment it runs the SAME buildPlan() the live /api/plan uses, and returns the
// plan it would serve plus the plain-language rationale. Read-only and RLS-scoped:
// this explains Angel's decisions, it never applies them. The plan+content is also
// returned so the dashboard can let the owner PREVIEW it on their real site.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildPlan,
  type RawInventoryRow,
  segmentUuid,
  toInventoryRows,
} from "@/lib/adapt/decision";
import { aggregateSegments, type SessionLite } from "@/lib/segments/aggregate";
import type { AdaptationOp, PlanResponse } from "@/snippet/contract";

const MIN_SEGMENT_SESSIONS = 20; // mirror the dashboard's "don't characterise" gate
const SITE_LEARNING_THRESHOLD = 200;

export type DecisionStatus = "adapt" | "healthy" | "thin";

export interface OpSummary {
  kind: string; // short verb, e.g. "Emphasize CTA"
  detail: string; // the specific target
}

export interface SegmentDecision {
  source: string;
  label: string;
  sessions: number;
  share: number;
  bounceRate: number | null;
  avgScrollPct: number | null;
  status: DecisionStatus;
  rationale: string[]; // why Angel would act — empty unless status === "adapt"
  ops: OpSummary[]; // what it would do
  preview: PlanResponse | null; // the plan+content to inject when previewing
}

export interface AdaptationsOverview {
  totalSessions: number;
  learning: boolean;
  inventoryCount: number; // 0 ⇒ owner must crawl before Angel can adapt anything
  segments: SegmentDecision[];
}

// Human-readable one-liner per op (the "what"); the rationale carries the "why".
function summarize(op: AdaptationOp): OpSummary {
  switch (op.op) {
    case "emphasizeCta":
      return {
        kind: op.style === "sticky" ? "Pin CTA" : "Emphasize CTA",
        detail: op.selector,
      };
    case "moveElement":
      return { kind: "Move", detail: `${op.selector} → ${op.position} ${op.anchorSelector}` };
    case "reorderSections":
      return { kind: "Reorder sections", detail: op.order.join(" → ") };
    case "reorderNav":
      return { kind: "Reorder nav", detail: op.order.join(" → ") };
    case "showElement":
      return { kind: "Reveal", detail: op.selector };
    case "hideElement":
      return { kind: "Hide", detail: op.selector };
    case "switchCta":
      return { kind: "Swap CTA copy", detail: op.fromSelector };
    case "swapImage":
      return { kind: "Swap image", detail: op.selector };
    case "showMicrocopy":
      return { kind: "Add microcopy", detail: op.slotSelector };
  }
}

export const getAdaptations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { siteId: string; days?: number }) =>
    z
      .object({ siteId: z.string().uuid(), days: z.number().int().min(1).max(90).optional() })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<AdaptationsOverview> => {
    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [sessionsRes, invRes] = await Promise.all([
      context.supabase
        .from("sessions")
        .select("source, visitor_id, bounced, max_scroll_pct, duration_ms")
        .eq("site_id", data.siteId)
        .gte("started_at", since)
        .limit(20_000),
      context.supabase
        .from("content_inventory")
        .select(
          "id, category, selector, text, section_kind, above_fold, visual_weight, extractor_version, rect",
        )
        .eq("site_id", data.siteId)
        .limit(2000),
    ]);
    if (sessionsRes.error) throw new Error(sessionsRes.error.message);
    if (invRes.error) throw new Error(invRes.error.message);

    const invRows = invRes.data ?? [];
    const inventory = toInventoryRows(invRows as RawInventoryRow[]);
    const extractorVersion = invRows[0]?.extractor_version ?? "0";

    const { totalSessions, baseline, segments } = aggregateSegments(
      (sessionsRes.data ?? []) as SessionLite[],
    );

    const decisions: SegmentDecision[] = segments.map((seg) => {
      const base = {
        source: seg.source,
        label: seg.label,
        sessions: seg.sessions,
        share: seg.share,
        bounceRate: seg.bounceRate,
        avgScrollPct: seg.avgScrollPct,
      };

      if (seg.sessions < MIN_SEGMENT_SESSIONS) {
        return { ...base, status: "thin", rationale: [], ops: [], preview: null };
      }

      const built =
        inventory.length > 0
          ? buildPlan({
              siteId: data.siteId,
              segmentId: segmentUuid(data.siteId, seg.source),
              extractorVersion,
              segment: seg,
              baseline,
              inventory,
            })
          : null;

      if (!built) {
        return { ...base, status: "healthy", rationale: [], ops: [], preview: null };
      }
      return {
        ...base,
        status: "adapt",
        rationale: built.rationale,
        ops: built.plan.ops.map(summarize),
        preview: { plan: built.plan, content: built.content },
      };
    });

    return {
      totalSessions,
      learning: totalSessions < SITE_LEARNING_THRESHOLD,
      inventoryCount: inventory.length,
      segments: decisions,
    };
  });
