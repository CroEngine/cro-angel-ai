// Ingestion service: resolve the site by its public key, upsert the visitor and
// session dimensions, then write the behavioral events through the EventSink.
// Unauthenticated (the snippet calls it from arbitrary origins); it authenticates
// by public_site_key + an optional origin allow-list, and writes via the
// service-role admin client (bypasses RLS).

import type { IngestBatch } from "@/snippet/contract";

import { db, type SessionInsert } from "./db-bridge.server";
import type { EventSink, RequestGeo, ResolvedEvent } from "./event-sink";
import { parseUserAgent } from "./ua";

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

// The snippet session id is 32 hex chars (16 random bytes); format it as a uuid so
// it can be the sessions.id PK — making the upsert idempotent across batches.
function toUuid(raw: string): string {
  const h = raw
    .replace(/[^0-9a-f]/gi, "")
    .toLowerCase()
    .padEnd(32, "0")
    .slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Pseudonymise the client's first-party id before storage (salted per site).
async function hashVisitorKey(siteId: string, key: string): Promise<string> {
  const data = new TextEncoder().encode(`${siteId}:${key}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function deriveSource(referrer?: string, utm?: Record<string, string>): string {
  if (utm?.source) return utm.source.toLowerCase();
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (/google\./.test(host)) return "google_organic";
    if (/linkedin\./.test(host)) return "linkedin";
    if (/facebook\.|fb\./.test(host)) return "facebook";
    if (/t\.co|twitter\.|x\.com/.test(host)) return "twitter";
    if (/bing\./.test(host)) return "bing";
    if (/duckduckgo\./.test(host)) return "duckduckgo";
    return host;
  } catch {
    return "direct";
  }
}

export async function ingestBatch(
  batch: IngestBatch,
  geo: RequestGeo,
  origin: string | null,
  sink: EventSink,
): Promise<void> {
  // 1. Resolve the site by its public key.
  const { data: site, error: siteErr } = await db
    .from("sites")
    .select("id, allowed_origins")
    .eq("public_site_key", batch.siteKey)
    .maybeSingle();
  if (siteErr) throw new IngestError("site lookup failed", 500);
  if (!site) throw new IngestError("unknown site key", 404);

  // 2. Origin allow-list (empty list = allow any, e.g. local dev).
  if (origin && site.allowed_origins.length > 0 && !site.allowed_origins.includes(origin)) {
    throw new IngestError("origin not allowed", 403);
  }

  // 3. Upsert the visitor (pseudonymous key) and get its id.
  const visitorKey = await hashVisitorKey(site.id, batch.visitorKey);
  const { data: visitor, error: vErr } = await db
    .from("visitors")
    .upsert(
      { site_id: site.id, visitor_key: visitorKey, last_seen_at: new Date().toISOString() },
      { onConflict: "site_id,visitor_key" },
    )
    .select("id")
    .single();
  if (vErr || !visitor) throw new IngestError("visitor upsert failed", 500);

  // 4. Upsert the session. Dimension fields are set only on the sig-bearing batch
  //    (the first flush); later batches keep them (partial upsert never nulls them).
  const sessionId = toUuid(batch.sessionId);
  const sessionRow: SessionInsert = {
    id: sessionId,
    site_id: site.id,
    visitor_id: visitor.id,
  };
  if (batch.sig) {
    sessionRow.device = parseUserAgent(batch.sig.userAgent) as unknown as SessionInsert["device"];
    sessionRow.geo = geo as unknown as SessionInsert["geo"];
    sessionRow.language = batch.sig.language ?? null;
    sessionRow.utm = batch.sig.utm ?? null;
    sessionRow.source = deriveSource(batch.sig.referrer, batch.sig.utm);
    const firstView = batch.events.find((e) => e.type === "page_view");
    if (firstView) sessionRow.entry_url = firstView.url;
  }
  const { error: sErr } = await db.from("sessions").upsert(sessionRow, { onConflict: "id" });
  if (sErr) throw new IngestError("session upsert failed", 500);

  // 5. Write the events through the sink.
  const receivedAt = Date.now();
  const resolved: ResolvedEvent[] = batch.events.map((e) => ({
    ...e,
    siteId: site.id,
    visitorId: visitor.id,
    sessionId,
    receivedAt,
  }));
  await sink.writeBatch(resolved, geo);
}
