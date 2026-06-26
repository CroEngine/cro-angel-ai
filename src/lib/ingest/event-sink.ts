// The swappable storage seam for the visitor-event firehose. The /api/ingest
// route depends ONLY on this interface, so the storage engine can move from
// Supabase (v1) to Cloudflare Analytics Engine (M6) without touching the snippet
// or the public API contract.
//
// See docs/ARCHITECTURE.md §4.

import type { IngestEvent } from "@/snippet/contract";

// Geo + network context derived SERVER-SIDE from the edge request (never sent by
// the snippet). On Cloudflare this comes from `request.cf`; values are coarse.
export interface RequestGeo {
  country?: string;
  region?: string;
  city?: string;
}

// A fully-resolved event ready to persist: the wire event plus the server-resolved
// identity + timestamp the ingest route attaches before handing it to the sink.
export interface ResolvedEvent extends IngestEvent {
  siteId: string;
  visitorId: string;
  sessionId: string;
  receivedAt: number; // server epoch ms
}

// The single seam every storage backend implements. v1 is SupabaseEventSink (a
// batched multi-row insert via supabaseAdmin); M6 swaps in an Analytics Engine
// implementation behind the same interface.
export interface EventSink {
  writeBatch(events: ResolvedEvent[], geo: RequestGeo): Promise<void>;
}
