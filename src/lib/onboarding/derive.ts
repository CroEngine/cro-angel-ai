// Onboardingens RENA del (ägarbeslut 2026-08-18, "snuskigt enkel"): allt som
// går att härleda ur det prospektet redan gett oss härleds — aldrig frågas om
// igen. Demo-jobbet bär URL:en ⇒ domän, slug och namn faller ut ur den.
// localStorage-handoffen (try → signup → welcome) kodas här så TTL-regeln och
// formatet är testade i stället för utspridda.

import { normalizeDomain } from "../../adaptive/domain";

export interface DerivedActivation {
  /** Normaliserad domän ("exempel.se") — unik nyckel över alla sajter. */
  domain: string;
  /** Sajtens slug = domänen. Slug-vitlistan tillåter punkter, och domänens
   *  unikhet gör kollisioner till samma fall som "domänen är tagen". */
  slug: string;
  /** Visningsnamn — värdnamnet utan www. */
  name: string;
}

/** URL ur demo-jobbet → allt sajtskapandet behöver. null när adressen inte
 *  bär en normaliserbar publik domän (då får dashboardens formulär ta det). */
export function deriveActivation(url: string): DerivedActivation | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const domain = normalizeDomain(host);
  if (!domain) return null;
  return { domain, slug: domain, name: host.replace(/^www\./, "") };
}

/** try → signup → welcome-handoffen. localStorage (inte sessionStorage):
 *  mejlbekräftelsens länk öppnar ofta en NY flik, och sessionStorage är
 *  per-flik — då hade aktiveringen tyst tappats. */
export const PENDING_ACTIVATION_KEY = "angel-activate";
const PENDING_TTL_MS = 24 * 3600 * 1000;

export function encodePendingActivation(jobId: string, now: number): string {
  return JSON.stringify({ jobId, at: now });
}

/** Ärlig felöversättning för spara-medan-du-väntar-kortet på /try — SAMMA
 *  domslut som /welcome:s felvägar (2026-08-19): definitiva avslag ⇒ rensa
 *  handoffen och peka mot dashboarden; transienta ⇒ behåll handoffen och bjud
 *  på nytt försök. Ren funktion så mappningen är testad, inte utspridd. */
export function activationFailureMessage(reason: string | null | undefined): {
  text: string;
  definitive: boolean;
} {
  if (reason === "domain_taken" || reason === "taken") {
    return {
      text: "That website is already registered to another account. If it's yours, sign in with that account — or contact us.",
      definitive: true,
    };
  }
  if (reason === "job_not_found" || reason === "bad_domain") {
    return {
      text: "We couldn't carry this example over — add your site from the dashboard instead.",
      definitive: true,
    };
  }
  return { text: "Something went wrong on our side — try again.", definitive: false };
}

/** Avkoda + TTL-vakta. Trasig/for gammal post ⇒ null — aldrig ett kast i
 *  auth-flödet. */
export function decodePendingActivation(raw: string | null, now: number): { jobId: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { jobId?: unknown; at?: unknown };
    if (typeof parsed.jobId !== "string" || typeof parsed.at !== "number") return null;
    if (!/^[0-9a-f-]{36}$/i.test(parsed.jobId)) return null;
    if (now - parsed.at > PENDING_TTL_MS) return null;
    return { jobId: parsed.jobId };
  } catch {
    return null;
  }
}
