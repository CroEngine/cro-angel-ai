// Acquisition signals (gathered once) + behavior listeners (streamed as events).
// Geo is NOT collected here — it is derived server-side from the edge request.

import type { IngestEvent, VisitorSignals } from "./contract";

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;

export function collectSignals(returning: boolean): VisitorSignals {
  const params = new URLSearchParams(location.search);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params.get("utm_" + k);
    if (v) utm[k] = v;
  }
  return {
    referrer: document.referrer || undefined,
    utm: Object.keys(utm).length ? utm : undefined,
    language: navigator.language,
    screenW: screen.width,
    screenH: screen.height,
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    tzOffset: new Date().getTimezoneOffset(),
    returning,
    userAgent: navigator.userAgent, // parsed server-side into device/browser/os
  };
}

// Wire up behavior listeners; each pushes a compact event via `emit`. Returns a
// teardown fn. Scroll depth is rAF-throttled and only emitted when it advances.
export function observeBehavior(emit: (e: IngestEvent) => void): () => void {
  const now = () => Date.now();
  let maxScroll = 0;
  let scrollQueued = false;

  const onScroll = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(() => {
      scrollQueued = false;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const pct = scrollable > 0 ? Math.round((window.scrollY / scrollable) * 100) : 0;
      if (pct > maxScroll) {
        maxScroll = pct;
        emit({ type: "scroll", ts: now(), url: location.href, value: pct });
      }
    });
  };

  const onClick = (ev: MouseEvent) => {
    const target = ev.target as Element | null;
    const el = target ? target.closest("a,button,[role=button]") : null;
    if (!el) return;
    emit({ type: "cta_click", ts: now(), url: location.href, selector: describe(el) });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", onClick, { capture: true });

  return () => {
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("click", onClick, true);
  };
}

// A cheap, stable-ish element descriptor (id / data-testid / tag.class). The
// server reconciles this against the content inventory's buildSelector() ids.
function describe(el: Element): string {
  if (el.id) return "#" + el.id;
  const tid = el.getAttribute("data-testid");
  if (tid) return "[data-testid='" + tid + "']";
  const tag = el.tagName.toLowerCase();
  const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return cls.length ? tag + "." + cls.join(".") : tag;
}
