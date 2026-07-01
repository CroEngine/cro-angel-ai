// Angel Adaptive — sanitize a harvested page audit before it crosses the wire.
//
// The snippet harvester runs on a REAL visitor's page, so its raw output can
// contain anything in the DOM. This module is the privacy boundary: it keeps
// ONLY the inventory-relevant, published-marketing fields that
// mapAuditToInventory reads (url, ctas, hero, headings.h1Texts, trustSignals,
// sections) and scrubs PII from every text field. Everything else the crawler's
// full PageAuditData carries (images, videos, robots/sitemap, head, form field
// values, …) is dropped — it never reaches the server or storage.
//
// Pure and framework-free so it can be unit-tested and (later) reused in the
// browser bundle.

import type { PageAuditData } from "@/lib/tests/schema";

const MAX_TEXT = 200;
// Hard caps so a hostile/huge DOM can't produce an unbounded payload.
const MAX_ITEMS = 200;
const MAX_H1 = 20;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// 8+ digits, possibly split by spaces/dashes — phone / card / account-ish.
const LONG_DIGITS = /\b\d[\d\s-]{6,}\d\b/g;

/** Collapse whitespace, strip obvious PII, cap length. Non-strings → "". */
export function cleanText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .replace(EMAIL, "[redacted]")
    .replace(LONG_DIGITS, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

function optText(s: unknown): string | undefined {
  const t = cleanText(s);
  return t || undefined;
}

function optSelector(s: unknown): string | undefined {
  return typeof s === "string" && s ? s : undefined;
}

function looseArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? (v.slice(0, MAX_ITEMS).filter((x) => x && typeof x === "object") as Record<string, unknown>[])
    : [];
}

/** URL without query/hash — those can carry tokens or personal identifiers. */
function safeUrl(u: unknown): string | undefined {
  if (typeof u !== "string" || !u) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.origin + parsed.pathname;
  } catch {
    return undefined;
  }
}

/**
 * Reduce a raw harvested audit to the PII-scrubbed subset the inventory mapper
 * consumes. Returns a Partial<PageAuditData>; missing/invalid input yields an
 * empty object rather than throwing.
 */
export function sanitizeAudit(raw: unknown): Partial<PageAuditData> {
  const a = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const url = safeUrl(a.url);
  if (url) out.url = url;

  const ctas = looseArray(a.ctas)
    .map((c) => ({
      text: cleanText(c.text),
      intent: c.intent,
      category: c.category,
      section: c.section,
      aboveFold: Boolean(c.aboveFold),
      selector: optSelector(c.selector),
    }))
    .filter((c) => c.text || c.selector);
  if (ctas.length) out.ctas = ctas;

  if (a.hero && typeof a.hero === "object") {
    const h = a.hero as Record<string, unknown>;
    out.hero = {
      headline: cleanText(h.headline),
      subheadline: cleanText(h.subheadline),
      primaryCtaText: cleanText(h.primaryCtaText),
      primaryCtaIntent: typeof h.primaryCtaIntent === "string" ? h.primaryCtaIntent : "",
      aboveFold: Boolean(h.aboveFold),
    };
  }

  const h1Texts = (Array.isArray((a.headings as Record<string, unknown>)?.h1Texts)
    ? ((a.headings as Record<string, unknown>).h1Texts as unknown[])
    : []
  )
    .slice(0, MAX_H1)
    .map(cleanText)
    .filter(Boolean);
  if (h1Texts.length) out.headings = { h1Texts };

  const trustSignals = looseArray(a.trustSignals)
    .map((t) => ({
      type: t.type,
      text: cleanText(t.text),
      selector: optSelector(t.selector),
      // personName/company come from published testimonials/logos (public
      // marketing copy), not the visitor — kept, but still length/PII-scrubbed.
      personName: optText(t.personName),
      company: optText(t.company),
      logoCount: typeof t.logoCount === "number" ? t.logoCount : undefined,
    }))
    .filter((t) => t.type);
  if (trustSignals.length) out.trustSignals = trustSignals;

  const sections = looseArray(a.sections)
    .map((s) => ({
      id: typeof s.id === "string" ? s.id.slice(0, 120) : "",
      type: s.type,
      position: typeof s.position === "number" ? s.position : 0,
      heading: cleanText(s.heading),
      selector: optSelector(s.selector),
    }))
    .filter((s) => s.type);
  if (sections.length) out.sections = sections;

  return out as Partial<PageAuditData>;
}
