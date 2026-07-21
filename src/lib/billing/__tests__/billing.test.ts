import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

import {
  initialTrialEnd,
  mapSubscriptionStatus,
  PLAN,
  provenTrialEnd,
  servingAllowedForBilling,
} from "../billing";
import { verifyStripeSignature } from "../stripe.server";

describe("mapSubscriptionStatus — konservativ mappning", () => {
  it("kända statusar mappas rakt", () => {
    expect(mapSubscriptionStatus("trialing")).toBe("trialing");
    expect(mapSubscriptionStatus("active")).toBe("active");
    expect(mapSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapSubscriptionStatus("unpaid")).toBe("past_due");
    expect(mapSubscriptionStatus("canceled")).toBe("canceled");
  });
  it("okända/nya Stripe-statusar pausar serving hellre än serverar obetalt", () => {
    expect(mapSubscriptionStatus("some_future_status")).toBe("canceled");
    expect(mapSubscriptionStatus(null)).toBe("canceled");
  });
});

describe("servingAllowedForBilling — observation gate:as aldrig, bara serving", () => {
  it("exempt (pilot/labb), trialing och active får servera", () => {
    for (const s of ["exempt", "trialing", "active"]) expect(servingAllowedForBilling(s)).toBe(true);
  });
  it("none/past_due/canceled/okänt pausar serving", () => {
    for (const s of ["none", "past_due", "canceled", "", null, undefined, "banana"]) {
      expect(servingAllowedForBilling(s as string | null | undefined)).toBe(false);
    }
  });
});

describe("verifyStripeSignature — HMAC + färskhetsfönster", () => {
  const secret = "whsec_test";
  const payload = '{"id":"evt_1"}';
  const sign = (t: number) =>
    `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

  it("äkta signatur inom fönstret godkänns", () => {
    expect(verifyStripeSignature(payload, sign(1000), secret, 1000)).toBe(true);
    expect(verifyStripeSignature(payload, sign(1000), secret, 1200)).toBe(true);
  });
  it("fel hemlighet, manipulerad payload eller gammal stämpel avvisas", () => {
    expect(verifyStripeSignature(payload, sign(1000), "whsec_other", 1000)).toBe(false);
    expect(verifyStripeSignature('{"id":"evt_EVIL"}', sign(1000), secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, sign(1000), secret, 1000 + 301)).toBe(false);
    expect(verifyStripeSignature(payload, null, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(payload, "t=abc,v1=deadbeef", secret, 1000)).toBe(false);
  });
});

describe("PLAN — ägarbeslut 2026-07-16 (pris) + 2026-07-17 (gratis tills bevisad)", () => {
  it("399 USD/mån, gratis tills första verifierade varianten", () => {
    expect(PLAN.currency).toBe("usd");
    expect(PLAN.amountCents).toBe(39900);
    expect(PLAN.graceDays).toBe(7);
    expect(PLAN.maxTrialDays).toBe(730);
    expect(PLAN.label).toContain("free until your first verified variant");
  });
});

describe("trial-datummatte (prismodellens trigger)", () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);
  it("initial trial_end ligger vid maxTrialDays-taket", () => {
    expect(initialTrialEnd(now)).toBe(Math.floor(now / 1000) + 730 * 86400);
  });
  it("bevisad trial_end ger graceDays varsel", () => {
    expect(provenTrialEnd(now)).toBe(Math.floor(now / 1000) + 7 * 86400);
  });
  it("varslet är alltid kortare än initiala taket (armering kortar, förlänger aldrig)", () => {
    expect(provenTrialEnd(now)).toBeLessThan(initialTrialEnd(now));
  });
});
