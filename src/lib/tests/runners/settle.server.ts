// Global "settle before scanning" — ensures collect and pageAudit extractors
// snapshot the same stabilized DOM. Without this, the same URL produces
// drifting ctaTotalCount/rects between runs because the two extractors fire
// at different render moments (see .lovable/plan.md, Fix 0a).
//
// IMPORTANT: NOT a naive networkidle. Pages like hibob.com keep the network
// busy forever via autoplay video + 3p scripts — a naive wait timeouts and
// blocks everything. This helper is budgeted and tolerates always-busy nets.
//
// Stability signal ignores deep DOM mutations (analytics injecting <script>
// nodes, video swapping <source> elements) and only watches structural
// signals: scrollHeight, top-level body.children count, and structural
// section landmarks. This is what prevents "budget exhausted" on HiBob-style
// pages where querySelectorAll('*').length flips constantly.

import type { Page } from "@browserbasehq/stagehand";

export interface SettleResult {
  settled: boolean;
  reason: string;
  durationMs: number;
}

export interface SettleOptions {
  /** Hard ceiling for the whole helper. Default 3000ms. */
  totalBudgetMs?: number;
  /** networkidle attempt budget. Default 1200ms. */
  networkidleBudgetMs?: number;
}

const STABILITY_SIG_EXPR = `(() => {
  if (!document.body) return '0:0:0';
  const h = document.body.scrollHeight;
  const c = document.body.children.length;
  const s = document.querySelectorAll('main, section, header, footer, [data-section], [role="main"]').length;
  return h + ':' + c + ':' + s;
})()`;

export async function waitForSettled(
  page: Page,
  opts: SettleOptions = {},
): Promise<SettleResult> {
  const totalBudget = opts.totalBudgetMs ?? 3000;
  const networkidleBudget = opts.networkidleBudgetMs ?? 1200;
  const t0 = Date.now();
  const remaining = () => totalBudget - (Date.now() - t0);

  // 1. domcontentloaded — usually instant on a warmed page.
  // Stagehand's signature is waitForLoadState(state, timeoutMs).
  try {
    await page.waitForLoadState("domcontentloaded", Math.min(1000, remaining()));
  } catch {
    /* swallow — page already past dcl is fine */
  }

  // 2. networkidle attempt, budgeted. Don't throw on busy pages.
  let networkidleOk = false;
  if (remaining() > 200) {
    try {
      await page.waitForLoadState("networkidle", Math.min(networkidleBudget, remaining()));
      networkidleOk = true;
    } catch {
      // Expected on autoplay-video / heavy 3p sites — fall through.
    }
  }

  // 3. DOM stability: structural signature must match across a 350ms gap.
  //    Bail-fast — first identical pair wins, no extra iterations.
  //    Skip the readyState poll: networkidle already implies complete; on
  //    busy sites the structural sig check is cheaper and more accurate.
  let stable = false;
  let lastSig: string | null = null;
  const maxIters = 4;
  for (let i = 0; i < maxIters && remaining() > 400; i++) {
    let sig: string;
    try {
      sig = await page.evaluate<string>(STABILITY_SIG_EXPR);
    } catch {
      break;
    }
    if (lastSig !== null && sig === lastSig) {
      stable = true;
      break;
    }
    lastSig = sig;
    await new Promise((r) => setTimeout(r, 350));
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
