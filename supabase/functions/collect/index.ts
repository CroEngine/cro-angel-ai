// Angel Adaptive — collector Edge Function (the "samlar vi data" backend).
//
// Receives the snippet's POST (content inventory + behavior events) and persists
// it to the M0/M2 schema: resolves the site by its public key, upserts the
// pseudonymous visitor + session, flattens the inventory into content_inventory
// rows, and appends behavior events. Public, anonymous, cross-origin — gated by
// the site's allowed_origins; all writes go through the service-role client
// (events are service-role-only by design).
//
// Deploy: supabase functions deploy collect --no-verify-jwt   (it must accept
// anonymous cross-origin POSTs from the customer's site, so JWT is off — the
// Origin allowlist + public_site_key are the gate). Requires the M0 + M2
// migrations applied to the target project. SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// POST body (application/json):
//   { siteId, v, visitorKey, sessionId, url, inventory?, events? }
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, any>;

interface Body {
  siteId?: string;
  v?: string;
  visitorKey?: string;
  sessionId?: string;
  url?: string;
  inventory?: Json | null;
  events?: Array<{
    type: string;
    ts?: number;
    url?: string;
    selector?: string;
    text?: string;
    value?: number;
  }> | null;
}

const corsHeaders = (origin: string): HeadersInit => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const noContent = (origin: string) => new Response(null, { status: 204, headers: corsHeaders(origin) });

// A uuid-ish guard so a malicious client can't smuggle SQL/odd ids into uuid cols.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s?: string): s is string => !!s && UUID_RX.test(s);

// Flatten the snippet's ContentInventory into content_inventory rows. Only items
// with a stable selector are persisted (the table keys on it); hero/meta without
// a selector are skipped — they live on the events/session context instead.
function flattenInventory(inv: Json, url: string, version?: string): Json[] {
  const rows: Json[] = [];
  const push = (category: string, item: Json, extra: Json = {}) => {
    if (!item || !item.selector) return;
    rows.push({
      url,
      category,
      selector: String(item.selector).slice(0, 1024),
      text: item.text ? String(item.text).slice(0, 2000) : null,
      rect: item.rect ?? null,
      section_kind: item.section ?? item.type ?? null,
      above_fold: typeof item.aboveFold === "boolean" ? item.aboveFold : null,
      attrs: Object.keys(extra).length ? extra : null,
      extractor_version: version ?? null,
    });
  };

  for (const c of inv.ctas ?? []) {
    push("cta", c, { intent: c.intent, category: c.category, href: c.href ?? null });
  }
  const trust = inv.trust ?? {};
  for (const key of Object.keys(trust)) {
    const arr = (trust as Json)[key];
    if (!Array.isArray(arr)) continue; // skip total/byType scalars
    for (const s of arr) {
      push(s.type || key, s, {
        rating: s.rating,
        reviewCount: s.reviewCount,
        logoCount: s.logoCount,
        company: s.company,
        personName: s.personName,
      });
    }
  }
  for (const sec of inv.sections ?? []) {
    push("section", { ...sec, text: sec.heading }, { sectionType: sec.type });
  }
  // De-dupe within the payload on the table's unique key so the upsert doesn't
  // hit "cannot affect row a second time".
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.url}|${r.selector}|${r.category}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return noContent(origin);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return noContent(origin); // never leak parse errors to the host page
  }
  const { siteId, v, visitorKey, sessionId, url, inventory, events } = body;
  if (!siteId || !url) return noContent(origin);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    // 1. Resolve the site by its public key. Unknown key → silently ignore (204)
    //    so the endpoint can't be probed for valid site ids.
    const { data: site } = await admin
      .from("sites")
      .select("id, allowed_origins")
      .eq("public_site_key", siteId)
      .maybeSingle();
    if (!site) return noContent(origin);

    // 2. Origin allowlist. Empty allowlist = accept any (dev/first-install);
    //    once configured, the Origin must match.
    const allowed: string[] = site.allowed_origins ?? [];
    if (allowed.length && origin && !allowed.includes(origin)) return noContent(origin);

    const siteUuid = site.id as string;

    // 3. Upsert the visitor (pseudonymous, keyed by the first-party visitorKey).
    let visitorUuid: string | null = null;
    if (visitorKey) {
      const { data: vis } = await admin
        .from("visitors")
        .upsert(
          { site_id: siteUuid, visitor_key: String(visitorKey).slice(0, 128), last_seen_at: new Date().toISOString() },
          { onConflict: "site_id,visitor_key" },
        )
        .select("id")
        .maybeSingle();
      visitorUuid = vis?.id ?? null;
    }

    // 4. Upsert the session (client generates the uuid; insert-once). A session
    //    row needs a visitor (FK), so it only exists when both are present —
    //    events below reference session_id only when this held, to avoid a
    //    dangling FK.
    const sessUuid = isUuid(sessionId) ? sessionId : null;
    const sessionOk = !!(sessUuid && visitorUuid);
    if (sessionOk) {
      await admin
        .from("sessions")
        .upsert(
          { id: sessUuid, site_id: siteUuid, visitor_id: visitorUuid, entry_url: url },
          { onConflict: "id", ignoreDuplicates: true },
        );
    }

    // 5. Inventory → a crawl_run + content_inventory rows (upsert per item).
    if (inventory && typeof inventory === "object") {
      const { data: run } = await admin
        .from("crawl_runs")
        .insert({ site_id: siteUuid, status: "done", pages_crawled: 1, extractor_version: v, finished_at: new Date().toISOString() })
        .select("id")
        .maybeSingle();
      const rows = flattenInventory(inventory as Json, String(url), v).map((r) => ({
        ...r,
        site_id: siteUuid,
        crawl_run_id: run?.id ?? null,
        last_seen_at: new Date().toISOString(),
      }));
      if (rows.length) {
        await admin
          .from("content_inventory")
          .upsert(rows, { onConflict: "site_id,url,selector,category" });
      }
    }

    // 6. Behavior events → the firehose.
    if (Array.isArray(events) && events.length) {
      const rows = events.slice(0, 200).map((e) => ({
        site_id: siteUuid,
        visitor_id: visitorUuid,
        session_id: sessionOk ? sessUuid : null,
        type: String(e.type || "unknown").slice(0, 64),
        url: e.url ? String(e.url).slice(0, 2048) : String(url),
        selector: e.selector ? String(e.selector).slice(0, 1024) : null,
        value: typeof e.value === "number" ? e.value : null,
        client_ts: e.ts ? new Date(e.ts).toISOString() : null,
        ctx: e.text ? { text: String(e.text).slice(0, 500) } : null,
      }));
      await admin.from("events").insert(rows);
    }

    return noContent(origin);
  } catch (err) {
    console.error("[collect] error:", err instanceof Error ? err.message : err);
    // Still 204: the snippet must never see a 500 that could surface on the host.
    return noContent(origin);
  }
});
