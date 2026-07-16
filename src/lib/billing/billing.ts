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

/** Prissättningen — EN plats (ägarbeslut 2026-07-16: dollar). */
export const PLAN = {
  currency: "usd",
  amountCents: 39900,
  interval: "month",
  trialDays: 30,
  label: "$399/month — first month free",
} as const;
