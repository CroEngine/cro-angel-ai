// Angel Adaptive — the snippet (`adaptive.js`), entry point.
//
//   <script src="https://app.angeladaptive.com/adaptive.js"
//           data-site-id="xxxx"></script>
//
// v1 scope: READ-ONLY. The snippet builds the page's Content Inventory in the
// visitor's browser and reports it. It applies NO changes to the page yet —
// visitor context, the decision engine, the pattern library and DOM adaptation
// are later steps. Getting the crawl correct and complete first is the whole
// point of this stage: every later decision relies on an accurate inventory of
// what content already exists.
//
// Safety contract honoured here: never mutates the DOM, never injects content,
// only reads. The inventory is exposed on `window.__angelAdaptive` and, if a
// `data-endpoint` is configured, POSTed best-effort to the collector.

import { INVENTORY_SCRIPT, type ContentInventory } from "./inventory";

const VERSION = "0.1.0";

type AngelGlobal = {
  version: string;
  siteId: string | null;
  inventory: ContentInventory | null;
  collect: () => ContentInventory;
};

function currentScript(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript;
  // Fallback when the bundle runs async/deferred: last script that pulled adaptive(.js).
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[data-site-id]"));
  return scripts.length ? scripts[scripts.length - 1] : null;
}

// Build the inventory by running the composed detector script against the live
// DOM. `new Function` (not direct eval) keeps it out of this module's scope —
// the script only touches `document`/`window`.
function collectInventory(): ContentInventory {
  return new Function("return " + INVENTORY_SCRIPT)() as ContentInventory;
}

function summarize(inv: ContentInventory): string {
  const present = Object.keys(inv.available).filter((k) => inv.available[k]);
  return (
    `[Angel Adaptive] inventory ready — ${inv.trust.total} trust signals, ` +
    `${inv.ctas.length} CTAs, ${inv.sections.length} sections. ` +
    `Available content: ${present.join(", ") || "none detected"}.`
  );
}

function run(): void {
  const script = currentScript();
  const siteId = script?.getAttribute("data-site-id") ?? null;
  const endpoint = script?.getAttribute("data-endpoint") ?? null;

  const angel: AngelGlobal = {
    version: VERSION,
    siteId,
    inventory: null,
    collect: collectInventory,
  };
  (window as unknown as { __angelAdaptive: AngelGlobal }).__angelAdaptive = angel;

  let inventory: ContentInventory;
  try {
    inventory = collectInventory();
  } catch (err) {
    // Read-only: a failure here can never harm the host page. Log and bail.
    console.error("[Angel Adaptive] inventory extraction failed:", err);
    return;
  }
  angel.inventory = inventory;

  console.info(summarize(inventory));

  if (endpoint) {
    try {
      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, version: VERSION, inventory }),
        keepalive: true,
        credentials: "omit",
      }).catch(() => {
        /* best-effort; never block or throw on the host page */
      });
    } catch {
      /* ignore */
    }
  }
}

// Run once the DOM is parsed; the inventory needs the page's content present.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run, { once: true });
} else {
  run();
}
