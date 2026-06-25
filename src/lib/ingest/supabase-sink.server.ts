// v1 EventSink: one batched multi-row insert into the events table via the
// service-role admin client. The firehose moves to Cloudflare Analytics Engine at
// M6 behind this same interface — see docs/ARCHITECTURE.md §4. Geo lives on the
// session (written by the ingest service), so this sink ignores it for now.

import { db, type EventInsert } from "./db-bridge.server";
import type { EventSink, RequestGeo, ResolvedEvent } from "./event-sink";

export class SupabaseEventSink implements EventSink {
  async writeBatch(events: ResolvedEvent[], _geo: RequestGeo): Promise<void> {
    if (events.length === 0) return;

    const rows: EventInsert[] = events.map((e) => ({
      site_id: e.siteId,
      visitor_id: e.visitorId,
      session_id: e.sessionId,
      type: e.type,
      url: e.url,
      selector: e.selector ?? null,
      value: e.value ?? null,
      client_ts: new Date(e.ts).toISOString(),
      received_at: new Date(e.receivedAt).toISOString(),
    }));

    const { error } = await db.from("events").insert(rows);
    if (error) throw new Error(`event insert failed: ${error.message}`);
  }
}
