// Fas 3 — redesign context assembler.
//
// Packages EVERYTHING the design LLM needs to propose a better page version for
// ONE visitor segment: the faithfully-frozen page (code + screenshot), the
// page's EXISTING content in placement order, the segment insight + WHY, the
// conversion goal, and the hard guardrails. It never invents — it hands the LLM
// the published content and lets it only REARRANGE / RETEXT / REVEAL it, phrased
// in the same reversible-op vocabulary the snippet already applies
// (move_up / set_text / condense / reveal). Pure + framework-free so it is
// unit-testable and reused by both the server loader and the lab demo.
//
// This is the ASSEMBLER only (docs/croengine-vision.md, Fas 3). Generation,
// preflight verification and per-segment serving are their own later steps.

import type { SegmentSummary } from "@/lib/dashboard/aggregate";

/** What the LLM MAY and MAY NOT do — the croengine-vision guardrails, grounded
 *  in the existing reversible ops. "Osynlig relevans": flytta/koncentrera
 *  befintligt, uppfinn aldrig. */
export interface RedesignGuardrails {
  /** Allowed moves — every one references EXISTING content by id/text. */
  allowed: string[];
  /** Hard no's — brand-eroding tricks and anything fabricated. */
  forbidden: string[];
  /** The reversible op vocabulary the output must be expressible in. */
  ops: string[];
}

export const DEFAULT_REDESIGN_GUARDRAILS: RedesignGuardrails = {
  // Ägarregeln (2026-07-28, "vi ska endast skicka runt färdiga stycken"):
  // vokabulären är OMFLYTT — flytta hela befintliga sektioner, eller lyft EN
  // färdig rad sidan redan publicerar (ordagrant). Omskrivningar (set_text),
  // reveal och condense är borttagna ur genereringen; redan GODKÄNDA varianter
  // med äldre ops servas oförändrat (appliceraren behåller stödet).
  allowed: [
    "Reorder existing sections (e.g. move social proof above pricing).",
    "Move an existing block higher/lower on the page.",
    // Samma-sida-lyftet (kandidatkatalogen 2026-07-27): op:en är alltid i
    // vokabulären — valideringen kräver ordagrann text ur sidans egen
    // grounding-korpus när ingen källsida bjuds (generate.ts).
    "Surface ONE line the page ALREADY publishes (a trust signal or section heading, verbatim) as a new block directly below the hero (op insert_snippet) — exact text only, never paraphrased.",
  ],
  forbidden: [
    "Invent any content, copy, number, testimonial or claim not already on the page.",
    "New colors, blinking, pulsing, automatic hover effects, color explosions.",
    "Popups without a clear reason, large overlays, elements that jump.",
    "Anything that changes the brand's visual identity.",
    // Task #105: snippetens CWV-vakt vägrar ops på LCP-elementet i drift och
    // fäller hela varianten — designern ska veta det INNAN den planerar, inte
    // få planen underkänd i pixelgrinden efteråt.
    "Move or rewrite the page's largest-paint (LCP) element — usually the hero image or hero headline. The serve-time performance guard blocks such an op for every real visitor, so the verifier rejects the whole variant.",
  ],
  ops: ["move_up", "insert_snippet"],
};

/** The faithfully-frozen page — the "code + screenshot" the LLM sees. Referenced
 *  by path; the bytes are attached at generation time. */
export interface RedesignPageRef {
  url: string;
  /** Full page markup, frozen (freeze.server.ts → page.mhtml). */
  frozenHtmlPath: string;
  /** Rendered screenshot of the real page. */
  screenshotPath: string;
  viewport: { width: number; height: number };
}

/** The page's EXISTING content, in placement order — the "don't invent"
 *  boundary. A subset of PageAuditData the redesign reasons over. */
export interface RedesignContentModel {
  sections: {
    id: string;
    type: string;
    position: number;
    heading: string;
    aboveFold: boolean;
    visualWeight: number;
    /** Proof (logos / social-proof counts) detected in the section's own body,
     *  even when its heading has no magic word — the "which section holds the
     *  proof" signal reorder needs (ADR-001 step 3). */
    containsTrustSignals?: boolean;
  }[];
  trustSignals: { type: string; text: string; aboveFold: boolean; section: string }[];
  ctas: { text: string; intent?: string; aboveFold: boolean }[];
  hero?: { headline: string; subheadline?: string };
}

/** Verbatim-quotable content from ANOTHER page on the same site (korssid-lyftet,
 *  task #117; ägarbeslut 2026-07-18: ordagrant · pris först · under hjälten).
 *  Snippets come from extractPriceSnippets over the source page's frozen HTML —
 *  the list IS the whitelist: validateOps rejects any insert whose text is not
 *  an exact entry here. Assemblers only attach source pages when the LANDING
 *  page lacks price info of its own (aldrig dubbelvisning). */
export interface SourcePageContent {
  path: string;
  snippets: { text: string; tag: string }[];
  /** "price" = beloppsutsagor; "answer" = offert-fallbacken (ägarbeslut
   *  2026-07-18): sidan publicerar inga belopp, så dess EGEN huvudutsaga
   *  ("Låt oss ge dig en offert") är svaret — serverat som länk till sidan. */
  kind?: "price" | "answer";
}

/** The segment we optimize for + the actionable WHY. */
export interface RedesignSegmentInsight {
  key: string;
  label: string;
  visitsLifetime: number;
  conversionRateLifetime: number;
  conversionRateRecent: number | null;
  trend: "rising" | "falling" | "flat" | "unknown";
  /** Data-adequacy — the LLM is told plainly when the segment is thin. */
  adequate: boolean;
  /** Frustrationssignaler + drop-off + form-abandon → the levers to pull. */
  rageRefs: { ref: string; bursts: number }[];
  formAbandonRate: number | null;
  /** Human-readable insight lines, e.g. "social proof sits below the fold". */
  observations: string[];
}

/** The complete payload handed to the design LLM. */
export interface RedesignContext {
  site: string;
  goal: { text: string | null; kind: string | null; selector: string | null };
  page: RedesignPageRef;
  content: RedesignContentModel;
  segment: RedesignSegmentInsight;
  guardrails: RedesignGuardrails;
  /** Present ⇒ insert_snippet is in the vocabulary and these are its ONLY
   *  legal quotes. Absent ⇒ single-page context, exactly as before. */
  sourcePages?: SourcePageContent[];
}

/** Classify a lifetime→recent conversion move. `minRel` guards against calling a
 *  wobble a trend on thin data. */
export function classifyTrend(
  lifetime: number,
  recent: number | null,
  minRel = 0.15,
): RedesignSegmentInsight["trend"] {
  if (recent === null || lifetime <= 0) return "unknown";
  const rel = (recent - lifetime) / lifetime;
  if (rel >= minRel) return "rising";
  if (rel <= -minRel) return "falling";
  return "flat";
}

/** Turn a dashboard SegmentSummary (lifetime + recent window) into the insight
 *  the redesign reasons over. Pure; behavior extras (rage/observations) are
 *  passed in by the caller that has the events. */
export function segmentInsightFrom(
  s: SegmentSummary,
  extras: {
    rageRefs?: { ref: string; bursts: number }[];
    formAbandonRate?: number | null;
    observations?: string[];
  } = {},
): RedesignSegmentInsight {
  const recentCr = s.recent ? s.recent.conversionRate : null;
  return {
    key: s.key,
    label: s.label,
    visitsLifetime: s.visits,
    conversionRateLifetime: s.conversionRate,
    conversionRateRecent: recentCr,
    trend: classifyTrend(s.conversionRate, recentCr),
    adequate: s.adequate,
    rageRefs: extras.rageRefs ?? [],
    formAbandonRate: extras.formAbandonRate ?? null,
    observations: extras.observations ?? [],
  };
}

/** Assemble the full redesign context. Pure — the caller loads the real page
 *  ref / content model / segment insight and hands them in. Guardrails default
 *  to the croengine-vision set. */
export function buildRedesignContext(inputs: {
  site: string;
  goal: RedesignContext["goal"];
  page: RedesignPageRef;
  content: RedesignContentModel;
  segment: RedesignSegmentInsight;
  guardrails?: RedesignGuardrails;
  sourcePages?: SourcePageContent[];
}): RedesignContext {
  const sourcePages = (inputs.sourcePages ?? []).filter((p) => p.snippets.length > 0);
  // Korssid-lyftet: med citerbara källsidor får designern även källsides-
  // raden i allowed. (insert_snippet ligger redan i grundvokabulärens ops
  // sedan samma-sida-lyftet 2026-07-27 — den gamla op-appendrade dubbletten
  // borttagen 2026-07-28.)
  const guardrails =
    inputs.guardrails ??
    (sourcePages.length === 0
      ? DEFAULT_REDESIGN_GUARDRAILS
      : {
          ...DEFAULT_REDESIGN_GUARDRAILS,
          allowed: [
            ...DEFAULT_REDESIGN_GUARDRAILS.allowed,
            "Insert ONE of the listed verbatim quotes from another page of the SAME site as a new block directly below the hero (op insert_snippet) — exact text only, never paraphrased.",
          ],
        });
  return {
    site: inputs.site,
    goal: inputs.goal,
    page: inputs.page,
    content: inputs.content,
    segment: inputs.segment,
    guardrails,
    ...(sourcePages.length > 0 ? { sourcePages } : {}),
  };
}

const pct = (v: number | null): string => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/** Serialize the context to the Markdown prompt the design LLM receives. The
 *  screenshot + frozen HTML are attached separately at call time; this is the
 *  structured brief. Emphasis throughout: REARRANGE / RETEXT existing content,
 *  reference it by id, never invent. */
export function renderRedesignPrompt(ctx: RedesignContext): string {
  const { page, content, segment: seg, goal, guardrails: g } = ctx;
  const L: string[] = [];

  L.push(`# Redesign brief — ${ctx.site} — segment: ${seg.label}`);
  L.push("");
  L.push(
    "You are optimizing ONE existing web page for ONE visitor segment. You may ONLY " +
      "rearrange, reveal, or re-tighten content THAT IS ALREADY ON THE PAGE. You must " +
      "not invent any content, copy, number, or claim. Output a short list of reversible " +
      `ops (${g.ops.join(", ")}) that each reference an existing section/element by id.`,
  );
  L.push("");

  L.push("## The page (frozen, faithful)");
  L.push(`- URL: ${page.url}`);
  L.push(`- Full markup (frozen): ${page.frozenHtmlPath}`);
  L.push(`- Screenshot (attached): ${page.screenshotPath}`);
  L.push(`- Viewport: ${page.viewport.width}×${page.viewport.height}`);
  if (goal.text || goal.kind) {
    L.push(`- Conversion goal: ${goal.text ?? "(unnamed)"}${goal.kind ? ` [${goal.kind}]` : ""}`);
  }
  L.push("");

  L.push("## Current content — in placement order (this is ALL you may work with)");
  L.push("Sections:");
  for (const s of [...content.sections].sort((a, b) => a.position - b.position)) {
    L.push(
      `  ${s.position}. [${s.id}] ${s.type}${s.containsTrustSignals ? " [proof]" : ""} — ` +
        `“${s.heading || "(no heading)"}” · ` +
        `${s.aboveFold ? "above fold" : "below fold"} · weight ${s.visualWeight}`,
    );
  }
  if (content.trustSignals.length) {
    L.push("Trust / social proof already on the page:");
    for (const t of content.trustSignals) {
      L.push(
        `  - ${t.type}: “${t.text}” · in ${t.section} · ${t.aboveFold ? "above fold" : "below fold"}`,
      );
    }
  }
  if (content.ctas.length) {
    L.push("CTAs:");
    for (const c of content.ctas) {
      L.push(
        `  - “${c.text}”${c.intent ? ` [${c.intent}]` : ""} · ${c.aboveFold ? "above fold" : "below fold"}`,
      );
    }
  }
  if (content.hero) {
    L.push(
      `Hero: “${content.hero.headline}”${content.hero.subheadline ? ` — “${content.hero.subheadline}”` : ""}`,
    );
  }
  L.push("");

  if (ctx.sourcePages?.length) {
    L.push("## Quotable content from OTHER pages on the same site (verbatim ONLY)");
    L.push(
      "This page's segment disproportionately navigates onward (see the segment " +
        "observations). You may surface ONE of these statements on this page with an " +
        "insert_snippet op — the exact text below, character for character. Any " +
        "paraphrase, combination, or other off-page text is rejected.",
    );
    for (const sp of ctx.sourcePages) {
      L.push(
        sp.kind === "answer"
          ? `From ${sp.path} (this page publishes no prices — its own answer below is shown as a LINK to the page):`
          : `From ${sp.path}:`,
      );
      for (const s of sp.snippets) L.push(`  - “${s.text}”`);
    }
    L.push("");
  }

  L.push(`## The segment — ${seg.label}`);
  L.push(
    `- Volume: ${seg.visitsLifetime} visits · conversion ${pct(seg.conversionRateLifetime)} lifetime, ` +
      `${pct(seg.conversionRateRecent)} last window (${seg.trend})`,
  );
  L.push(
    `- Data adequacy: ${seg.adequate ? "adequate" : "THIN — treat proposals as low-confidence"}`,
  );
  if (seg.formAbandonRate !== null) L.push(`- Form-abandon rate: ${pct(seg.formAbandonRate)}`);
  if (seg.rageRefs.length) {
    L.push(
      `- Frustration (rage-clicks): ${seg.rageRefs.map((r) => `${r.ref} (${r.bursts})`).join(", ")}`,
    );
  }
  for (const o of seg.observations) L.push(`- ${o}`);
  L.push("");

  L.push("## Rules");
  L.push("ALLOWED:");
  for (const a of g.allowed) L.push(`  - ${a}`);
  L.push("FORBIDDEN:");
  for (const f of g.forbidden) L.push(`  - ${f}`);
  L.push("");
  L.push(
    '## Output\nA JSON array of ops. Each op: { "op": one of ' +
      `${g.ops.join("/")}, "targetId": existing section/element id, "detail": short, ` +
      '"why": one line tying it to the segment insight }. For set_text and condense, ' +
      '"detail" is the EXACT replacement copy — same meaning, fewer words, and it must ' +
      "not introduce any number, superlative, or promise that is not already on the page " +
      "(new claims are rejected). If the segment is too thin to justify a change, return " +
      "an empty array and say why." +
      (ctx.sourcePages?.length
        ? ' For insert_snippet: { "op": "insert_snippet", "targetId": "hero", ' +
          '"sourcePath": the listed page the quote comes from, "detail": one quote from ' +
          'the list above VERBATIM, "why": ... }. At most ONE insert per plan; it is ' +
          "placed directly below the hero."
        : ""),
  );

  return L.join("\n");
}
