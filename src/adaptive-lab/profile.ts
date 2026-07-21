// Angel Adaptive — the visitor PROFILE (E2: cohort memory, client-side).
//
// "People who arrived the same way before": a first-party, pseudonymous
// journey memory in localStorage. It answers the questions the single-page
// events cannot — where did this visitor come from (channel/source, first and
// last touch), have they been here before (visit count with a 30-minute
// session boundary), and what have they already seen (pages ring buffer,
// sticky seen-pricing flag). This is what lets price_hesitant fire on a
// HOMEPAGE because the visitor read /pricing yesterday, and it is the
// vocabulary ("src:linkedin") that E4b owner-approved rules are keyed on.
//
// Privacy stance: first-party storage only, no PII, no third-party calls —
// the profile never leaves the browser in this milestone. Size-capped,
// TTL-bounded (90 days), versioned, and throw-proof: storage failures
// (private mode, quotas, disabled) degrade to "no profile", never to an
// error on the host page.

import type { ContentInventory } from "./inventory";

export type Channel = "direct" | "search" | "social" | "ads" | "email" | "referral";
export type TouchPoint = { channel: Channel; source: string };

export type ProfilePage = { p: string; t: number; secs: string[] };

export type AngelProfile = {
  v: 1;
  firstSeen: number;
  lastSeen: number;
  visits: number;
  firstTouch: TouchPoint | null;
  lastTouch: TouchPoint | null;
  pages: ProfilePage[];
  seenPricing: boolean;
};

const STORE_KEY = "__angel_profile";
const SESSION_GAP_MS = 30 * 60 * 1000;
const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 30;
const MAX_JSON_CHARS = 6000;
// Re-crawls of the same path within this window update the existing entry
// (SPA route settling, our own repeated crawls) instead of appending.
const SAME_PAGE_WINDOW_MS = 5 * 60 * 1000;

const SEARCH_HOSTS =
  /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)yahoo\.[a-z.]+$|(^|\.)ecosia\.org$|(^|\.)baidu\.com$|(^|\.)yandex\.[a-z.]+$/;
const SOCIAL_HOSTS =
  /(^|\.)linkedin\.com$|(^|\.)lnkd\.in$|(^|\.)facebook\.com$|(^|\.)fb\.me$|(^|\.)instagram\.com$|(^|\.)twitter\.com$|(^|\.)t\.co$|(^|\.)x\.com$|(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)tiktok\.com$|(^|\.)reddit\.com$|(^|\.)pinterest\.[a-z.]+$/;
const ADS_MEDIUM = /^(cpc|ppc|paid|paidsocial|paid-social|display|banner|retargeting|remarketing)/;
const EMAIL_MEDIUM = /^(e?mail|newsletter)/;
const PRICING_PATH = /\/(pricing|prices?|plans?|priser|pris)(\/|$|\?|#)/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function socialSourceName(host: string): string {
  // Short domains anchored — unanchored /t\.co/ matches inside "reddit.com".
  if (/linkedin|(^|\.)lnkd\.in$/.test(host)) return "linkedin";
  if (/facebook|(^|\.)fb\.me$/.test(host)) return "facebook";
  if (/instagram/.test(host)) return "instagram";
  if (/twitter|(^|\.)t\.co$|(^|\.)x\.com$/.test(host)) return "x";
  if (/youtu/.test(host)) return "youtube";
  if (/tiktok/.test(host)) return "tiktok";
  if (/reddit/.test(host)) return "reddit";
  if (/pinterest/.test(host)) return "pinterest";
  return host;
}

function searchSourceName(host: string): string {
  if (/google/.test(host)) return "google";
  if (/bing/.test(host)) return "bing";
  if (/duckduckgo/.test(host)) return "duckduckgo";
  if (/yahoo/.test(host)) return "yahoo";
  if (/ecosia/.test(host)) return "ecosia";
  if (/baidu/.test(host)) return "baidu";
  if (/yandex/.test(host)) return "yandex";
  return host;
}

/**
 * Classify how this pageview was reached. Pure. Returns null for internal
 * navigation (same-site referrer with no campaign parameters) — the existing
 * touch stands. UTM/click-id parameters outrank the referrer: an ads click
 * from google carries referrer google but is an ads touch, not a search one.
 */
export function classifyTouch(
  referrer: string,
  search: string,
  ownHost: string,
): TouchPoint | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    params = new URLSearchParams();
  }
  const utmSource = (params.get("utm_source") || "").toLowerCase().trim();
  const utmMedium = (params.get("utm_medium") || "").toLowerCase().trim();
  const refHost = hostOf(referrer);
  const own = (ownHost || "").toLowerCase().replace(/^www\./, "");

  if (params.get("gclid")) return { channel: "ads", source: utmSource || "google" };
  if (params.get("fbclid")) return { channel: "ads", source: utmSource || "facebook" };
  if (utmMedium && ADS_MEDIUM.test(utmMedium)) {
    return { channel: "ads", source: utmSource || refHost || "unknown" };
  }
  if (utmMedium && EMAIL_MEDIUM.test(utmMedium)) {
    return { channel: "email", source: utmSource || "email" };
  }
  if (utmSource) {
    if (SOCIAL_HOSTS.test(utmSource) || /^(linkedin|facebook|instagram|twitter|x|youtube|tiktok|reddit|pinterest)$/.test(utmSource)) {
      return { channel: "social", source: socialSourceName(utmSource) };
    }
    if (/^(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex)$/.test(utmSource)) {
      return { channel: "search", source: utmSource };
    }
    return { channel: "referral", source: utmSource };
  }

  if (!refHost) return referrer === "" && !utmSource ? { channel: "direct", source: "direct" } : null;
  if (own && (refHost === own || refHost.endsWith("." + own))) return null; // internal nav
  if (SEARCH_HOSTS.test(refHost)) return { channel: "search", source: searchSourceName(refHost) };
  if (SOCIAL_HOSTS.test(refHost)) return { channel: "social", source: socialSourceName(refHost) };
  return { channel: "referral", source: refHost };
}

export type PageVisit = {
  path: string;
  ts: number;
  sectionTypes: string[];
  touch: TouchPoint | null;
};

/** Fold one pageview into the profile. Pure — no DOM, no storage. */
export function foldPageIntoProfile(prev: AngelProfile | null, visit: PageVisit): AngelProfile {
  const expired = prev && visit.ts - prev.lastSeen > TTL_MS;
  const base: AngelProfile =
    !prev || expired || prev.v !== 1
      ? {
          v: 1,
          firstSeen: visit.ts,
          lastSeen: visit.ts,
          visits: 1,
          firstTouch: visit.touch,
          lastTouch: visit.touch,
          pages: [],
          seenPricing: false,
        }
      : { ...prev, pages: prev.pages.slice() };

  if (prev && !expired && prev.v === 1) {
    if (visit.ts - prev.lastSeen > SESSION_GAP_MS) base.visits = prev.visits + 1;
    if (visit.touch) base.lastTouch = visit.touch;
    if (!base.firstTouch && visit.touch) base.firstTouch = visit.touch;
    base.lastSeen = visit.ts;
  }

  const pricingHere =
    PRICING_PATH.test(visit.path) || visit.sectionTypes.indexOf("pricing") !== -1;
  if (pricingHere) base.seenPricing = true;

  const last = base.pages[base.pages.length - 1];
  if (last && last.p === visit.path && visit.ts - last.t < SAME_PAGE_WINDOW_MS) {
    last.t = visit.ts;
    for (const s of visit.sectionTypes) if (last.secs.indexOf(s) === -1) last.secs.push(s);
  } else {
    base.pages.push({ p: visit.path, t: visit.ts, secs: visit.sectionTypes.slice(0, 12) });
    if (base.pages.length > MAX_PAGES) base.pages.splice(0, base.pages.length - MAX_PAGES);
  }
  return base;
}

/** Serialize under the size cap, dropping oldest pages first. */
export function serializeProfile(profile: AngelProfile): string {
  const copy: AngelProfile = { ...profile, pages: profile.pages.slice() };
  let json = JSON.stringify(copy);
  while (json.length > MAX_JSON_CHARS && copy.pages.length > 1) {
    copy.pages.shift();
    json = JSON.stringify(copy);
  }
  return json;
}

export function loadProfile(now: number): AngelProfile | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AngelProfile;
    if (!parsed || parsed.v !== 1 || typeof parsed.lastSeen !== "number") return null;
    if (now - parsed.lastSeen > TTL_MS) return null;
    if (!Array.isArray(parsed.pages)) parsed.pages = [];
    return parsed;
  } catch {
    return null;
  }
}

function saveProfile(profile: AngelProfile): void {
  try {
    window.localStorage.setItem(STORE_KEY, serializeProfile(profile));
  } catch {
    /* storage unavailable/full — profile is best-effort */
  }
}

/**
 * Record the current pageview and return the updated profile. Browser entry —
 * never throws; returns null when storage is unusable AND folding fails.
 */
export function updateProfile(inv: ContentInventory | null): AngelProfile | null {
  try {
    const now = Date.now();
    const prev = loadProfile(now);
    const touch = classifyTouch(document.referrer || "", location.search || "", location.hostname);
    const sectionTypes = inv ? inv.sections.map((s) => s.type) : [];
    const profile = foldPageIntoProfile(prev, {
      path: location.pathname || "/",
      ts: now,
      sectionTypes,
      touch,
    });
    saveProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

/**
 * The cohort vocabulary: stable keys that describe this visitor's situation.
 * These are the identifiers cohort-scoped rules (E4b approvals) match on.
 */
export function deriveCohorts(profile: AngelProfile | null): string[] {
  if (!profile) return [];
  const out: string[] = [];
  if (profile.lastTouch) {
    out.push("ch:" + profile.lastTouch.channel);
    if (profile.lastTouch.source && profile.lastTouch.source !== profile.lastTouch.channel) {
      out.push("src:" + profile.lastTouch.source);
    }
  }
  out.push(profile.visits >= 2 ? "ret:2plus" : "ret:new");
  if (profile.seenPricing) out.push("seen:pricing");
  return out;
}
