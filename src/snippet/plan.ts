// Resolves which AdaptationPlan (if any) to apply for this visitor. Two sources, in
// priority order:
//
//   1. Preview override — `window.__ANGEL_PREVIEW__`, set by a developer console or
//      the dashboard's preview mode. Lets a hand-authored plan run on the real site
//      with NO decision engine, which is exactly how we prove the loop end-to-end.
//   2. Served plan — GET /api/plan, the per-segment decision the server makes.
//
// Any failure resolves to null ⇒ the snippet stays observe-only and the page is
// untouched. Imports only types; no zod, no weight.

import type { AdaptationPlan, PlanResponse } from "./contract";

interface ResolveOpts {
  endpoint: string; // origin serving /api/plan (same as the ingest origin)
  siteKey: string;
  sessionId: string;
}

export async function resolvePlan(o: ResolveOpts): Promise<PlanResponse | null> {
  const preview = readPreview();
  if (preview) return preview;

  try {
    const u = new URL(o.endpoint + "/api/plan");
    u.searchParams.set("site", o.siteKey);
    u.searchParams.set("session", o.sessionId);
    const res = await fetch(u.toString(), { method: "GET", mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    return (await res.json()) as PlanResponse;
  } catch {
    return null; // network/parse failure ⇒ no adaptation
  }
}

// Accepts either a full PlanResponse ({ plan, content }) or a bare AdaptationPlan
// for convenience when poking from the console.
function readPreview(): PlanResponse | null {
  try {
    const g = window as unknown as { __ANGEL_PREVIEW__?: PlanResponse | AdaptationPlan };
    const v = g.__ANGEL_PREVIEW__;
    if (!v) return null;
    return "plan" in v ? v : { plan: v, content: {} };
  } catch {
    return null;
  }
}
