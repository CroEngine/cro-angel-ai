// Angel Adaptive — visitor snippet (Learn Mode / M1).
//
// Install once:
//   <script src="https://cdn.angeladaptive.ai/v1/script.js" data-site-id="…" async></script>
//
// This build OBSERVES ONLY — it never mutates the DOM (adaptation arrives at M4).
// The customer's original site is never changed; nothing here writes to the page.

import { Beacon } from "./beacon";
import { resolveConsent } from "./consent";
import { collectSignals, observeBehavior } from "./signals";
import { resolveIdentity } from "./visitor";

// Capture our own <script> tag synchronously — currentScript is null later (in
// async callbacks / after load). Fall back to querying for the data-site-id tag.
const SELF: HTMLScriptElement | null = (() => {
  const cs = document.currentScript as HTMLScriptElement | null;
  if (cs && cs.dataset && cs.dataset.siteId) return cs;
  const tags = document.querySelectorAll<HTMLScriptElement>("script[data-site-id]");
  return tags.length ? tags[tags.length - 1] : null;
})();

function apiBase(script: HTMLScriptElement): string {
  const override = script.dataset.api;
  if (override) return override.replace(/\/$/, "");
  try {
    return new URL(script.src).origin;
  } catch {
    return "";
  }
}

async function boot(): Promise<void> {
  const siteKey = SELF?.dataset.siteId;
  if (!SELF || !siteKey) return; // nothing to do without a site id

  const endpoint = apiBase(SELF) + "/api/ingest";

  const consent = await resolveConsent();
  const id = resolveIdentity(consent.persist);
  const sig = collectSignals(id.returning);

  const beacon = new Beacon({
    endpoint,
    siteKey,
    visitorKey: id.visitorKey,
    sessionId: id.sessionId,
    sig,
  });

  beacon.push({ type: "page_view", ts: Date.now(), url: location.href });

  const stop = observeBehavior((e) => beacon.push(e));

  const finalize = () => {
    stop();
    beacon.push({ type: "exit", ts: Date.now(), url: location.href });
    beacon.flush(true);
  };
  window.addEventListener("pagehide", finalize, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") beacon.flush(true);
  });
}

// Defer to after parse so we never compete with the page's own load work.
const start = () => void boot();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
