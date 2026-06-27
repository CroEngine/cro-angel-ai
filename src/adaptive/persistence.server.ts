// Angel Adaptive — best-effort event persistence (server only).
//
// The schema lives in supabase/migrations/*_adaptive_core.sql but is not yet
// reflected in the generated Supabase `Database` types (the migration is pending
// approval in Lovable Cloud). Until then we reach the tables through a minimal
// local contract and cast once, here. Every write is best-effort: if the tables
// or the service-role key are missing, we log and continue. The adaptive loop
// (snippet -> decide -> patterns) never depends on persistence succeeding.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AngelEvent, VisitorContext } from "./types";

interface InsertResult {
  error: { message: string } | null;
}
interface MinimalTable {
  insert(rows: unknown): Promise<InsertResult>;
}

// Single localized cast: the generated types don't know these tables yet.
function table(name: string): MinimalTable {
  return (supabaseAdmin as unknown as { from(n: string): MinimalTable }).from(name);
}

type EventRow = {
  site: string;
  type: string;
  decision_id: string | null;
  visitor_hash: string | null;
  payload: Record<string, unknown>;
};

/**
 * Persist a batch of analytics events. Returns the number stored, or 0 if the
 * store is unavailable. Never throws.
 */
export async function logEvents(
  site: string,
  visitorHash: string | null,
  events: AngelEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  const rows: EventRow[] = events.map((e) => ({
    site,
    type: e.type,
    decision_id: e.decisionId ?? null,
    visitor_hash: visitorHash,
    payload: e.payload ?? {},
  }));

  try {
    const { error } = await table("angel_events").insert(rows);
    if (error) {
      console.warn(`[angel] event persistence skipped: ${error.message}`);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn(`[angel] event persistence unavailable:`, err);
    return 0;
  }
}

/**
 * Record that a decision was made and which adaptations it produced. Stored as a
 * single `decision` event so the dashboard can reconstruct "Live Adaptations"
 * without a second table. Best-effort.
 */
export async function logDecision(
  site: string,
  decisionId: string,
  context: VisitorContext,
  patterns: string[],
): Promise<void> {
  await logEvents(site, null, [
    {
      type: "adaptation_shown",
      decisionId,
      payload: {
        patterns,
        trafficSource: context.trafficSource,
        device: context.device,
        isReturning: context.isReturning,
      },
    },
  ]);
}
