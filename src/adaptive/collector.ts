// Angel Adaptive — collector client (the snippet's "send data" half).
//
// Ships the Content Inventory (once per crawl) and behavior events (batched, on
// page-hide) to the collector Edge Function configured via data-endpoint. All
// best-effort and non-blocking: a dead/missing endpoint never affects the host
// page. Identity is pseudonymous and first-party only — a random visitor key in
// localStorage + a per-tab session id in sessionStorage; no third-party cookies,
// no PII.

import type { ContentInventory } from "./inventory";
import type { BehaviorEvent } from "./behavior";

const VK_KEY = "__angel_vk";
const SID_KEY = "__angel_sid";

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for older browsers / non-secure contexts.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

// Read-or-create a stable id in web storage; falls back to an ephemeral id when
// storage is unavailable (private mode, blocked) so collection still degrades
// gracefully instead of throwing.
function stableId(key: string, store: Storage): string {
  try {
    let v = store.getItem(key);
    if (!v) {
      v = uuid();
      store.setItem(key, v);
    }
    return v;
  } catch {
    return uuid();
  }
}

export function visitorKey(): string {
  return stableId(VK_KEY, window.localStorage);
}
export function sessionId(): string {
  return stableId(SID_KEY, window.sessionStorage);
}

type CollectBody = {
  siteId: string;
  v: string;
  url: string;
  visitorKey: string;
  sessionId: string;
  inventory?: ContentInventory;
  events?: BehaviorEvent[];
};

// Keepalive POST — used for the inventory (sent while the page is alive).
export function postJson(endpoint: string, body: CollectBody): void {
  try {
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {
      /* best-effort */
    });
  } catch {
    /* ignore */
  }
}

// Beacon — survives page unload, which keepalive fetch can miss. Falls back to a
// keepalive POST if sendBeacon is unavailable or refuses (payload too large).
function beacon(endpoint: string, body: CollectBody): void {
  try {
    const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(endpoint, blob)) return;
  } catch {
    /* fall through */
  }
  postJson(endpoint, body);
}

type Ident = {
  endpoint: string;
  siteId: string;
  version: string;
  visitorKey: string;
  sessionId: string;
};

/** POST the inventory snapshot for the current URL. */
export function sendInventory(id: Ident, inventory: ContentInventory): void {
  postJson(id.endpoint, {
    siteId: id.siteId,
    v: id.version,
    url: location.href,
    visitorKey: id.visitorKey,
    sessionId: id.sessionId,
    inventory,
  });
}

/**
 * Flush behavior events to the collector on page-hide. Only the events not yet
 * sent are shipped (tracked by a high-water mark), so re-fires don't duplicate.
 * Returns a stop() that removes the listeners.
 */
export function installEventCollector(id: Ident, getEvents: () => BehaviorEvent[]): () => void {
  let sent = 0;
  const flush = () => {
    const all = getEvents();
    if (all.length <= sent) return;
    const batch = all.slice(sent);
    sent = all.length;
    beacon(id.endpoint, {
      siteId: id.siteId,
      v: id.version,
      url: location.href,
      visitorKey: id.visitorKey,
      sessionId: id.sessionId,
      events: batch,
    });
  };
  const onVis = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", flush);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", flush);
  };
}
