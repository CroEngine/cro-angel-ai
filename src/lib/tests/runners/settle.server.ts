// Global "settle before scanning" — ensures collect and pageAudit extractors
// snapshot the same stabilized DOM. Without this, the same URL produces
// drifting ctaTotalCount/rects between runs because the two extractors fire
// at different render moments (see .lovable/plan.md, Fix 0a).
//
// IMPORTANT: NOT a naive networkidle. Pages like hibob.com keep the network
// busy forever via autoplay video + 3p scripts — a naive wait timeouts and
// blocks everything. This helper is budgeted and tolerates always-busy nets.

import type { Page } from "@browserbasehq/stagehand";

export interface SettleResult {
  settled: boolean;
  reason: string;
  durationMs: number;
}

export interface SettleOptions {
  /** Hard ceiling for the whole helper. Default 6000ms. */
  totalBudgetMs?: number;
  /** networkidle attempt budget. Default 3000ms. */
  networkidleBudgetMs?: number;
}

export async function waitForSettled(
  page: Page,
  opts: SettleOptions = {},
): Promise<SettleResult> {
  const totalBudget = opts.totalBudgetMs ?? 6000;
  const networkidleBudget = opts.networkidleBudgetMs ?? 3000;
  const t0 = Date.now();
  const remaining = () => totalBudget - (Date.now() - t0);

  // 1. domcontentloaded — usually instant on a warmed page.
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(2000, remaining()) });
  } catch {
    /* swallow — page already past dcl is fine */
  }

  // 2. networkidle attempt, budgeted. Don't throw on busy pages.
  let networkidleOk = false;
  if (remaining() > 200) {
    try {
      await page.waitForLoadState("networkidle", {
        timeout: Math.min(networkidleBudget, remaining()),
      });
      networkidleOk = true;
    } catch {
      // Expected on autoplay-video / heavy 3p sites — fall through.
    }
  }

  // 3. document.readyState === 'complete' poll (cheap, up to 2s).
  if (remaining() > 200) {
    const readyDeadline = Date.now() + Math.min(2000, remaining());
    while (Date.now() < readyDeadline) {
      try {
        const ready = await page.evaluate<string>("document.readyState");
        if (ready === "complete") break;
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // 4. DOM stability: childCount + nodeCount must match across a 500ms gap.
  //    Retry up to 2 extra iterations within the remaining budget.
  let stable = false;
  let lastSig = "";
  const maxIters = 3;
  for (let i = 0; i < maxIters && remaining() > 600; i++) {
    let sig: string;
    try {
      sig = await page.evaluate<string>(
        "document.body ? (document.body.children.length + ':' + document.querySelectorAll('*').length) : '0:0'",
      );
    } catch {
      break;
    }
    if (i > 0 && sig === lastSig) {
      stable = true;
      break;
    }
    lastSig = sig;
    await new Promise((r) => setTimeout(r, 500));
  }

  const durationMs = Date.now() - t0;
  const reason = stable
    ? networkidleOk
      ? "networkidle+dom-stable"
      : "dom-stable (net busy)"
    : networkidleOk
      ? "networkidle (dom churning)"
      : "budget exhausted";
  return { settled: stable || networkidleOk, reason, durationMs };
}
