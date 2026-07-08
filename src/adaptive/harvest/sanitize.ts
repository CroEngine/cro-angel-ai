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

/** A CTA's bounding box (pixels only — no PII). Curation groups by size to
 *  collapse uniform strips; without it, strips can't be told apart by size. */
function cleanRect(r: unknown): { x: number; y: number; w: number; h: number } | undefined {
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v) : 0);
  return { x: n(o.x), y: n(o.y), w: n(o.w), h: n(o.h) };
}

/** A CTA's destination — the language-independent goal signal (off-domain =
 *  affiliate/outbound, /checkout = purchase, tel:/mailto: = lead/contact).
 *  Bounded; dangerous schemes are dropped, and any query string is stripped
 *  (it can carry tokens/PII) while the path — which carries the intent — stays. */
function cleanHref(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, 300);
  if (!s) return undefined;
  try {
    const u = new URL(s, "https://x.invalid");
    // Allowlist the PARSED protocol — the URL parser has already normalized
    // case and stripped embedded control chars, so this catches javascript:/
    // data: even when obfuscated (e.g. "java\tscript:"), which a pre-parse
    // regex misses.
    if (!["http:", "https:", "tel:", "mailto:"].includes(u.protocol)) return undefined;
    if (u.protocol === "tel:" || u.protocol === "mailto:") return s;
    // Relative → keep path only; absolute → origin+path (drop query/hash).
    return u.hostname === "x.invalid" ? u.pathname : u.origin + u.pathname;
  } catch {
    return undefined;
  }
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
      href: cleanHref(c.href),
      // Size (no PII) — curation's strip-collapse groups by section+size to fold
      // uniform grids. Dropping it made collapse degrade to "one CTA per section".
      rect: cleanRect(c.rect),
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

/** The observe-only structural block (forms / navigation / pricing) is
 *  diagnostic — it never feeds a pattern, so it does NOT go through the
 *  inventory mapper. This is its own privacy boundary: field TYPES and counts
 *  only (never values — the harvester already avoids them), and every text
 *  field is PII-scrubbed. Returns null when there's nothing worth storing. */
export interface ObserveStructure {
  forms: {
    fieldCount: number;
    fieldTypes: Record<string, number>;
    autocomplete: string[];
    submitText: string;
    kind: string;
    aboveFold: boolean;
  }[];
  navigation: {
    primaryLinks: number;
    footerLinks: number;
    hasSearch: boolean;
    hasBreadcrumb: boolean;
  };
  pricing: { present: boolean; priceCount: number; samples: string[] };
}

const int = (v: unknown, max = 100000) =>
  typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0;

// Standard HTML autocomplete tokens only — anything off-list is dropped so a
// hostile DOM can't smuggle free-form strings through this field.
const AUTOCOMPLETE_TOKENS = new Set([
  "name", "given-name", "family-name", "email", "username", "new-password",
  "current-password", "organization", "street-address", "postal-code",
  "country", "tel", "cc-number", "cc-name", "bday", "sex", "url", "photo",
  "address-line1", "address-line2", "address-level1", "address-level2",
]);

export function sanitizeObserve(raw: unknown): ObserveStructure | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  const hasAny = a.forms || a.navigation || a.pricing;
  if (!hasAny) return null;

  const forms = looseArray(a.forms)
    .slice(0, 10)
    .map((f) => {
      const rawTypes = (f.fieldTypes && typeof f.fieldTypes === "object"
        ? (f.fieldTypes as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const fieldTypes: Record<string, number> = {};
      for (const k of Object.keys(rawTypes).slice(0, 20)) {
        // Only short, alnum type keys (input types / tag names) — never text.
        if (/^[a-z][a-z-]{0,20}$/.test(k)) fieldTypes[k] = int(rawTypes[k], 1000);
      }
      const autocomplete = (Array.isArray(f.autocomplete) ? f.autocomplete : [])
        .filter((t): t is string => typeof t === "string" && AUTOCOMPLETE_TOKENS.has(t))
        .slice(0, 12);
      return {
        fieldCount: int(f.fieldCount, 1000),
        fieldTypes,
        autocomplete,
        submitText: cleanText(f.submitText),
        kind: typeof f.kind === "string" && /^[a-z]{1,20}$/.test(f.kind) ? f.kind : "other",
        aboveFold: Boolean(f.aboveFold),
      };
    });

  const navRaw = (a.navigation && typeof a.navigation === "object"
    ? (a.navigation as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const navigation = {
    primaryLinks: int(navRaw.primaryLinks, 2000),
    footerLinks: int(navRaw.footerLinks, 2000),
    hasSearch: Boolean(navRaw.hasSearch),
    hasBreadcrumb: Boolean(navRaw.hasBreadcrumb),
  };

  const priceRaw = (a.pricing && typeof a.pricing === "object"
    ? (a.pricing as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const pricing = {
    present: Boolean(priceRaw.present),
    priceCount: int(priceRaw.priceCount, 1000),
    samples: (Array.isArray(priceRaw.samples) ? priceRaw.samples : [])
      .slice(0, 8)
      .map(cleanText)
      .filter(Boolean),
  };

  return { forms, navigation, pricing };
}
