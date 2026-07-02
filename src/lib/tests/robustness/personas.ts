// Robustness personas — synthetic VisitorContexts that exercise different rule
// branches of the decision engine, so a robustness run can check that the
// snippet applies (and reverses) the resulting adaptations on a real page.
//
// Pure: no IO. `url` is filled in per page at run time.

import { classifyPageType } from "@/adaptive/context";
import type { VisitorContext } from "@/adaptive/types";

export type PersonaId = "linkedin_desktop" | "google_mobile" | "returning_pricing" | "paid_high_intent";

const BASE: Omit<VisitorContext, "url" | "pageType"> = {
  trafficSource: "direct",
  device: "desktop",
  browser: "chrome",
  os: "macos",
  language: "en",
  country: null,
  campaign: null,
  isReturning: false,
  visitCount: 0,
  viewedPricing: false,
  lastPath: null,
  hourOfDay: 12,
};

const PERSONAS: Record<PersonaId, Omit<VisitorContext, "url" | "pageType">> = {
  // B2B: logos early, enterprise testimonial, clarify CTA (set_text), case study.
  linkedin_desktop: { ...BASE, trafficSource: "linkedin", device: "desktop" },
  // Organic mobile: shorten hero, FAQ up, clarify CTA.
  google_mobile: { ...BASE, trafficSource: "google", device: "mobile", os: "android" },
  // Returning evaluator: surface pricing, continue where left off, case study.
  returning_pricing: {
    ...BASE,
    trafficSource: "direct",
    isReturning: true,
    visitCount: 2,
    viewedPricing: true,
    lastPath: "/pricing",
  },
  // Paid high-intent: clarify CTA, no-credit-card badge, guarantee, trust badge.
  paid_high_intent: { ...BASE, trafficSource: "google_ads", device: "desktop" },
};

export const DEFAULT_PERSONA: PersonaId = "linkedin_desktop";

export const ALL_PERSONAS: PersonaId[] = [
  "linkedin_desktop",
  "google_mobile",
  "returning_pricing",
  "paid_high_intent",
];

/** Build a full VisitorContext for a persona on a given URL. */
export function personaContext(persona: PersonaId, url: string): VisitorContext {
  const base = PERSONAS[persona] ?? PERSONAS[DEFAULT_PERSONA];
  return { ...base, url, pageType: classifyPageType(url) };
}

export function isPersona(v: string): v is PersonaId {
  return v === "linkedin_desktop" || v === "google_mobile" || v === "returning_pricing" || v === "paid_high_intent";
}
