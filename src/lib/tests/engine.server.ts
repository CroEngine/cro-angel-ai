// Stagehand-based step engine. Runs against an already-created Browserbase session.

import { Stagehand } from "@browserbasehq/stagehand";

export type Step =
  | { kind: "goto"; url: string }
  | { kind: "wait"; ms: number }
  | { kind: "assertText"; text: string }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "act"; instruction: string }
  | { kind: "extract"; instruction: string }
  | { kind: "observe"; instruction: string }
  | { kind: "collect"; target: CollectTarget };

export type CollectTarget = "buttons";

export type CollectedElement = {
  text: string;
  tagName: string;
  selector: string;
  href: string | null;
  disabled: boolean;
  visible: boolean;
  aboveFold: boolean;
  rect: { x: number; y: number; w: number; h: number };
  attributes: Record<string, string>;
  computedStyles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    padding: string;
    borderRadius: string;
    border: string;
    cursor: string;
    display: string;
  };
};

export type EngineEvent =
  | { type: "step_started"; index: number; kind: Step["kind"]; summary: string }
  | { type: "step_passed"; index: number; kind: Step["kind"]; summary: string; durationMs: number; data?: unknown }
  | { type: "step_failed"; index: number; kind: Step["kind"]; summary: string; durationMs: number; error: string }
  | { type: "log"; message: string };

function summarize(step: Step): string {
  switch (step.kind) {
    case "goto": return `goto ${step.url}`;
    case "wait": return `wait ${step.ms}ms`;
    case "assertText": return `assertText "${step.text}"`;
    case "click": return `click ${step.selector}`;
    case "fill": return `fill ${step.selector} = "${step.value}"`;
    case "act": return `act "${step.instruction}"`;
    case "extract": return `extract "${step.instruction}"`;
    case "observe": return `observe "${step.instruction}"`;
    case "collect": return `collect ${step.target}`;
  }
}

export async function runSteps(
  sessionId: string,
  steps: Step[],
  opts: { onEvent: (e: EngineEvent) => void; signal?: AbortSignal },
): Promise<{ passed: number; failed: number; aborted: boolean }> {
  const { onEvent, signal } = opts;
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY missing");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID missing");

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: sessionId,
    // keepAlive: stagehand.close() should disconnect Stagehand only,
    // not terminate the Browserbase session — the session lives on so the
    // live iframe can keep showing the collect overlay until closeSession()
    // in the orchestrator's terminate() callback runs.
    keepAlive: true,
  });

  let passed = 0;
  let failed = 0;
  let aborted = false;
  let initialized = false;
  let crashed = false;

  try {
    await stagehand.init();
    initialized = true;

    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) { aborted = true; break; }

      const step = steps[i];
      const summary = summarize(step);
      const index = i + 1;
      onEvent({ type: "step_started", index, kind: step.kind, summary });
      const t0 = Date.now();

      try {
        const page = stagehand.context.pages()[0] ?? (await stagehand.context.newPage());
        let data: unknown = undefined;

        switch (step.kind) {
          case "goto": {
            const existing = stagehand.context.pages()[0];
            if (existing) await existing.goto(step.url);
            else await stagehand.context.newPage(step.url);
            break;
          }
          case "wait":
            await new Promise((res) => setTimeout(res, step.ms));
            break;
          case "assertText": {
            const deadline = Date.now() + 5000;
            const needle = step.text.toLowerCase();
            let found = false;
            while (Date.now() < deadline) {
              if (signal?.aborted) break;
              try {
                const text = await page.evaluate<string>(
                  "(document.body && document.body.innerText) || ''",
                );
                if (typeof text === "string" && text.toLowerCase().includes(needle)) {
                  found = true;
                  break;
                }
              } catch { /* retry */ }
              await new Promise((res) => setTimeout(res, 300));
            }
            if (!found) throw new Error(`text "${step.text}" not found within 5000ms`);
            break;
          }
          case "click":
          case "fill":
            throw new Error(`step kind "${step.kind}" not yet wired — use "act" instead`);
          case "act":
            data = await stagehand.act(step.instruction);
            break;
          case "extract":
            data = await stagehand.extract(step.instruction);
            break;
          case "observe":
            data = await stagehand.observe(step.instruction);
            break;
          case "collect": {
            const elements = await page.evaluate(COLLECT_SCRIPT);
            const all = elements as CollectedElement[];
            const filtered = filterCollected(all, step.target);
            // Draw overlay rectangles in the live page so the user sees what was collected.
            try {
              const selectors = filtered.map((el) => el.selector);
              await page.evaluate(`(${OVERLAY_FN.toString()})(${JSON.stringify(selectors)})`);
            } catch (e) {
              onEvent({ type: "log", message: `overlay failed: ${e instanceof Error ? e.message : String(e)}` });
            }
            data = { target: step.target, count: filtered.length, elements: filtered };
            onEvent({ type: "log", message: `collect ${step.target}: ${filtered.length} element(s)` });
            break;
          }
        }

        void page;

        passed++;
        onEvent({ type: "step_passed", index, kind: step.kind, summary, durationMs: Date.now() - t0, data });
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        onEvent({ type: "step_failed", index, kind: step.kind, summary, durationMs: Date.now() - t0, error: message });
        break; // stop on first failure
      }
    }
  } catch (err) {
    crashed = true;
    throw err;
  } finally {
    // Only disconnect Stagehand if init failed or the run crashed before the
    // orchestrator's hold/close window. Otherwise leave Stagehand attached so
    // the live-view CDP/WebSocket isn't torn down — closeSession(sessionId)
    // in the orchestrator is the single source of truth for ending the session.
    if (!initialized || crashed) {
      try { await stagehand.close(); } catch { /* ignore */ }
      onEvent({ type: "log", message: "stagehand closed (init/crash cleanup)" });
    } else {
      onEvent({ type: "log", message: "stagehand left attached — session ends via closeSession()" });
    }
  }

  return { passed, failed, aborted };
}


function filterCollected(all: CollectedElement[], target: CollectTarget): CollectedElement[] {
  if (target === "buttons") {
    return all.filter((el) =>
      el.tagName === "button" ||
      el.tagName === "input[type=submit]" ||
      el.tagName === "input[type=button]" ||
      el.tagName === "[role=button]"
    );
  }
  return all;
}

// Runs in the browser via page.evaluate — must be self-contained string.
const COLLECT_SCRIPT = `(() => {
  const SELECTOR = 'button, a[href], input[type=submit], input[type=button], [role="button"]';
  const out = [];
  const nodes = Array.from(document.querySelectorAll(SELECTOR));
  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    if (testId) return el.tagName.toLowerCase() + '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-') && a.value && a.value.length < 64) {
        return el.tagName.toLowerCase() + '[' + a.name + '="' + a.value.replace(/"/g, '\\\\"') + '"]';
      }
    }
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = same.indexOf(el) + 1;
      return el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
    }
    return el.tagName.toLowerCase();
  }
  function classify(el) {
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'submit') return 'input[type=submit]';
      if (t === 'button') return 'input[type=button]';
    }
    if (el.tagName === 'A') return 'a';
    if (el.tagName === 'BUTTON') return 'button';
    if ((el.getAttribute('role') || '').toLowerCase() === 'button') return '[role=button]';
    return el.tagName.toLowerCase();
  }
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    const attrs = {};
    for (const a of Array.from(el.attributes)) {
      attrs[a.name] = (a.value || '').slice(0, 200);
    }
    const cs = window.getComputedStyle(el);
    out.push({
      text,
      tagName: classify(el),
      selector: buildSelector(el),
      href: el.tagName === 'A' ? (el.getAttribute('href') || null) : null,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      visible: rect.width > 0 && rect.height > 0,
      aboveFold: rect.top < window.innerHeight,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      attributes: attrs,
      computedStyles: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        padding: cs.padding,
        borderRadius: cs.borderRadius,
        border: cs.border,
        cursor: cs.cursor,
        display: cs.display,
      },
    });
  }
  return out;
})()`;

// Injected into the live Browserbase page to draw highlight rectangles over collected elements.
// Written as a real function so we can stringify + call with arguments via page.evaluate.
function OVERLAY_FN(selectors: string[]) {
  const OVERLAY_ID = "__lovable_collect_overlay__";
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = OVERLAY_ID;
  wrap.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;";
  document.body.appendChild(wrap);

  selectors.forEach((sel, i) => {
    let el: Element | null = null;
    try { el = document.querySelector(sel); } catch { el = null; }
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const box = document.createElement("div");
    box.style.cssText = [
      "position:absolute",
      `top:${Math.round(r.top + window.scrollY)}px`,
      `left:${Math.round(r.left + window.scrollX)}px`,
      `width:${Math.round(r.width)}px`,
      `height:${Math.round(r.height)}px`,
      "outline:2px solid #22d3ee",
      "background:rgba(34,211,238,0.08)",
      "box-sizing:border-box",
      "pointer-events:none",
    ].join(";");

    const badge = document.createElement("div");
    badge.textContent = String(i + 1);
    badge.style.cssText = [
      "position:absolute",
      "top:-10px",
      "left:-10px",
      "min-width:20px",
      "height:20px",
      "padding:0 6px",
      "border-radius:10px",
      "background:#0891b2",
      "color:#fff",
      "font:bold 11px system-ui,sans-serif",
      "line-height:20px",
      "text-align:center",
      "box-shadow:0 1px 3px rgba(0,0,0,0.3)",
    ].join(";");

    box.appendChild(badge);
    wrap.appendChild(box);
  });
}
