// Betalningens RENA kärna (testbar utan Stripe): statusmappning + vad som får
// serveras. Allt IO bor i stripe.server.ts.

/** Sajtens billing-status (angel_sites.billing_status). */
export type BillingStatus = "exempt" | "none" | "trialing" | "active" | "past_due" | "canceled";

/** Stripe subscription.status → vår sajtstatus. Okända värden mappas
 *  KONSERVATIVT till canceled (serving pausas hellre än serverar obetalt). */
export function mapSubscriptionStatus(stripeStatus: string | null | undefined): BillingStatus {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "canceled";
    default:
      return "canceled";
  }
}

/** Får varianter serveras för denna status? Observation påverkas ALDRIG av
 *  betalning — bara synliga ändringar gate:as. exempt = pilot/labb. */
export function servingAllowedForBilling(status: string | null | undefined): boolean {
  return status === "exempt" || status === "trialing" || status === "active";
}

/** Prissättningen — EN plats (ägarbeslut 2026-07-16: dollar; 2026-07-17:
 *  "gratis tills första verifierade varianten" ersätter 30-dagars-trialen —
 *  du betalar först när roboten bevisat sig; det är produktens ärlighets-
 *  kontrakt som prismodell). */
export const PLAN = {
  currency: "usd",
  amountCents: 39900,
  interval: "month",
  /** Varsel efter första verifierade varianten innan första debiteringen. */
  graceDays: 7,
  /** Övre gräns för "gratis tills bevisad" — Stripes tak för trial_end är
   *  ~2 år; en sajt utan en enda verifierad variant på 2 år är vilande och
   *  ska inte plötsligt debiteras (ägaren ser statusen långt innan dess). */
  maxTrialDays: 730,
  label: "$399/month — free until your first verified variant",
} as const;

/** Epoch-sekunder för checkoutens initiala trial_end ("gratis tills bevisad",
 *  med maxTrialDays som ärligt tak). Ren datummatte — testbar. */
export function initialTrialEnd(nowMs: number): number {
  return Math.floor(nowMs / 1000) + PLAN.maxTrialDays * 86400;
}

/** Epoch-sekunder för trial-slutet när första verifierade varianten finns:
 *  graceDays varsel, sedan första debiteringen. */
export function provenTrialEnd(nowMs: number): number {
  return Math.floor(nowMs / 1000) + PLAN.graceDays * 86400;
}
