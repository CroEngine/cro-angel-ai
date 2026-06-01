// Stagehand-based step engine. Runs against an already-created Browserbase session.

import { Stagehand } from "@browserbasehq/stagehand";

function readJpegDimensions(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    const segLen = buf.readUInt16BE(i + 2);
    i += 2 + segLen;
  }
  return null;
}

export type Step =
  | { kind: "goto"; url: string }
  | { kind: "wait"; ms: number }
  | { kind: "assertText"; text: string }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "act"; instruction: string }
  | { kind: "extract"; instruction: string }
  | { kind: "observe"; instruction: string }
  | { kind: "collect"; target: CollectTarget }
  | { kind: "pageAudit" };

export type CollectTarget = "clickables" | "buttons";

export type ElementCategory =
  | "cta_primary"
  | "cta_secondary"
  | "form_submit"
  | "icon_button"
  | "nav_item"
  | "link"
  | "other";

export type ViewportZone = "above_fold" | "mid_page" | "below_fold";

export type ElementIntent =
  | "conversion"
  | "information"
  | "navigation"
  | "social"
  | "utility"
  | "engagement"
  | "unknown";

export type SectionKind =
  | "nav"
  | "header"
  | "hero"
  | "cards"
  | "content"
  | "footer";

export type CollectedElement = {
  text: string;
  tagName: string;
  selector: string;
  category: ElementCategory;
  intent: ElementIntent;
  section: SectionKind;
  href: string | null;
  disabled: boolean;
  visible: boolean;
  aboveFold: boolean;
  rect: { x: number; y: number; w: number; h: number };
  position: {
    viewportZone: ViewportZone;
    yPercent: number;
    xPercent: number;
  };
  visualWeight: {
    area: number;
    fontSize: number;
    fontWeight: number;
    backgroundContrast: number;
    score: number;
  };
  groupId?: string;
  groupCount?: number;
  groupedAway?: boolean;
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

export type SectionType =
  | "nav"
  | "header"
  | "hero"
  | "logos"
  | "benefits"
  | "features"
  | "testimonials"
  | "reviews"
  | "pricing"
  | "faq"
  | "cta"
  | "form"
  | "cards"
  | "content"
  | "footer"
  | "aside";

export type PageSection = {
  id: string;
  type: SectionType;
  kind: SectionType; // legacy alias for back-compat
  position: number;
  heading: string;
  subheading: string;
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  aboveFold: boolean;
  heightPx: number;
  visualWeight: number; // 0–100 normalized
  elementCount: number;
  childCount: number;
  repeatedChildren: number;
  headingText: string; // alias of heading
  containsPrimaryCTA: boolean;
  containsTrustSignals: boolean;
  containsForm: boolean;
  containsPricing: boolean;
  containsNavigation: boolean;
};

export type TrustSignalType =
  | "testimonial"
  | "review_rating"
  | "stars"
  | "trusted_by"
  | "customer_logos"
  | "certification"
  | "guarantee"
  | "secure_payment"
  | "contact_info"
  | "org_number"
  | "press_mention"
  | "social_proof_count";

export type TrustSignal = {
  type: TrustSignalType;
  text: string;
  section: SectionKind;
  aboveFold: boolean;
  selector: string;
  visualWeight: number;
  source: "text" | "attr" | "schema" | "img_alt";
  rect?: { x: number; y: number; w: number; h: number };
  personName?: string;
  company?: string;
  hasImage?: boolean;
  rating?: number;
  reviewCount?: number;
  reviewSource?: string;
  logoCount?: number;
  recognizedBrands?: string[];
};

export type CTAEntity = {
  text: string;
  intent: ElementIntent;
  category: ElementCategory;
  section: SectionKind;
  aboveFold: boolean;
  visualWeight: number;
  competingActions: number;
  nearestTrustSignalDistance: number;
  nearestFormDistance: number;
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
};

export type FormField = {
  name: string;
  type: string;
  required: boolean;
  label: string;
};

export type FormEntity = {
  section: SectionKind;
  aboveFold: boolean;
  selector: string;
  fieldCount: number;
  requiredFields: number;
  containsEmail: boolean;
  containsPhone: boolean;
  containsCompany: boolean;
  containsPassword: boolean;
  containsCreditCard: boolean;
  multiStep: boolean;
  submitText: string;
  fields: FormField[];
  rect: { x: number; y: number; w: number; h: number };
};

export type NavigationData = {
  topNavCount: number;
  footerNavCount: number;
  topNavLinks: string[];
  footerNavLinks: string[];
  loginPresent: boolean;
  signupPresent: boolean;
  pricingPresent: boolean;
  contactPresent: boolean;
  blogPresent: boolean;
  docsPresent: boolean;
  languageSwitcherPresent: boolean;
  cartPresent: boolean;
};

export type VisualHierarchyEntry = {
  selector: string;
  text: string;
  role: string;
  visualWeight: number;
  area: number;
  fontSize: number;
  fontWeight: number;
  contrast: number;
  position: { xPct: number; yPct: number };
  aboveFold: boolean;
  section: SectionKind;
};

export type PageSummary = {
  primaryCtaCount: number;
  secondaryCtaCount: number;
  aboveFoldCtaCount: number;
  aboveFoldTrustCount: number;
  trustSignalCount: number;
  testimonialCount: number;
  logoCount: number;
  reviewCount: number;
  averageRating: number;
  formCount: number;
  navigationLinks: number;
  sectionCount: number;
  pageHeightPx: number;
  foldHeightPx: number;
};

export type PageAuditData = {
  url: string;
  head: {
    title: string;
    description: string;
    canonical: string;
    lang: string;
    viewport: string;
    robots: string;
    ogTitle: string;
    ogDescription: string;
    ogImage: string;
    ogType: string;
    ogUrl: string;
    twitterCard: string;
    twitterTitle: string;
    twitterImage: string;
  };
  headings: {
    h1Count: number;
    h2Count: number;
    h3Count: number;
    hierarchy: Array<{ level: number; text: string; id: string }>;
  };
  images: { total: number; missingAlt: number; missingAltPct: number; missingDims: number; lazy: number };
  links: { internal: number; external: number; nofollow: number; total: number };
  schema: { count: number; types: string[] };
  content: { wordCount: number; sections: number; articles: number };
  robotsTxt: { exists: boolean; blocksAll: boolean; hasSitemap: boolean };
  sitemap: { exists: boolean; urlCount: number };
  sections: PageSection[];
  sectionOrder: SectionType[];
  trustSignals: TrustSignal[];
  trustSummary: {
    total: number;
    aboveFold: number;
    byType: Record<string, number>;
  };
  ctas: CTAEntity[];
  forms: FormEntity[];
  navigation: NavigationData;
  visualHierarchy: VisualHierarchyEntry[];
  pageSummary: PageSummary;
  flags: string[];
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
    case "pageAudit": return "pageAudit";
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
            // Scroll through the page so lazy/intersection-observer content mounts.
            try {
              for (const pct of [0, 25, 50, 75, 100]) {
                await page.evaluate(`window.scrollTo({ top: document.documentElement.scrollHeight * ${pct / 100}, behavior: 'instant' })`);
                await new Promise((res) => setTimeout(res, 400));
              }
              await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
              await new Promise((res) => setTimeout(res, 200));
              onEvent({ type: "log", message: "scrolled page to trigger lazy content" });
            } catch (e) {
              onEvent({ type: "log", message: `scroll failed: ${e instanceof Error ? e.message : String(e)}` });
            }

            // 1) Take the screenshot FIRST. Playwright's fullPage capture
            //    scrolls the page itself and may trigger more lazy content,
            //    growing document height. We want our rect measurements to
            //    happen against the SAME (final) document height as the image.
            let screenshot: { dataUrl: string; viewport: { w: number; h: number } } | undefined;
            try {
              const raw = await page.screenshot({ type: "jpeg", quality: 50, fullPage: true });
              const buf = Buffer.from(raw);

              const dims = readJpegDimensions(buf);
              let vp: { w: number; h: number };
              if (dims) {
                vp = dims;
              } else {
                const win = (await page.evaluate<{ w: number; h: number }>(
                  "({ w: window.innerWidth, h: window.innerHeight })",
                )) ?? { w: 1280, h: 720 };
                const docH = (await page.evaluate<number>(
                  "document.documentElement.scrollHeight",
                )) ?? win.h;
                vp = { w: win.w, h: Math.max(docH, win.h) };
              }

              const b64 = buf.toString("base64");
              screenshot = {
                dataUrl: `data:image/jpeg;base64,${b64}`,
                viewport: vp,
              };

              const kb = Math.round(buf.length / 1024);
              onEvent({ type: "log", message: `screenshot captured (${kb}kb, ${vp.w}×${vp.h}${dims ? "" : " · fallback dims"})` });

              if (buf.length > 6 * 1024 * 1024 || vp.h > 10000) {
                onEvent({ type: "log", message: `warn: screenshot is large (${kb}kb, ${vp.h}px tall) — consider storage-upload soon` });
              }
            } catch (e) {
              onEvent({ type: "log", message: `screenshot failed: ${e instanceof Error ? e.message : String(e)}` });
            }

            // 2) Scroll back to top and let layout settle before measuring rects.
            try {
              await page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
              await new Promise((res) => setTimeout(res, 300));
            } catch { /* ignore */ }

            // 3) NOW run COLLECT_SCRIPT — document height matches the JPEG.
            const elements = await page.evaluate(COLLECT_SCRIPT);
            const all = elements as CollectedElement[];
            const filtered = filterCollected(all, step.target);

            // Group repeated controls (vote/save/share rows on feed cards etc.)
            // so they don't dominate the aggregated stats. Marks duplicates with
            // groupedAway=true; first occurrence keeps groupId+groupCount.
            const groups = groupRepeatedControls(filtered);

            const byCategory: Record<string, number> = {};
            const intentBreakdown: Record<string, number> = {};
            const bySection: Record<string, number> = {};
            let aboveFold = 0;
            let primaryCtaCount = 0;
            let competingAboveFold = 0;
            for (const el of filtered) {
              if (el.groupedAway) continue; // dedupe from aggregates
              byCategory[el.category] = (byCategory[el.category] ?? 0) + 1;
              intentBreakdown[el.intent] = (intentBreakdown[el.intent] ?? 0) + 1;
              bySection[el.section] = (bySection[el.section] ?? 0) + 1;
              if (el.position.viewportZone === "above_fold") aboveFold++;
              if (el.category === "cta_primary" && el.intent === "conversion") primaryCtaCount++;
              if (
                (el.category === "cta_primary" || el.category === "cta_secondary" || el.category === "form_submit") &&
                el.position.viewportZone === "above_fold" &&
                el.intent !== "navigation"
              ) competingAboveFold++;
            }
            const topVisualWeight = [...filtered]
              .filter((el) => !el.groupedAway)
              .sort((a, b) => b.visualWeight.score - a.visualWeight.score)
              .slice(0, 5)
              .map((el) => ({ selector: el.selector, text: el.text, score: el.visualWeight.score }));

            // Overlay still draws on ALL elements so user sees the real density.
            const overlayElements = filtered.map((el) => ({
              selector: el.selector,
              category: el.category,
              rect: el.rect,
            }));

            // Draw color-coded overlay rectangles in the live page.
            try {
              const pairs = filtered.map((el) => [el.selector, el.category]);
              await page.evaluate(`(${OVERLAY_FN.toString()})(${JSON.stringify(pairs)})`);
            } catch (e) {
              onEvent({ type: "log", message: `overlay failed: ${e instanceof Error ? e.message : String(e)}` });
            }

            const uniqueCount = filtered.filter((el) => !el.groupedAway).length;
            data = {
              target: step.target,
              count: uniqueCount,
              totalCount: filtered.length,
              byCategory,
              summary: {
                total: uniqueCount,
                aboveFold,
                primaryCtaCount,
                competingAboveFold,
                topVisualWeight,
                intentBreakdown,
                bySection,
                groups,
              },
              elements: filtered,
              overlayElements,
              screenshot,
            };
            onEvent({
              type: "log",
              message: `collect ${step.target}: ${uniqueCount} unique (${filtered.length} total) · ${aboveFold} above fold · ${primaryCtaCount} primary CTA · competing: ${competingAboveFold} · groups: ${groups.length}`,
            });
            break;
          }

          case "pageAudit": {
            try {
              const raw = await page.evaluate(PAGE_AUDIT_SCRIPT);
              const audit = raw as Omit<
                PageAuditData,
                | "robotsTxt"
                | "sitemap"
                | "flags"
                | "url"
                | "sections"
                | "sectionOrder"
                | "trustSignals"
                | "trustSummary"
                | "ctas"
                | "forms"
                | "navigation"
                | "visualHierarchy"
                | "pageSummary"
              > & { url: string };

              // Fetch robots.txt + sitemap.xml from inside the page context (avoids Stagehand type gap on page.request).
              const fetched = await page.evaluate(`
                (async () => {
                  const origin = location.origin;
                  const out = { robots: null, sitemap: null };
                  try {
                    const r = await fetch(origin + '/robots.txt', { credentials: 'omit' });
                    if (r.ok) out.robots = await r.text();
                  } catch (e) {}
                  try {
                    const r = await fetch(origin + '/sitemap.xml', { credentials: 'omit' });
                    if (r.ok) out.sitemap = await r.text();
                  } catch (e) {}
                  return out;
                })()
              `) as { robots: string | null; sitemap: string | null };

              const robotsTxt = { exists: false, blocksAll: false, hasSitemap: false };
              const sitemap = { exists: false, urlCount: 0 };
              if (fetched.robots) {
                robotsTxt.exists = true;
                robotsTxt.blocksAll = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(fetched.robots);
                robotsTxt.hasSitemap = /^Sitemap:\s*\S+/im.test(fetched.robots);
              }
              if (fetched.sitemap) {
                sitemap.exists = true;
                sitemap.urlCount = (fetched.sitemap.match(/<loc>/g) ?? []).length;
              }

              // Deterministic v2 extraction — sections, trust, ctas, forms, nav, hierarchy.
              const sections = (await page.evaluate(SECTIONS_SCRIPT)) as PageSection[];
              const trustSignals = (await page.evaluate(TRUST_SIGNALS_SCRIPT)) as TrustSignal[];
              const ctas = (await page.evaluate(CTAS_SCRIPT)) as CTAEntity[];
              const forms = (await page.evaluate(FORMS_SCRIPT)) as FormEntity[];
              const navigation = (await page.evaluate(NAVIGATION_SCRIPT)) as NavigationData;
              const visualHierarchy = (await page.evaluate(VISUAL_HIERARCHY_SCRIPT)) as VisualHierarchyEntry[];
              const dims = (await page.evaluate(
                "({ pageHeightPx: document.documentElement.scrollHeight, foldHeightPx: window.innerHeight })",
              )) as { pageHeightPx: number; foldHeightPx: number };

              // Enrich sections with containsX flags (computed in Node from collected entities).
              for (const s of sections) {
                const within = (rect: { x: number; y: number; w: number; h: number }) => {
                  const cy = rect.y + rect.h / 2;
                  return cy >= s.rect.y && cy <= s.rect.y + s.rect.h;
                };
                s.containsPrimaryCTA = ctas.some((c) => c.category === "cta_primary" && within(c.rect));
                s.containsTrustSignals = trustSignals.some(
                  (t) => t.rect && within(t.rect as { x: number; y: number; w: number; h: number }),
                );
                s.containsForm = forms.some((f) => within(f.rect));
                // type refinement based on contents + heading text.
                const h = (s.heading || "").toLowerCase();
                if (s.type === "content" || s.type === "cards") {
                  if (s.containsForm) s.type = "form";
                  else if (/pric|plan|kostnad|prenum|abonnemang/.test(h)) s.type = "pricing";
                  else if (/faq|frågor|questions|hjälp/.test(h)) s.type = "faq";
                  else if (/testimonial|kund|customer|review|omdöme|recension/.test(h)) s.type = "testimonials";
                  else if (/feature|funktion|so funkar|how it works|capabilit/.test(h)) s.type = "features";
                  else if (/benefit|fördel|varför|why /.test(h)) s.type = "benefits";
                  else if (
                    s.type === "cards" &&
                    trustSignals.some(
                      (t) =>
                        t.type === "customer_logos" &&
                        t.rect &&
                        within(t.rect as { x: number; y: number; w: number; h: number }),
                    )
                  )
                    s.type = "logos";
                }
                s.containsPricing = s.type === "pricing" || /\$|€|kr\b|\/mo\b|\/mån/.test(s.heading + " " + s.subheading);
                s.containsNavigation = s.type === "nav" || s.type === "header" || s.type === "footer";
                s.kind = s.type; // keep alias in sync after refinement
              }

              const sectionOrder = sections.map((s) => s.type);

              const trustSummary = {
                total: trustSignals.length,
                aboveFold: trustSignals.filter((t) => t.aboveFold).length,
                byType: trustSignals.reduce<Record<string, number>>((acc, t) => {
                  acc[t.type] = (acc[t.type] ?? 0) + 1;
                  return acc;
                }, {}),
              };

              // Reviews: extract aggregate values when present.
              let reviewCountSum = 0;
              let ratingSum = 0;
              let ratingN = 0;
              for (const t of trustSignals) {
                if (typeof t.reviewCount === "number") reviewCountSum += t.reviewCount;
                if (typeof t.rating === "number") {
                  ratingSum += t.rating;
                  ratingN++;
                }
              }

              const pageSummary: PageSummary = {
                primaryCtaCount: ctas.filter((c) => c.category === "cta_primary").length,
                secondaryCtaCount: ctas.filter((c) => c.category === "cta_secondary").length,
                aboveFoldCtaCount: ctas.filter((c) => c.aboveFold).length,
                aboveFoldTrustCount: trustSummary.aboveFold,
                trustSignalCount: trustSignals.length,
                testimonialCount: trustSignals.filter((t) => t.type === "testimonial").length,
                logoCount: trustSignals
                  .filter((t) => t.type === "customer_logos")
                  .reduce((s, t) => s + (t.logoCount ?? 1), 0),
                reviewCount: reviewCountSum,
                averageRating: ratingN > 0 ? Math.round((ratingSum / ratingN) * 10) / 10 : 0,
                formCount: forms.length,
                navigationLinks: navigation.topNavCount + navigation.footerNavCount,
                sectionCount: sections.length,
                pageHeightPx: dims.pageHeightPx,
                foldHeightPx: dims.foldHeightPx,
              };

              const flags: string[] = [];
              if (!audit.head.title) flags.push("missing_title");
              else if (audit.head.title.length > 60) flags.push("title_too_long");
              if (!audit.head.description) flags.push("missing_meta_description");
              else if (audit.head.description.length > 160) flags.push("meta_description_too_long");
              if (!audit.head.canonical) flags.push("missing_canonical");
              if (!audit.head.ogTitle) flags.push("missing_og_title");
              if (!audit.head.ogImage) flags.push("missing_og_image");
              if (!audit.head.viewport) flags.push("missing_viewport");
              if (audit.headings.h1Count === 0) flags.push("no_h1");
              if (audit.headings.h1Count > 1) flags.push("multiple_h1");
              if (audit.images.missingAltPct > 20) flags.push("low_alt_coverage");
              if (audit.schema.count === 0) flags.push("no_structured_data");
              if (audit.content.wordCount < 100) flags.push("thin_content");
              if (!robotsTxt.exists) flags.push("no_robots_txt");
              if (robotsTxt.blocksAll) flags.push("robots_blocks_all");
              if (!sitemap.exists) flags.push("no_sitemap");
              if (trustSignals.length === 0) flags.push("no_trust_signals");
              else if (trustSummary.aboveFold === 0) flags.push("no_trust_above_fold");
              // New v2 flags.
              const pricingIdx = sectionOrder.indexOf("pricing");
              const socialIdx = sectionOrder.findIndex(
                (t) => t === "testimonials" || t === "reviews" || t === "logos",
              );
              if (pricingIdx >= 0 && socialIdx >= 0 && pricingIdx < socialIdx) flags.push("wrong_section_order");
              if (ctas.some((c) => c.category === "cta_primary" && c.nearestTrustSignalDistance > 400)) {
                flags.push("cta_no_trust_nearby");
              }
              if (forms.some((f) => f.requiredFields >= 6)) flags.push("form_high_friction");

              const full: PageAuditData = {
                ...audit,
                robotsTxt,
                sitemap,
                sections,
                sectionOrder,
                trustSignals,
                trustSummary,
                ctas,
                forms,
                navigation,
                visualHierarchy,
                pageSummary,
                flags,
              };
              data = full;
              onEvent({
                type: "log",
                message: `pageAudit: ${flags.length} flag(s) · sections ${sections.length} [${sectionOrder.slice(0, 6).join("→")}${sectionOrder.length > 6 ? "→…" : ""}] · trust ${trustSignals.length} (${trustSummary.aboveFold} af) · ctas ${ctas.length} (${pageSummary.primaryCtaCount} primary) · forms ${forms.length} · nav ${navigation.topNavCount}/${navigation.footerNavCount}`,
              });
            } catch (e) {
              throw new Error(`pageAudit failed: ${e instanceof Error ? e.message : String(e)}`);
            }
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
    // Strict: real <button>, <input type=submit|button>, role=button only.
    return all.filter((el) =>
      el.tagName === "button" ||
      el.tagName === "input[type=submit]" ||
      el.tagName === "input[type=button]" ||
      el.tagName === "[role=button]"
    );
  }
  // "clickables" → everything we collected.
  return all;
}


export type RepeatedGroup = {
  label: string;
  count: number;
  category: ElementCategory;
  intent: ElementIntent;
  section: SectionKind;
  exampleSelector: string;
};

// Detect repeated controls (vote/save/share rows in feed cards, "Read more"
// links repeating per article, etc.) and mark all but the first occurrence
// as groupedAway so aggregates aren't dominated by them. Mutates `elements`.
function groupRepeatedControls(elements: CollectedElement[]): RepeatedGroup[] {
  const buckets = new Map<string, CollectedElement[]>();
  for (const el of elements) {
    const label = (el.text || el.attributes["aria-label"] || el.attributes["title"] || "").trim().toLowerCase();
    if (!label) continue; // skip text-less elements (icon-only repeats often differ by attrs)
    if (label.length > 60) continue; // long labels are unique enough
    // Size bucket: nearest 10px to allow minor jitter.
    const wB = Math.round(el.rect.w / 10) * 10;
    const hB = Math.round(el.rect.h / 10) * 10;
    const key = `${el.category}|${el.intent}|${label}|${wB}x${hB}`;
    const arr = buckets.get(key) ?? [];
    arr.push(el);
    buckets.set(key, arr);
  }

  const groups: RepeatedGroup[] = [];
  for (const [key, arr] of buckets) {
    if (arr.length < 3) continue;
    const groupId = `g_${groups.length + 1}`;
    arr.forEach((el, i) => {
      el.groupId = groupId;
      el.groupCount = arr.length;
      if (i > 0) el.groupedAway = true;
    });
    const head = arr[0];
    groups.push({
      label: (head.text || head.attributes["aria-label"] || head.attributes["title"] || "(no label)").trim(),
      count: arr.length,
      category: head.category,
      intent: head.intent,
      section: head.section,
      exampleSelector: head.selector,
    });
    void key;
  }
  groups.sort((a, b) => b.count - a.count);
  return groups;
}




// Runs in the browser via page.evaluate — must be self-contained string.
const COLLECT_SCRIPT = `(() => {
  const SEMANTIC_SEL =
    'button, a[href], input[type=submit], input[type=button], ' +
    '[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], ' +
    '[onclick], [tabindex]:not([tabindex="-1"])';

  // Priority for dedupe: lower = more semantic, kept over higher-priority ancestors/descendants.
  function semanticPriority(el) {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'BUTTON' || tag === 'INPUT') return 1;
    if (tag === 'A' && el.hasAttribute('href')) return 2;
    if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab' || role === 'switch') return 3;
    if (el.hasAttribute('onclick')) return 4;
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return 5;
    return 6; // cursor:pointer sweep
  }

  function isVisible(el, cs, rect) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    if (rect.width < 1 || rect.height < 1) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  // Walk light + shadow DOM, collect all matching nodes.
  function walk(root, selector, sink) {
    try {
      const list = root.querySelectorAll(selector);
      for (const n of list) sink.push(n);
    } catch (_) { /* ignore */ }
    const all = root.querySelectorAll('*');
    for (const n of all) {
      if (n.shadowRoot) walk(n.shadowRoot, selector, sink);
    }
  }

  const semanticNodes = [];
  walk(document, SEMANTIC_SEL, semanticNodes);

  // Optional cursor:pointer sweep — hard filters to avoid wrappers/cards.
  const semanticSet = new Set(semanticNodes);
  const cursorCandidates = [];
  const allEls = [];
  walk(document, '*', allEls);
  for (const el of allEls) {
    if (semanticSet.has(el)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.cursor !== 'pointer') continue;
    const text = ((el.innerText || el.getAttribute('aria-label') || '') + '').trim();
    if (!text || text.length > 120) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (!isVisible(el, cs, rect)) continue;
    // Skip if it has a semantic descendant or ancestor that will be collected.
    let skip = false;
    for (const s of semanticNodes) {
      if (el.contains(s) || s.contains(el)) { skip = true; break; }
    }
    if (skip) continue;
    cursorCandidates.push(el);
  }

  const candidates = semanticNodes.concat(cursorCandidates);

  // Semantic-priority dedupe: when two collected nodes overlap (ancestor/descendant),
  // keep the one with the lower (more semantic) priority. Tie → keep descendant (more specific).
  const kept = [];
  const dropped = new Set();
  for (let i = 0; i < candidates.length; i++) {
    if (dropped.has(candidates[i])) continue;
    const a = candidates[i];
    const pa = semanticPriority(a);
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      const b = candidates[j];
      if (dropped.has(b)) continue;
      if (!(a.contains(b) || b.contains(a))) continue;
      const pb = semanticPriority(b);
      // Winner = lower priority; tie → descendant wins.
      let loser;
      if (pa < pb) loser = b;
      else if (pb < pa) loser = a;
      else loser = a.contains(b) ? a : b;
      dropped.add(loser);
      if (loser === a) break;
    }
    if (!dropped.has(a)) kept.push(a);
  }

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

  function classifyTag(el) {
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

  function inNavOrFooter(el) {
    let p = el;
    while (p && p !== document.body) {
      const tag = p.tagName;
      const role = (p.getAttribute && p.getAttribute('role') || '').toLowerCase();
      if (tag === 'NAV' || tag === 'HEADER' || tag === 'FOOTER' || role === 'navigation') return true;
      p = p.parentElement;
    }
    return false;
  }

  function hasMeaningfulSurface(cs) {
    const bg = cs.backgroundColor || '';
    const border = cs.border || '';
    // Detect non-transparent bg or visible border.
    const bgSolid = !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const hasBorder = /\\d+px/.test(border) && !/0px/.test(border.split(' ')[0] || '');
    return bgSolid || hasBorder;
  }

  function classifyCategory(el, cs, rect, text) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if ((tag === 'BUTTON' && type === 'submit') || (tag === 'INPUT' && type === 'submit')) {
      return 'form_submit';
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    const isButtonish = tag === 'BUTTON' || tag === 'INPUT' || role === 'button' || (tag === 'A' && el.hasAttribute('href'));
    const area = rect.width * rect.height;
    const smallSquareish = rect.width <= 56 && rect.height <= 56;
    const shortLabel = text.length <= 2 || (!text && !!el.getAttribute('aria-label'));
    if (isButtonish && smallSquareish && shortLabel) return 'icon_button';

    const aboveFold = rect.top < window.innerHeight;
    const inChrome = inNavOrFooter(el);

    if (isButtonish) {
      // Multi-signal CTA primary heuristic.
      let score = 0;
      if (aboveFold) score++;
      if (text.length > 0 && text.length <= 32) score++;
      if (area >= 90 * 28) score++; // sizeable click target
      if (hasMeaningfulSurface(cs)) score++;
      if (!inChrome) score++;
      if (score >= 4) return 'cta_primary';
      if (score >= 2 && hasMeaningfulSurface(cs)) return 'cta_secondary';
    }

    if (tag === 'A' && el.hasAttribute('href')) {
      if (inChrome) return 'nav_item';
      return 'link';
    }
    return 'other';
  }

  // Intent ordlistor — partial match, case-insensitive
  const INTENT_RX = {
    conversion: /(book|buy|demo|start|get started|sign[- ]?up|signup|register|subscribe|request|trial|checkout|order|apply|donate|download|add to cart|beställ|köp|boka|prova|kom igång|skapa konto|registrera|gå med|gratis|ladda ner|lägg i (varu)?kund?korg|lägg till|ansök|bidra)/i,
    information: /(learn|read|explore|see how|how |why |about |läs|utforska|så funkar|mer info)/i,
    navigation: /(login|log in|sign in|account|menu|home|profile|settings|logga in|mina sidor|hem|inställningar)/i,
    social: /(facebook|instagram|linkedin|twitter|youtube|tiktok|share|dela)/i,
    utility: /(search|sök|language|språk|cookie|accept|godkänn|contact|kontakt|help|hjälp|faq)/i,
    engagement: /(like|love|save|bookmark|share|comment|reply|follow|subscribe|upvote|downvote|gilla|spara|kommentar|svara|följ|prenumerera|rösta|röst)/i,
  };

  const SOCIAL_HOST_RX = /(facebook|instagram|linkedin|twitter|x\\.com|youtube|tiktok|pinterest|snapchat|reddit|threads|mastodon)\\./i;

  function classifyIntent(el, text, category, rect) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isFormSubmit = (tag === 'BUTTON' && type === 'submit') || (tag === 'INPUT' && type === 'submit');
    if (isFormSubmit) return 'conversion';

    const href = (el.getAttribute('href') || '');
    if (href.startsWith('tel:') || href.startsWith('mailto:')) return 'utility';
    if (SOCIAL_HOST_RX.test(href)) return 'social';

    // data-* attribute signals (data-event, data-cta, data-track, data-analytics-*)
    const attrBag = [];
    for (const a of Array.from(el.attributes)) {
      if (a.name.startsWith('data-')) attrBag.push(a.value || '');
    }
    const attrStr = attrBag.join(' ');

    const t = (text || '').trim();
    const probe = t + ' ' + attrStr;

    if (INTENT_RX.conversion.test(probe)) return 'conversion';
    if (INTENT_RX.engagement.test(probe)) return 'engagement';
    if (INTENT_RX.navigation.test(probe)) return 'navigation';
    if (INTENT_RX.social.test(probe)) return 'social';
    if (INTENT_RX.utility.test(probe)) return 'utility';
    if (INTENT_RX.information.test(probe)) return 'information';

    // Position-based fallback: above-fold primary CTA without keyword match → likely conversion.
    if (category === 'cta_primary' && rect.top < window.innerHeight) return 'conversion';

    // Text-less icon buttons in a horizontal row of ≥3 siblings → engagement toolbar.
    if (!t && category === 'icon_button') {
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) =>
          c.tagName === 'BUTTON' || c.tagName === 'A' || (c.getAttribute && c.getAttribute('role') === 'button')
        );
        if (siblings.length >= 3) return 'engagement';
      }
    }

    return 'unknown';
  }

  // Section detection — walk ancestors to find the structural container.
  const viewportH = window.innerHeight || 720;
  function detectSection(el, rect) {
    let p = el.parentElement;
    let inHeader = false, inFooter = false, inNav = false, inMain = false, inAside = false;
    let cardsAncestor = null;
    while (p && p !== document.body) {
      const tag = p.tagName;
      const role = (p.getAttribute && p.getAttribute('role') || '').toLowerCase();
      if (tag === 'NAV' || role === 'navigation') inNav = true;
      else if (tag === 'HEADER' || role === 'banner') inHeader = true;
      else if (tag === 'FOOTER' || role === 'contentinfo') inFooter = true;
      else if (tag === 'MAIN' || role === 'main') inMain = true;
      else if (tag === 'ASIDE') inAside = true;

      // Cards heuristic: container with ≥3 direct children of same tagName + similar height.
      if (!cardsAncestor && p.children && p.children.length >= 3) {
        const kids = Array.from(p.children);
        const firstTag = kids[0].tagName;
        const sameTag = kids.filter((c) => c.tagName === firstTag);
        if (sameTag.length >= 3) {
          const heights = sameTag.slice(0, 4).map((c) => c.getBoundingClientRect().height).filter((h) => h > 30);
          if (heights.length >= 3) {
            const avg = heights.reduce((s, v) => s + v, 0) / heights.length;
            const allSimilar = heights.every((h) => Math.abs(h - avg) / avg < 0.4);
            if (allSimilar) cardsAncestor = p;
          }
        }
      }
      p = p.parentElement;
    }

    if (inFooter) return 'footer';
    if (inNav) return 'nav';
    if (inHeader) return 'header';
    if (cardsAncestor) return 'cards';
    // Hero: above the fold + element is in the first big block of <main> (or just first 1.2 viewports).
    const docTop = rect.top + window.scrollY;
    if (docTop < viewportH * 1.2 && inMain) return 'hero';
    if (docTop < viewportH * 1.0 && !inAside) return 'hero';
    return 'content';
  }



  // WCAG relative luminance + contrast ratio
  function parseRgb(s) {
    if (!s) return null;
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((v) => parseFloat(v.trim()));
    if (parts.length < 3) return null;
    const a = parts.length >= 4 ? parts[3] : 1;
    if (a === 0) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  function relLum(c) {
    const ch = [c.r, c.g, c.b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrastRatio(a, b) {
    const la = relLum(a), lb = relLum(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  const bodyBg = parseRgb(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm(v, lo, hi) { return (clamp(v, lo, hi) - lo) / (hi - lo); }

  const docH = document.documentElement.scrollHeight || window.innerHeight;
  const docW = document.documentElement.scrollWidth || window.innerWidth;

  // First pass: collect raw records
  const raw = [];
  let maxArea = 1;
  for (const el of kept) {
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    if (!isVisible(el, cs, rect)) continue;
    const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    const attrs = {};
    for (const a of Array.from(el.attributes)) {
      attrs[a.name] = (a.value || '').slice(0, 200);
    }

    const docTop = rect.top + window.scrollY;
    const docLeft = rect.left + window.scrollX;
    const yPercent = docH > 0 ? (docTop / docH) * 100 : 0;
    const xPercent = docW > 0 ? ((docLeft + rect.width / 2) / docW) * 100 : 0;
    const viewportZone =
      docTop < window.innerHeight ? 'above_fold' :
      docTop < 2 * window.innerHeight ? 'mid_page' :
      'below_fold';

    const area = rect.width * rect.height;
    if (area > maxArea) maxArea = area;
    const fontSize = parseFloat(cs.fontSize) || 14;
    const fontWeight = parseInt(cs.fontWeight, 10) || 400;
    const elBg = parseRgb(cs.backgroundColor);
    const backgroundContrast = elBg ? contrastRatio(elBg, bodyBg) : 1;

    raw.push({
      el, rect, cs, text, attrs,
      docTop, docLeft, yPercent, xPercent, viewportZone,
      area, fontSize, fontWeight, backgroundContrast,
    });
  }

  // Second pass: normalize visualWeight score and emit
  const out = [];
  for (const r of raw) {
    const areaN = r.area / maxArea;                  // 0–1
    const fontN = norm(r.fontSize, 10, 48);           // 0–1
    const weightN = norm(r.fontWeight, 300, 800);     // 0–1
    const contrastN = norm(r.backgroundContrast, 1, 10); // 0–1
    const score = Math.round((areaN * 0.40 + fontN * 0.20 + weightN * 0.10 + contrastN * 0.30) * 100);

    const cat = classifyCategory(r.el, r.cs, r.rect, r.text);
    out.push({
      text: r.text,
      tagName: classifyTag(r.el),
      selector: buildSelector(r.el),
      category: cat,
      intent: classifyIntent(r.el, r.text, cat, r.rect),
      section: detectSection(r.el, r.rect),
      href: r.el.tagName === 'A' ? (r.el.getAttribute('href') || null) : null,
      disabled: !!r.el.disabled || r.el.getAttribute('aria-disabled') === 'true',
      visible: true,
      aboveFold: r.viewportZone === 'above_fold',

      rect: { x: Math.round(r.rect.x), y: Math.round(r.rect.y), w: Math.round(r.rect.width), h: Math.round(r.rect.height) },
      position: {
        viewportZone: r.viewportZone,
        yPercent: Math.round(r.yPercent * 10) / 10,
        xPercent: Math.round(r.xPercent * 10) / 10,
      },
      visualWeight: {
        area: Math.round(r.area),
        fontSize: Math.round(r.fontSize),
        fontWeight: r.fontWeight,
        backgroundContrast: Math.round(r.backgroundContrast * 10) / 10,
        score,
      },
      attributes: r.attrs,
      computedStyles: {
        color: r.cs.color,
        backgroundColor: r.cs.backgroundColor,
        fontSize: r.cs.fontSize,
        fontWeight: r.cs.fontWeight,
        padding: r.cs.padding,
        borderRadius: r.cs.borderRadius,
        border: r.cs.border,
        cursor: r.cs.cursor,
        display: r.cs.display,
      },
    });
  }
  return out;
})()`;


// Injected into the live Browserbase page to draw color-coded highlight rectangles per category.
function OVERLAY_FN(pairs: Array<[string, string]>) {
  const OVERLAY_ID = "__lovable_collect_overlay__";
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const COLORS: Record<string, string> = {
    cta_primary: "#10b981",
    cta_secondary: "#22d3ee",
    form_submit: "#f59e0b",
    icon_button: "#a78bfa",
    nav_item: "#64748b",
    link: "#60a5fa",
    other: "#f472b6",
  };

  const wrap = document.createElement("div");
  wrap.id = OVERLAY_ID;
  wrap.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;";
  document.body.appendChild(wrap);

  pairs.forEach(([sel, category], i) => {
    let el: Element | null = null;
    try { el = document.querySelector(sel); } catch { el = null; }
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const color = COLORS[category] ?? COLORS.other;

    const box = document.createElement("div");
    box.style.cssText = [
      "position:absolute",
      `top:${Math.round(r.top + window.scrollY)}px`,
      `left:${Math.round(r.left + window.scrollX)}px`,
      `width:${Math.round(r.width)}px`,
      `height:${Math.round(r.height)}px`,
      `outline:2px solid ${color}`,
      `background:${color}1f`,
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
      `background:${color}`,
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


// Runs in the browser via page.evaluate — extracts SEO/UX page-level signals.
const PAGE_AUDIT_SCRIPT = `(() => {
  function meta(name) {
    const el = document.querySelector('meta[name="' + name + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }
  function og(prop) {
    const el = document.querySelector('meta[property="' + prop + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }
  const canonicalEl = document.querySelector('link[rel="canonical"]');
  const head = {
    title: (document.title || '').trim(),
    description: meta('description'),
    canonical: canonicalEl ? (canonicalEl.getAttribute('href') || '') : '',
    lang: (document.documentElement.getAttribute('lang') || '').trim(),
    viewport: meta('viewport'),
    robots: meta('robots'),
    ogTitle: og('og:title'),
    ogDescription: og('og:description'),
    ogImage: og('og:image'),
    ogType: og('og:type'),
    ogUrl: og('og:url'),
    twitterCard: meta('twitter:card'),
    twitterTitle: meta('twitter:title'),
    twitterImage: meta('twitter:image'),
  };

  const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const hierarchy = hs.slice(0, 50).map((h) => ({
    level: parseInt(h.tagName.substring(1), 10),
    text: (h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
    id: h.id || '',
  }));
  const headings = {
    h1Count: hs.filter((h) => h.tagName === 'H1').length,
    h2Count: hs.filter((h) => h.tagName === 'H2').length,
    h3Count: hs.filter((h) => h.tagName === 'H3').length,
    hierarchy,
  };

  const imgs = Array.from(document.querySelectorAll('img'));
  const imgTotal = imgs.length;
  const imgMissingAlt = imgs.filter((i) => !i.hasAttribute('alt') || (i.getAttribute('alt') || '').trim() === '').length;
  const imgMissingDims = imgs.filter((i) => !i.hasAttribute('width') || !i.hasAttribute('height')).length;
  const imgLazy = imgs.filter((i) => (i.getAttribute('loading') || '').toLowerCase() === 'lazy').length;
  const images = {
    total: imgTotal,
    missingAlt: imgMissingAlt,
    missingAltPct: imgTotal > 0 ? Math.round((imgMissingAlt / imgTotal) * 1000) / 10 : 0,
    missingDims: imgMissingDims,
    lazy: imgLazy,
  };

  const origin = location.origin;
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  let internal = 0, external = 0, nofollow = 0;
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    const rel = (a.getAttribute('rel') || '').toLowerCase();
    if (rel.includes('nofollow')) nofollow++;
    try {
      const url = new URL(href, origin);
      if (url.origin === origin) internal++;
      else external++;
    } catch (e) {}
  }
  const links = { internal, external, nofollow, total: internal + external };

  const ldNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const ldTypes = new Set();
  for (const n of ldNodes) {
    try {
      const parsed = JSON.parse(n.textContent || '');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of arr) {
        if (it && it['@type']) {
          if (Array.isArray(it['@type'])) it['@type'].forEach((t) => ldTypes.add(t));
          else ldTypes.add(it['@type']);
        }
      }
    } catch (e) {}
  }
  const schema = { count: ldNodes.length, types: Array.from(ldTypes) };

  const main = document.querySelector('main') || document.body;
  const wordCount = ((main && main.innerText) || '').trim().split(/\\s+/).filter(Boolean).length;
  const content = {
    wordCount,
    sections: document.querySelectorAll('section').length,
    articles: document.querySelectorAll('article').length,
  };

  return {
    url: location.href,
    head,
    headings,
    images,
    links,
    schema,
    content,
  };
})()`;


// Deterministic section inventory — walks structural landmarks.
const SECTIONS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
    if (testId) return el.tagName.toLowerCase() + '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = same.indexOf(el) + 1;
      const parentSel = parent === document.body ? 'body' : parent.tagName.toLowerCase();
      return parentSel + ' > ' + el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
    }
    return el.tagName.toLowerCase();
  }

  function classifyKind(el, rect) {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'NAV' || role === 'navigation') return 'nav';
    if (tag === 'FOOTER' || role === 'contentinfo') return 'footer';
    if (tag === 'HEADER' || role === 'banner') return 'header';
    if (tag === 'ASIDE' || role === 'complementary') return 'aside';
    // hero: first big direct child of <main> sitting in the first viewport.
    if (rect.top + window.scrollY < viewportH * 1.1) return 'hero';
    return 'content';
  }

  function repeatedChildrenCount(el) {
    if (!el.children || el.children.length < 3) return 0;
    const kids = Array.from(el.children);
    const byTag = {};
    for (const c of kids) byTag[c.tagName] = (byTag[c.tagName] || 0) + 1;
    let maxRun = 0;
    for (const k in byTag) if (byTag[k] > maxRun) maxRun = byTag[k];
    if (maxRun < 3) return 0;
    const firstTag = kids.find((c) => byTag[c.tagName] === maxRun).tagName;
    const sameTag = kids.filter((c) => c.tagName === firstTag);
    const heights = sameTag.slice(0, 6).map((c) => c.getBoundingClientRect().height).filter((h) => h > 30);
    if (heights.length < 3) return 0;
    const avg = heights.reduce((s, v) => s + v, 0) / heights.length;
    const allSimilar = heights.every((h) => Math.abs(h - avg) / avg < 0.4);
    return allSimilar ? maxRun : 0;
  }

  function firstHeading(el) {
    const h = el.querySelector('h1,h2,h3');
    return h ? (h.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120) : '';
  }

  const seen = new Set();
  const out = [];

  function addNode(el) {
    if (!el || seen.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    seen.add(el);
    let kind = classifyKind(el, rect);
    const repeated = repeatedChildrenCount(el);
    if (repeated >= 3 && kind === 'content') kind = 'cards';
    out.push({
      kind,
      selector: buildSelector(el),
      rect: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      aboveFold: rect.top < viewportH,
      childCount: el.children ? el.children.length : 0,
      repeatedChildren: repeated,
      headingText: firstHeading(el),
    });
  }

  // 1) Structural landmarks.
  const landmarks = document.querySelectorAll(
    'header, nav, main, footer, aside, ' +
    '[role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"]'
  );
  landmarks.forEach(addNode);

  // 2) Direct children of <main> (or body) — these are the "sections".
  const main = document.querySelector('main') || document.body;
  if (main && main.children) {
    for (const child of Array.from(main.children)) {
      const r = child.getBoundingClientRect();
      if (r.height < 120) continue;
      addNode(child);
    }
  }

  // 3) Explicit <section> / <article> nodes that weren't already added.
  document.querySelectorAll('section, article').forEach(addNode);

  // Sort by docY for stable order.
  out.sort((a, b) => a.rect.y - b.rect.y);
  return out;
})()`;


// Deterministic trust signal detection — text + DOM patterns.
const TRUST_SIGNALS_SCRIPT = `(() => {
  const viewportH = window.innerHeight || 720;

  const PATTERNS = {
    testimonial:        /testimonial|kundr[öo]st|kundcitat|customer story|case study/i,
    review_rating:      /\\b(\\d[.,]\\d)\\s*\\/\\s*5\\b|\\b(\\d[.,]\\d)\\s*av\\s*5\\b|\\b(\\d[.,]\\d)\\s*out of\\s*5\\b/i,
    trusted_by:         /trusted by|used by|anv[äa]nds av|v[åa]ra kunder|featured in|som setts i|our clients/i,
    certification:      /\\bISO\\s?\\d{4,5}\\b|\\bGDPR\\b|\\bHIPAA\\b|\\bSOC ?2\\b|\\bPCI[- ]?DSS\\b|certifierad|certified/i,
    guarantee:          /(\\d+)[- ]?(day|dagars?)\\s+(money[- ]back|n[öo]jd[- ]?kund|garanti|guarantee)|return policy|[öo]ppet k[öo]p|money[- ]back guarantee/i,
    secure_payment:     /secure (checkout|payment)|s[äa]ker betalning|ssl secured|256[- ]bit/i,
    press_mention:      /as seen in|as featured in|som setts i|i pressen|in the news/i,
    social_proof_count: /\\b(\\d{1,3}(?:[ ,.]\\d{3})+|\\d{4,})\\+?\\s*(customers|users|members|kunder|anv[äa]ndare|medlemmar|downloads|nedladdningar|reviews|recensioner)/i,
    org_number:         /\\b\\d{6}-\\d{4}\\b|\\bVAT[: ]?[A-Z]{2}\\d{6,}\\b/i,
  };

  const SECTION_KIND = (function () {
    function walk(el) {
      let p = el;
      let inHeader = false, inFooter = false, inNav = false, inMain = false, inAside = false;
      while (p && p !== document.body) {
        const tag = p.tagName;
        const role = (p.getAttribute && p.getAttribute('role') || '').toLowerCase();
        if (tag === 'NAV' || role === 'navigation') inNav = true;
        else if (tag === 'HEADER' || role === 'banner') inHeader = true;
        else if (tag === 'FOOTER' || role === 'contentinfo') inFooter = true;
        else if (tag === 'MAIN' || role === 'main') inMain = true;
        else if (tag === 'ASIDE') inAside = true;
        p = p.parentElement;
      }
      return { inHeader, inFooter, inNav, inMain, inAside };
    }
    return function (el, rect) {
      const w = walk(el);
      if (w.inFooter) return 'footer';
      if (w.inNav) return 'nav';
      if (w.inHeader) return 'header';
      const docTop = rect.top + window.scrollY;
      if (docTop < viewportH * 1.1) return 'hero';
      return 'content';
    };
  })();

  function buildSelector(el) {
    if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return '#' + el.id;
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      const idx = same.indexOf(el) + 1;
      return el.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
    }
    return el.tagName.toLowerCase();
  }

  function isVisible(el) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
  }

  function nearestBlock(el) {
    let p = el;
    while (p && p !== document.body) {
      const cs = window.getComputedStyle(p);
      if (cs.display && cs.display !== 'inline' && cs.display !== 'contents') return p;
      p = p.parentElement;
    }
    return el;
  }

  const seen = new Set();
  const out = [];

  function push(type, text, el, source) {
    const block = nearestBlock(el);
    if (!isVisible(block)) return;
    const cleanText = (text || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
    const dedupeKey = type + '|' + cleanText.slice(0, 80) + '|' + buildSelector(block);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const rect = block.getBoundingClientRect();
    out.push({
      type,
      text: cleanText,
      section: SECTION_KIND(block, rect),
      aboveFold: rect.top < viewportH,
      selector: buildSelector(block),
      visualWeight: Math.round(rect.width * rect.height),
      source,
    });
  }

  // 1) Text-based scan across visible block elements.
  const blocks = document.querySelectorAll('p, li, span, h1, h2, h3, h4, h5, h6, blockquote, figcaption, div, section, article');
  for (const el of blocks) {
    // skip if has block descendants with text — let leaf win.
    let leaf = true;
    for (const c of el.children) {
      const tag = c.tagName;
      if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'H1' || tag === 'H2' || tag === 'H3') { leaf = false; break; }
    }
    if (!leaf) continue;
    const text = (el.innerText || el.textContent || '').trim();
    if (!text || text.length > 600) continue;
    for (const type in PATTERNS) {
      if (PATTERNS[type].test(text)) push(type, text, el, 'text');
    }
  }

  // 2) Star icons — find clusters of ≥3 star-like elements in one parent.
  const starNodes = Array.from(document.querySelectorAll(
    '[class*="star" i], [class*="rating" i], svg[aria-label*="star" i], i[class*="fa-star"]'
  ));
  const byParent = new Map();
  for (const n of starNodes) {
    const p = n.parentElement;
    if (!p) continue;
    const arr = byParent.get(p) || [];
    arr.push(n);
    byParent.set(p, arr);
  }
  for (const [parent, group] of byParent) {
    if (group.length < 3) continue;
    push('stars', String(group.length) + ' stars', parent, 'attr');
  }
  // Also detect star character clusters in text.
  document.querySelectorAll('p, span, div').forEach((el) => {
    if (el.children.length > 0) return;
    const t = el.textContent || '';
    if ((t.match(/[★⭐✦]/g) || []).length >= 3) push('stars', t.trim().slice(0, 60), el, 'text');
  });

  // 3) Customer logos — a row/grid of ≥4 small <img> siblings.
  document.querySelectorAll('ul, ol, div, section').forEach((el) => {
    const imgs = Array.from(el.querySelectorAll(':scope > * img, :scope > img'));
    if (imgs.length < 4) return;
    const small = imgs.filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 40 && r.width < 240 && r.height > 20 && r.height < 120;
    });
    if (small.length < 4) return;
    push('customer_logos', String(small.length) + ' logo images', el, 'img_alt');
  });

  // 4) Payment logos via img alt.
  const paymentRx = /(visa|mastercard|amex|american express|paypal|stripe|klarna|swish|apple pay|google pay)/i;
  const paymentImgs = Array.from(document.querySelectorAll('img[alt], img[src]')).filter((i) => {
    const alt = (i.getAttribute('alt') || '') + ' ' + (i.getAttribute('src') || '');
    return paymentRx.test(alt);
  });
  if (paymentImgs.length > 0) {
    const parent = paymentImgs[0].closest('div, section, footer, ul') || paymentImgs[0].parentElement;
    if (parent) push('secure_payment', paymentImgs.length + ' payment provider logos', parent, 'img_alt');
  }

  // 5) Contact info — tel:/mailto: links + phone-shaped text in footer.
  document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]').forEach((a) => {
    push('contact_info', a.getAttribute('href') || '', a, 'attr');
  });

  // 6) Schema.org — Review/AggregateRating/Organization in JSON-LD.
  const ldNodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const n of ldNodes) {
    try {
      const parsed = JSON.parse(n.textContent || '');
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of arr) {
        const type = it && it['@type'];
        const types = Array.isArray(type) ? type : [type];
        for (const t of types) {
          if (t === 'Review' || t === 'AggregateRating') {
            const rating = it.ratingValue || (it.reviewRating && it.reviewRating.ratingValue);
            push('review_rating', rating ? 'Schema rating ' + rating : 'Schema review', document.body, 'schema');
          }
          if (t === 'Organization' && (it.address || it.telephone || it.email)) {
            push('contact_info', 'Schema Organization contact', document.body, 'schema');
          }
        }
      }
    } catch (e) {}
  }

  return out;
})()`;



