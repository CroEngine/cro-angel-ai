// Angel Adaptive — behavior tracking (the "collect data" half of learn-mode).
//
// Passive, read-only instrumentation: pageview, max scroll depth, clicks on the
// DETECTED CTAs, and engagement/time on the page. It never blocks or changes the
// page. Events buffer in memory (exposed on window.__angelAdaptive.events) and,
// once the collector exists, get POSTed to the backend — together with the
// content inventory they become the "CRO-bank" the decision engine reads.

import type { ContentInventory } from "./inventory";

export type BehaviorEvent = {
  type: "pageview" | "cta_click" | "scroll_depth" | "time_on_page" | "form_submit" | "goal";
  ts: number;
  url: string;
  selector?: string;
  text?: string;
  value?: number; // scroll %, or ms on page
};

// Owner-declared goal (v0.12): what THIS site counts as conversion, straight
// on the script tag — a click target (data-goal-click) and/or a thank-you
// URL substring (data-goal-url). URL goals match at page load, which covers
// classic thank-you pages; SPA checkouts should use the click form.
export type GoalConfig = {
  clickSelector?: string | null;
  urlPattern?: string | null;
};

export type BehaviorTracker = {
  events: BehaviorEvent[];
  stop: () => void;
};

/**
 * Start passive behavior tracking for the current page. Returns the live event
 * buffer and a stop() that removes all listeners. Never throws into the host.
 */
export function trackBehavior(
  inv: ContentInventory,
  onEvent?: (e: BehaviorEvent) => void,
  goal?: GoalConfig,
): BehaviorTracker {
  const events: BehaviorEvent[] = [];
  const url = location.href;
  const started = Date.now();
  const emit = (e: BehaviorEvent) => {
    events.push(e);
    if (onEvent) {
      try {
        onEvent(e);
      } catch {
        /* a sink error must never reach the host page */
      }
    }
  };

  emit({ type: "pageview", ts: started, url });

  // Max scroll depth (% of scrollable height).
  let maxScroll = 0;
  const onScroll = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const pct =
      scrollable > 0 ? Math.min(100, Math.round((window.scrollY / scrollable) * 100)) : 100;
    if (pct > maxScroll) maxScroll = pct;
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  // Clicks on detected CTAs. Resolve the elements once, then match by containment.
  const ctaEls: Array<{ el: Element; selector: string; text: string }> = [];
  for (const c of inv.ctas) {
    if (!c.selector) continue;
    try {
      const el = document.querySelector(c.selector);
      if (el) ctaEls.push({ el, selector: c.selector, text: c.text });
    } catch {
      /* bad selector — skip */
    }
  }
  // Owner-declared goal, click form: any click landing inside a match emits
  // one `goal` per pageview. Selector failures are the site's typo, never an
  // error into the host page.
  let goalHit = false;
  const goalSelector = goal?.clickSelector || null;
  const onClick = (ev: Event) => {
    const target = ev.target as Node | null;
    if (!target) return;
    for (const c of ctaEls) {
      if (c.el === target || c.el.contains(target)) {
        emit({ type: "cta_click", ts: Date.now(), url, selector: c.selector, text: c.text });
        break;
      }
    }
    if (goalSelector && !goalHit && target instanceof Element) {
      try {
        const hit = target.closest(goalSelector);
        if (hit) {
          goalHit = true;
          emit({ type: "goal", ts: Date.now(), url, selector: goalSelector });
        }
      } catch {
        /* invalid selector — ignore */
      }
    }
  };
  document.addEventListener("click", onClick, true);

  // Owner-declared goal, URL form: the thank-you page itself IS the goal.
  if (goal?.urlPattern && url.indexOf(goal.urlPattern) !== -1) {
    goalHit = true;
    emit({ type: "goal", ts: started, url, text: goal.urlPattern });
  }

  // Form submits (leadgen's primary metric): passive capture listener, one
  // event per submitted form element.
  const submittedForms = new Set<EventTarget>();
  const onSubmit = (ev: Event) => {
    const form = ev.target;
    if (!form || submittedForms.has(form)) return;
    submittedForms.add(form);
    emit({ type: "form_submit", ts: Date.now(), url });
  };
  document.addEventListener("submit", onSubmit, true);

  // Flush engagement (scroll depth + time) when the page is hidden/unloaded.
  let flushed = false;
  const flush = () => {
    if (flushed) return;
    flushed = true;
    emit({ type: "scroll_depth", ts: Date.now(), url, value: maxScroll });
    emit({ type: "time_on_page", ts: Date.now(), url, value: Date.now() - started });
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", flush);

  return {
    events,
    stop: () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    },
  };
}
