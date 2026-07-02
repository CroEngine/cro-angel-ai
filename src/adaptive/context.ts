// Angel Adaptive — visitor context assembly (blueprint Step 3).
//
// The browser snippet collects client-only signals (UTM, screen width, prior
// visits from localStorage, local hour). The server adds what only it can see
// from request headers (user-agent, accept-language, edge geo). This module
// merges both into a single VisitorContext. Pure functions, fully testable.

import type { ClientSignals, DeviceType, TrafficSource, VisitorContext } from "./types";

/** Signals the server derives from the incoming request headers. */
export interface ServerSignals {
  userAgent: string;
  acceptLanguage: string;
  referrer: string;
  country: string | null;
}

/** Pull the header-derived signals out of a Fetch Request. */
export function readServerSignals(request: Request): ServerSignals {
  const h = request.headers;
  return {
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
    referrer: h.get("referer") ?? "",
    // Common edge geo headers (Cloudflare / Vercel / Netlify).
    country: h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? h.get("x-country") ?? null,
  };
}

export function classifyDevice(userAgent: string, screenWidth?: number): DeviceType {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) return "mobile";
  // Fall back to viewport width when the UA is ambiguous.
  if (typeof screenWidth === "number" && screenWidth > 0) {
    if (screenWidth < 768) return "mobile";
    if (screenWidth < 1024) return "tablet";
  }
  return "desktop";
}

export function classifyBrowser(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("chrome/") && !ua.includes("edg/")) return "chrome";
  if (ua.includes("firefox/")) return "firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "safari";
  return "other";
}

export function classifyOS(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("android")) return "android";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "other";
}

/**
 * Classify the traffic source. UTM parameters win over referrer because they
 * are explicit; referrer host matching is the fallback.
 */
export function classifyTrafficSource(opts: {
  utmSource?: string;
  utmMedium?: string;
  referrer?: string;
  userAgent?: string;
}): TrafficSource {
  const src = (opts.utmSource ?? "").toLowerCase().trim();
  const medium = (opts.utmMedium ?? "").toLowerCase().trim();

  const isPaid = /(cpc|ppc|paid)/.test(medium);

  // 1. Explicit UTM source wins — it's unambiguous.
  if (src) {
    if (src.includes("google")) return isPaid ? "google_ads" : "google";
    if (src.includes("linkedin")) return "linkedin";
    if (src.includes("facebook") || src === "fb") return "facebook";
    if (src.includes("instagram") || src === "ig") return "instagram";
    if (src.includes("reddit")) return "reddit";
    if (src.includes("tiktok")) return "tiktok";
    if (src.includes("youtube") || src === "yt") return "youtube";
    if (src.includes("snapchat") || src === "snap") return "snapchat";
    if (src.includes("pinterest")) return "pinterest";
    if (src.includes("twitter") || src === "x") return "twitter";
    if (src.includes("bing")) return "bing";
    if (src.includes("newsletter") || medium.includes("email")) return "newsletter";
    if (src.includes("partner")) return "partner";
  }
  if (medium.includes("email") || medium.includes("newsletter")) return "newsletter";

  // 2. Referrer host — the classic signal when one survives.
  const ref = (opts.referrer ?? "").toLowerCase();
  if (ref) {
    let host = ref;
    try {
      host = new URL(opts.referrer as string).hostname.toLowerCase();
    } catch {
      // referrer wasn't a full URL — fall back to substring matching below.
    }
    if (host.includes("google.")) return isPaid ? "google_ads" : "google";
    if (host.includes("linkedin.")) return "linkedin";
    if (host.includes("facebook.") || host.includes("fb.")) return "facebook";
    if (host.includes("instagram.")) return "instagram";
    if (host.includes("reddit.")) return "reddit";
    if (host.includes("tiktok.")) return "tiktok";
    if (host.includes("youtube.") || host.includes("youtu.be")) return "youtube";
    if (host.includes("snapchat.")) return "snapchat";
    if (host.includes("pinterest.")) return "pinterest";
    if (host.includes("twitter.") || host === "x.com" || host.includes(".x.com") || host.includes("t.co"))
      return "twitter";
    if (host.includes("bing.")) return "bing";
    // Unknown host — fall through to the User-Agent check before giving up.
  }

  // 3. In-app browser via User-Agent. Social apps (esp. Instagram) routinely
  //    strip the referrer, so this is the only signal for those visits and
  //    needs no UTM tagging from the customer.
  const ua = opts.userAgent ?? "";
  if (ua) {
    if (/instagram/i.test(ua)) return "instagram";
    if (/fban|fbav|fb_iab|fb4a|\bfbios\b/i.test(ua)) return "facebook";
    if (/bytedancewebview|musical_ly|tiktok|\btrill\b/i.test(ua)) return "tiktok";
    if (/snapchat/i.test(ua)) return "snapchat";
    if (/pinterest/i.test(ua)) return "pinterest";
    if (/linkedinapp/i.test(ua)) return "linkedin";
    if (/twitter/i.test(ua)) return "twitter";
  }

  // 4. Referrer present but unrecognised → other; nothing at all → direct.
  return ref ? "other" : "direct";
}

function primaryLanguage(tag: string): string {
  const first = tag.split(",")[0]?.trim() ?? "";
  const lang = first.split(";")[0]?.split("-")[0]?.trim();
  return lang || "en";
}

// Path fragments that mark a CONVERSION page — the visitor is already at the
// goal (signup/checkout/booking), so goal-decoration patterns step aside.
// Deterministic and multilingual-by-structure (EN + SV terms; extend per market).
const CONVERSION_PATH_RX =
  /(sign[-_]?up|register|registrera|skapa[-_]?konto|bli[-_]?medlem|join|checkout|kassa|cart|varukorg|subscribe|prenumerera|log[-_]?in|logga[-_]?in|anmal|anm[aä]lan|boka|book(ing)?|contact|kontakt|quote|offert)/i;

/** Classify what kind of page a URL points at. Pure; safe on bad input. */
export function classifyPageType(url: string): VisitorContext["pageType"] {
  let path = "/";
  try {
    path = new URL(url).pathname || "/";
  } catch {
    return "other";
  }
  if (path === "/" || path === "") return "home";
  if (CONVERSION_PATH_RX.test(path)) return "conversion";
  // Any real sub-path is content (article, product, listing, thread, ...).
  return "content";
}

/** Merge server + client signals into the VisitorContext the engine consumes. */
export function buildVisitorContext(server: ServerSignals, client: ClientSignals): VisitorContext {
  const referrer = client.referrer || server.referrer;
  const language = client.language?.split("-")[0] || primaryLanguage(server.acceptLanguage);

  const hourOfDay =
    typeof client.hourOfDay === "number" && client.hourOfDay >= 0 && client.hourOfDay <= 23
      ? Math.floor(client.hourOfDay)
      : 12;

  return {
    trafficSource: classifyTrafficSource({
      utmSource: client.utmSource,
      utmMedium: client.utmMedium,
      referrer,
      userAgent: server.userAgent,
    }),
    device: classifyDevice(server.userAgent, client.screenWidth),
    browser: classifyBrowser(server.userAgent),
    os: classifyOS(server.userAgent),
    language,
    country: server.country,
    campaign: client.utmCampaign?.trim() || null,
    isReturning: Boolean(client.isReturning) || (client.visitCount ?? 0) > 0,
    visitCount: Math.max(0, Math.floor(client.visitCount ?? 0)),
    viewedPricing: Boolean(client.viewedPricing),
    lastPath: client.lastPath?.trim() || null,
    hourOfDay,
    url: client.url,
    pageType: classifyPageType(client.url),
  };
}
