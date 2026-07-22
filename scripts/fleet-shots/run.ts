#!/usr/bin/env bun
// FLEET SHOTS — live before/after of the REAL engine adapting each of the 101
// fleet sites. Re-crawls every site via Browserbase, dismisses consent, injects
// public/adaptive-lab.js, photographs BEFORE, applies the adaptation for a
// representative visitor, photographs AFTER, then reverts and photographs
// RESTORED to prove the page comes back byte-clean.
//
// "After" is the engine's SAFE PRIMITIVES (trust-bar, CTA emphasis, and any
// reorder it can safely do) — not the Claude-designed cohort redesign, which
// needs the production API. Honest scope, stated on every card.
//
// Robust for an overnight run: fresh Browserbase session every few sites (16-min
// session cap), a hard per-site timeout, graceful skip-on-failure, and the
// manifest is rewritten after EVERY site so a crash preserves progress.
//
// Build for Node (Browserbase needs Node + the proxy env), then run:
//   bun build scripts/fleet-shots/run.ts --target=node --format=esm \
//     --outfile=fleet-shots.node.mjs --external playwright --external @browserbasehq/sdk
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node fleet-shots.node.mjs

import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { createSession, closeSession } from "../../src/lib/tests/browserbase.server";
import { SITES } from "../day0-sites";

const OUT = process.env.FLEET_OUT || "docs/fleet-shots-2026-07-21";
const IMG = `${OUT}/img`;
const BUNDLE = readFileSync("public/adaptive-lab.js", "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) || 0);

// Known pricing-page URLs (base site name → url), reused from the adaptive
// sweep. Sites here get a SECOND pass: the engine adapts the pricing page for
// a price-hesitant visitor (risk-reducer bar + pricing spotlight).
const PRICING: Record<string, string> = {
  monday: "https://monday.com/pricing", asana: "https://asana.com/pricing",
  clickup: "https://clickup.com/pricing", calendly: "https://calendly.com/pricing",
  zapier: "https://zapier.com/pricing", airtable: "https://www.airtable.com/pricing",
  webflow: "https://webflow.com/pricing", typeform: "https://www.typeform.com/pricing/",
  posthog: "https://posthog.com/pricing", deel: "https://www.deel.com/pricing/",
  pipedrive: "https://www.pipedrive.com/en/prices", hotjar: "https://www.hotjar.com/pricing/",
  mixpanel: "https://mixpanel.com/pricing/", amplitude: "https://amplitude.com/pricing",
  ahrefs: "https://ahrefs.com/pricing", close: "https://www.close.com/pricing",
  helpscout: "https://www.helpscout.com/pricing/", front: "https://front.com/pricing",
  aircall: "https://aircall.io/pricing/", slack: "https://slack.com/pricing",
  dropbox: "https://www.dropbox.com/plans", miro: "https://miro.com/pricing/",
  todoist: "https://todoist.com/pricing", wrike: "https://www.wrike.com/price/",
  smartsheet: "https://www.smartsheet.com/pricing", mercury: "https://mercury.com/pricing",
  mailchimp: "https://mailchimp.com/pricing/marketing/", mentimeter: "https://www.mentimeter.com/plans",
  bokio: "https://www.bokio.se/priser/", fortnox: "https://www.fortnox.se/pris",
};

// Best-effort accept-all consent so bars/CTAs aren't shot under a modal, THEN
// hard-remove any banner the click missed (different CMPs, "reject-only" walls,
// iframe messages) — a cookie banner in the frame is exactly what the fleet
// gallery review flagged. Removal is cosmetic + local to this crawl; it never
// ships in the engine.
async function dismissConsent(page: Page) {
  await page
    .evaluate(() => {
      const RX = /^(accept( all)?( cookies)?|allow all( cookies)?|godk[äa]nn( alla)?( cookies)?|acceptera( alla)?( cookies)?|jag f[öo]rst[åa]r|ok(ay)?|got it|i agree|agree|tillåt alla)$/i;
      for (const el of Array.from(document.querySelectorAll("button, [role=button], a"))) {
        const t = ((el as HTMLElement).innerText || "").trim();
        if (t && t.length <= 30 && RX.test(t)) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 10 && r.height > 10) {
            (el as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    })
    .catch(() => {});
  await sleep(500);
  // Hard-hide whatever banner survives — common CMP containers + heuristics.
  await page
    .evaluate(() => {
      const SEL = [
        "#onetrust-consent-sdk", "#onetrust-banner-sdk", "#CybotCookiebotDialog",
        "#usercentrics-root", "#cookiescript_injected", "#cookie-law-info-bar",
        "[id^='sp_message_container']", "[class*='sp_message']", "[id*='sourcepoint']",
        ".osano-cm-window", "#termly-code-snippet-support", "#hs-eu-cookie-confirmation",
        "[class*='cookie-banner']", "[class*='cookie-consent']", "[class*='cookie-notice']",
        "[class*='consent-banner']", "[id*='cookie-banner']", "[id*='cookie-consent']",
        "[aria-label*='cookie' i]", "[class*='gdpr']", "[data-testid*='cookie' i]",
      ];
      let hidden = 0;
      for (const s of SEL) {
        try {
          document.querySelectorAll<HTMLElement>(s).forEach((el) => {
            const r = el.getBoundingClientRect();
            // Only touch banner-sized fixed/sticky elements near an edge — never
            // the page's own content.
            if (r.width > 200 && r.height > 30) {
              el.style.setProperty("display", "none", "important");
              hidden++;
            }
          });
        } catch {
          /* bad selector — skip */
        }
      }
      // Any leftover full-width fixed bar pinned to top/bottom (generic CMP).
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        const r = el.getBoundingClientRect();
        const wide = r.width > window.innerWidth * 0.8 && r.height > 40 && r.height < window.innerHeight * 0.6;
        const edge = r.top < 4 || r.bottom > window.innerHeight - 4;
        const txt = (el.innerText || "").toLowerCase();
        if (wide && edge && /cookie|consent|gdpr|privacy|samtycke|kakor/.test(txt)) {
          el.style.setProperty("display", "none", "important");
          hidden++;
        }
      }
      return hidden;
    })
    .catch(() => {});
  await sleep(200);
}

// The same automated visual-acceptance the sweep uses — "nothing looks off" as
// code: bars full-width & sanely sized & visible; emphasis not collapsed/covered.
const VISUAL_CHECK = `(() => {
  const issues = [];
  for (const bar of document.querySelectorAll('[data-angel-adaptation]')) {
    const r = bar.getBoundingClientRect();
    if (r.height > 90) issues.push('bar-too-tall');
    if (r.width < window.innerWidth * 0.9) issues.push('bar-not-fullwidth');
    if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
    const hit = document.elementFromPoint(Math.floor(window.innerWidth/2), Math.max(1, Math.floor(r.top + r.height/2)));
    if (hit !== bar && !bar.contains(hit)) issues.push('bar-covered');
  }
  for (const el of document.querySelectorAll('[data-angel-emphasis]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) { issues.push('emphasis-collapsed'); continue; }
    if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
    const hit = document.elementFromPoint(Math.floor(r.left + r.width/2), Math.floor(r.top + r.height/2));
    if (hit !== el && !el.contains(hit) && !(hit && hit.contains(el))) issues.push('emphasis-covered');
  }
  return issues;
})()`;

type Target = { name: string; url: string; page: "home" | "pricing"; segment: string };
type Rec = {
  name: string;
  url: string;
  page: "home" | "pricing";
  ok: boolean;
  error?: string;
  applied?: string[];
  segment?: string;
  visualIssues?: string[];
  restoredClean?: boolean;
  changed?: boolean; // did the AFTER differ from BEFORE at all?
  before?: string;
  after?: string;
  map?: Record<string, unknown>; // FLEET_MAP: structured section map for this page
};

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms))]);

// FULL-PAGE screenshot (the whole start page, not just the fold) — height capped
// at 7000px so giant/infinite pages stay a sane size. Scroll through first so
// lazy-loaded sections render, resize the viewport to the (capped) page height,
// shoot, then restore the normal viewport for the engine's next step.
const CAP_H = Number(process.env.FLEET_CAP_H) || 6000;
async function shoot(page: Page, file: string) {
  const H = await page
    .evaluate(async (cap) => {
      const step = window.innerHeight;
      const full = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      for (let y = 0; y < Math.min(full(), Math.max(12000, cap as number)); y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 110));
      }
      window.scrollTo(0, 0);
      return Math.min(full(), cap as number);
    }, CAP_H)
    .catch(() => 1680);
  await page.setViewportSize({ width: 1200, height: Math.max(900, Math.round(H)) }).catch(() => {});
  await dismissConsent(page); // re-hide any banner that reappeared before the shot
  await sleep(300);
  await page.screenshot({ path: `${IMG}/${file}`, type: "jpeg", quality: 38 });
  await page.setViewportSize({ width: 1200, height: 1680 }).catch(() => {}); // restore for the engine
}

async function capturePage(page: Page, t: Target): Promise<Rec> {
  const tag = t.page === "pricing" ? `${t.name}-pricing` : t.name;
  const rec: Rec = { name: t.name, url: t.url, page: t.page, ok: false };
  await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 70_000 });
  // Let client-side redirects (locale/geo) settle before we inject — otherwise a
  // late navigation destroys the JS context mid-inventory (n8n, personio).
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  await sleep(1400);
  await dismissConsent(page);
  await sleep(700);
  try {
    await page.evaluate(BUNDLE);
  } catch {
    // Context torn down by a late navigation — settle and re-inject once.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await sleep(900);
    await page.evaluate(BUNDLE);
  }
  await page
    .waitForFunction(() => (window as unknown as { __angelAdaptive?: { inventory?: unknown } }).__angelAdaptive?.inventory != null, undefined, { timeout: 28_000 })
    .catch(() => {});
  // A late consent reload can wipe the global — re-inject once.
  const alive = await page.evaluate(() => !!(window as unknown as { __angelAdaptive?: unknown }).__angelAdaptive).catch(() => false);
  if (!alive) {
    await page.evaluate(BUNDLE);
    await page.waitForFunction(() => (window as unknown as { __angelAdaptive?: { inventory?: unknown } }).__angelAdaptive?.inventory != null, undefined, { timeout: 18_000 }).catch(() => {});
  }
  const hasInv = await page.evaluate(() => !!(window as unknown as { __angelAdaptive?: { inventory?: unknown } }).__angelAdaptive?.inventory).catch(() => false);
  if (!hasInv) throw new Error("no inventory");

  await dismissConsent(page);

  // MAP mode (FLEET_MAP=1): overlay the detected section map on the real page
  // and dump the structured inventory — a "does the engine see the page
  // correctly?" audit. Section boxes are colored by type; generic `content`
  // (the untyped gap) is shaded so the coarse-typing problem is visible.
  if (process.env.FLEET_MAP) {
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await sleep(500);
    const map = await page.evaluate(() => {
      const inv = (window as unknown as { __angelAdaptive: { inventory: Record<string, unknown> } }).__angelAdaptive
        .inventory as {
        sections?: Array<{ type?: string; selector?: string; heading?: string; containsTrustSignals?: boolean; containsPricing?: boolean }>;
        ctas?: Array<{ text?: string; section?: string; intent?: string; category?: string; aboveFold?: boolean }>;
        trust?: Record<string, Array<unknown>>;
        page?: { hero?: { headline?: string; subheadline?: string } };
      };
      const COLORS: Record<string, string> = {
        hero: "#2563eb", testimonials: "#0d9488", pricing: "#7c3aed", features: "#16a34a", benefits: "#16a34a",
        faq: "#d97706", cta: "#db2777", logos: "#0891b2", stats: "#ca8a04", content: "#64748b",
        header: "#334155", nav: "#334155", footer: "#334155",
      };
      const sx = window.scrollX, sy = window.scrollY;
      const boxes: Array<Record<string, unknown>> = [];
      (inv.sections || []).forEach((s, i) => {
        if (!s.selector) return;
        const el = document.querySelector(s.selector) as HTMLElement | null;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const b = { i, type: s.type, heading: (s.heading || "").slice(0, 50), x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height), trust: !!s.containsTrustSignals, pricing: !!s.containsPricing };
        boxes.push(b);
        const color = COLORS[s.type || "content"] || "#64748b";
        const d = document.createElement("div");
        d.className = "angel-map-ovl";
        d.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:3px solid ${color};background:${s.type === "content" ? "rgba(100,116,139,.10)" : "transparent"};box-sizing:border-box;z-index:2147482000;pointer-events:none`;
        const lbl = document.createElement("div");
        lbl.textContent = `#${i} ${s.type}${b.heading ? " · " + b.heading : ""}${b.trust ? " [TRUST]" : ""}${b.pricing ? " [PRICE]" : ""}`;
        lbl.style.cssText = `position:absolute;left:0;top:0;background:${color};color:#fff;font:700 13px system-ui;padding:2px 8px;white-space:nowrap;max-width:96vw;overflow:hidden;text-overflow:ellipsis`;
        d.appendChild(lbl);
        document.body.appendChild(d);
      });
      const trustCount: Record<string, number> = {};
      for (const k of ["testimonials", "customerLogos", "ratings", "trustedBy", "socialProof", "guarantees", "certifications", "reviewBadges", "pressMentions"])
        trustCount[k] = ((inv.trust || {})[k] || []).length;
      return {
        url: location.href,
        hero: { headline: (inv.page?.hero?.headline || "").slice(0, 90), sub: (inv.page?.hero?.subheadline || "").slice(0, 90) },
        sectionCount: boxes.length,
        typedShare: boxes.filter((b) => b.type !== "content").length + "/" + boxes.length,
        sections: boxes,
        ctas: (inv.ctas || []).slice(0, 12).map((c) => ({ text: (c.text || "").slice(0, 40), section: c.section, intent: c.intent, aboveFold: !!c.aboveFold })),
        trustCount,
      };
    });
    rec.before = `${tag}-map.jpg`;
    await shoot(page, rec.before);
    await page.evaluate(() => document.querySelectorAll(".angel-map-ovl").forEach((e) => e.remove()));
    console.log("MAP " + tag + " " + JSON.stringify(map));
    rec.map = map;
    rec.ok = true;
    rec.applied = [];
    rec.changed = false;
    rec.restoredClean = true;
    return rec;
  }

  rec.before = `${tag}-before.jpg`;
  await shoot(page, rec.before);

  // Adapt for this page's visitor. Home → an engaged reader who hasn't clicked
  // (trust bar + CTA emphasis + reorder where eligible). Pricing → a price-
  // hesitant visitor (risk-reducer bar + pricing spotlight). Real engine output.
  const seg = t.segment;
  const res = (await page.evaluate((s) => {
    const a = (window as unknown as { __angelAdaptive: { events: unknown[]; adapt: (x?: string) => Array<{ label: string; detail?: string }>; segment: string } }).__angelAdaptive;
    a.events.length = 0;
    a.events.push({ type: "pageview", ts: 0 });
    a.events.push({ type: "scroll_depth", ts: 0, value: 82 });
    a.events.push({ type: "time_on_page", ts: 0, value: 45_000 });
    const applied = a.adapt(s);
    return { applied: applied.map((x) => x.label + (x.detail ? ` — ${x.detail}` : "")), segment: a.segment };
  }, seg)) as { applied: string[]; segment: string };
  rec.applied = res.applied;
  rec.segment = res.segment;
  if (process.env.FLEET_DEBUG) {
    const dbg = await page
      .evaluate(() => {
        const a = (window as unknown as { __angelAdaptive: { inventory: Record<string, unknown> } }).__angelAdaptive;
        const inv = a.inventory as { sections?: unknown[]; trust?: Record<string, unknown> };
        const map = (arr: unknown): string[] =>
          ((arr as Array<{ text?: string; aboveFold?: boolean }>) || [])
            .slice(0, 4)
            .map((x) => (x.text || "").replace(/\s+/g, " ").slice(0, 34) + (x.aboveFold ? "[AF]" : ""));
        return {
          why: (window as unknown as { __angelReorderWhy?: string }).__angelReorderWhy || null,
          secs: ((inv.sections as Array<{ type?: string; selector?: string; containsTrustSignals?: boolean }>) || []).map(
            (s) => `${s.type}${s.selector ? "" : "(nosel)"}${s.containsTrustSignals ? "[TRUST]" : ""}`,
          ),
          logos: map(inv.trust?.customerLogos),
          trustedBy: map(inv.trust?.trustedBy),
          ratings: map(inv.trust?.ratings),
        };
      })
      .catch(() => null);
    console.log("DEBUG " + tag + " " + JSON.stringify(dbg));
  }
  await sleep(500);
  rec.visualIssues = (await page.evaluate(VISUAL_CHECK).catch(() => [])) as string[];
  rec.changed = rec.applied.length > 0;

  rec.after = `${tag}-after.jpg`;
  await shoot(page, rec.after);

  // Revert and confirm the page returns clean (no angel residue).
  const clean = await page.evaluate(() => {
    const a = (window as unknown as { __angelAdaptive: { revert: () => void } }).__angelAdaptive;
    a.revert();
    return (
      document.querySelectorAll("[data-angel-adaptation],[data-angel-emphasis],[data-angel-reorder]").length === 0
    );
  }).catch(() => false);
  rec.restoredClean = clean;
  rec.ok = true;
  return rec;
}

async function freshPage(): Promise<{ browser: Browser; page: Page; sessionId: string; born: number }> {
  // createSession/connect had NO timeout — a single stalled Browserbase call
  // froze the whole run indefinitely (the map run hung 3h at site 89). Bound
  // each attempt and retry a few times so a stalled session self-heals.
  let lastErr: unknown;
  for (let a = 0; a < 3; a++) {
    try {
      const session = await withTimeout(createSession(), 60_000, "createSession");
      const browser = await withTimeout(
        chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 }),
        35_000,
        "connectCDP",
      );
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.setViewportSize({ width: 1200, height: 1680 });
      return { browser, page, sessionId: session.id, born: Date.now() };
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (a + 1));
    }
  }
  throw new Error(`freshPage failed: ${String(lastErr).slice(0, 120)}`);
}

async function main() {
  mkdirSync(IMG, { recursive: true });
  let sites = SITES as Array<{ name: string; url: string }>;
  if (only) {
    const set = new Set(only.split(",").map((s) => s.trim()));
    sites = sites.filter((s) => set.has(s.name));
  }
  if (limit) sites = sites.slice(0, limit);

  // Build the target list: every site's HOME, plus a PRICING pass for the sites
  // with a known pricing URL. Home + pricing are captured back to back so the
  // gallery can pair them per site.
  const targets: Target[] = [];
  for (const s of sites) {
    targets.push({ name: s.name, url: s.url, page: "home", segment: "engaged_no_click" });
    // FLEET_MAP audits the START pages only; the before/after run does home+pricing.
    // FLEET_MAP and FLEET_HOME_ONLY audit the START pages only; the normal
    // before/after run does home+pricing.
    if (!process.env.FLEET_MAP && !process.env.FLEET_HOME_ONLY && PRICING[s.name])
      targets.push({ name: s.name, url: PRICING[s.name], page: "pricing", segment: "price_hesitant" });
  }

  const records: Rec[] = [];
  let h = await freshPage();
  const flush = () => writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ generatedAtSites: records.length, records }, null, 1));

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    // Recycle the session before the 16-min cap, or after a failure.
    if (Date.now() - h.born > 11 * 60_000) {
      try {
        await h.browser.close();
      } catch {}
      await closeSession(h.sessionId).catch(() => {});
      h = await freshPage();
    }
    process.stdout.write(`[${i + 1}/${targets.length}] ${t.name}${t.page === "pricing" ? " (pricing)" : ""} … `);
    // Up to FLEET_RETRIES extra attempts (default 0 = single pass). Transient
    // failures — late-redirect context loss, tunnel drop, session race — usually
    // clear on a fresh session, so a retry recovers them without a full re-run.
    const attempts = 1 + (Number(process.env.FLEET_RETRIES) || 0);
    let rec: Rec | null = null;
    let lastErr = "";
    for (let a = 0; a < attempts; a++) {
      if (a > 0) {
        try {
          await h.browser.close();
        } catch {}
        await closeSession(h.sessionId).catch(() => {});
        h = await freshPage();
        process.stdout.write(`(retry ${a}) `);
      }
      try {
        rec = await withTimeout(capturePage(h.page, t), 130_000, "site");
        break;
      } catch (err) {
        lastErr = String(err).slice(0, 160);
        rec = null;
      }
    }
    if (rec) {
      records.push(rec);
      console.log(`ok · ${rec.changed ? rec.applied?.join(", ") : "no change"}${rec.visualIssues?.length ? ` · issues: ${rec.visualIssues.join(",")}` : ""}${rec.restoredClean === false ? " · RESIDUE" : ""}`);
    } else {
      records.push({ name: t.name, url: t.url, page: t.page, ok: false, error: lastErr });
      console.log(`FAIL · ${lastErr.slice(0, 90)}`);
      // Rebuild the session — a failed page often leaves the page/session bad.
      try {
        await h.browser.close();
      } catch {}
      await closeSession(h.sessionId).catch(() => {});
      h = await freshPage();
    }
    flush(); // progress survives a crash
  }
  try {
    await h.browser.close();
  } catch {}
  await closeSession(h.sessionId).catch(() => {});

  const okN = records.filter((r) => r.ok).length;
  const changed = records.filter((r) => r.changed).length;
  const clean = records.filter((r) => r.restoredClean).length;
  const issues = records.filter((r) => r.ok && r.visualIssues && r.visualIssues.length).length;
  console.log(`\nDONE — ${okN}/${records.length} captured · ${changed} visibly adapted · ${clean} restored clean · ${issues} with visual issues`);
  flush();
}

main().catch((e) => {
  console.error("fleet-shots fatal:", e);
  process.exit(1);
});
