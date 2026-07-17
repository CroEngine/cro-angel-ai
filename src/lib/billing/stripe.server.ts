// Stripe-IO (server-only). Ingen SDK — Stripes API är form-kodat och litet
// nog för fetch (samma slimmade mönster som labeler/designer-adaptrarna).
// Utan STRIPE_SECRET_KEY är allt en artig no-op — produkten fungerar i
// observe-läge utan betalning konfigurerad.
//
// Flöde: Checkout Session (subscription, kort krävs, trial = "gratis tills
// första verifierade varianten" med maxTrialDays som tak) → webhook
// (checkout.session.completed + customer.subscription.*) → angel_billing per
// användare → billing_status synkas ut på användarens sajter (serving-grinden
// läser den via SiteConfig). När en sajts FÖRSTA verifierade variant finns
// kortar sweepProvenBilling ägarnas trial till graceDays varsel — det är
// prismodellens hela poäng: betala först när roboten bevisat sig.

import { createHmac, timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { initialTrialEnd, mapSubscriptionStatus, PLAN, provenTrialEnd } from "./billing";

const API = "https://api.stripe.com/v1";

function secretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY ?? null;
}

async function stripeFetch(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const key = secretKey();
  if (!key) return null;
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      console.warn(`[billing] stripe ${path} → ${res.status}:`, (body as { error?: { message?: string } }).error?.message);
      return null;
    }
    return body;
  } catch (err) {
    console.warn(`[billing] stripe ${path} otillgänglig:`, err);
    return null;
  }
}

/** Hämta/skapa Stripe-kund för en användare (idempotent via angel_billing). */
async function customerFor(userId: string, email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("angel_billing")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id;
  const created = await stripeFetch("/customers", {
    email,
    "metadata[user_id]": userId,
  });
  const id = typeof created?.id === "string" ? created.id : null;
  if (!id) return null;
  await supabaseAdmin
    .from("angel_billing")
    .upsert({ user_id: userId, stripe_customer_id: id }, { onConflict: "user_id" });
  return id;
}

/** Skapa en Checkout-session: prenumeration, kort krävs, trial = "gratis
 *  tills första verifierade varianten" (trial_end vid maxTrialDays-taket;
 *  sweepProvenBilling kortar den när beviset finns). Returnerar
 *  checkout-URL:en eller null (okonfigurerat/fel). */
export async function createCheckoutUrl(
  userId: string,
  email: string,
  returnUrl: string,
): Promise<string | null> {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secretKey() || !priceId) return null;
  const customer = await customerFor(userId, email);
  if (!customer) return null;
  const session = await stripeFetch("/checkout/sessions", {
    mode: "subscription",
    customer,
    client_reference_id: userId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "subscription_data[trial_end]": String(initialTrialEnd(Date.now())),
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=cancelled`,
  });
  return typeof session?.url === "string" ? session.url : null;
}

/**
 * Prismodellens trigger, som SVEP (idempotent, självläkande): sajter med
 * minst en variant i verified/serving/winner stämplas first_verified_at;
 * deras ägare med trialing-prenumeration och trial_end bortom varselfönstret
 * får trial_end kortad till graceDays varsel (proration av — första fakturan
 * kommer vid trial-slutet). Sveper man utan STRIPE_SECRET_KEY stämplas bara
 * first_verified_at — nästa svep med nyckel armerar i efterhand. exempt-
 * sajter (pilot/labb) startar ALDRIG någons klocka.
 */
export async function sweepProvenBilling(): Promise<void> {
  // 1) Stämpla first_verified_at där bevis finns men stämpel saknas.
  const { data: unstamped } = await supabaseAdmin
    .from("angel_sites")
    .select("slug")
    .is("first_verified_at", null)
    .neq("billing_status", "exempt");
  for (const site of unstamped ?? []) {
    const { data: firstVar } = await supabaseAdmin
      .from("angel_variants")
      .select("created_at")
      .eq("site", site.slug)
      .in("status", ["verified", "serving", "winner"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstVar?.created_at) {
      await supabaseAdmin
        .from("angel_sites")
        .update({ first_verified_at: firstVar.created_at })
        .eq("slug", site.slug);
      console.log(
        `[billing] ${site.slug}: första verifierade varianten stämplad (${firstVar.created_at})`,
      );
    }
  }
  if (!secretKey()) {
    console.log("[billing] STRIPE_SECRET_KEY saknas — trial-armering väntar (stämplar bara)");
    return;
  }
  // 2) Armera ägare: trialing-prenumeration + ägd bevisad sajt + trial_end
  //    bortom varselfönstret ⇒ korta till graceDays varsel.
  const { data: proven } = await supabaseAdmin
    .from("angel_sites")
    .select("slug")
    .not("first_verified_at", "is", null)
    .neq("billing_status", "exempt");
  if (!proven?.length) return;
  const graceCutoff = new Date((provenTrialEnd(Date.now()) + 86400) * 1000).toISOString();
  for (const site of proven) {
    const { data: members } = await supabaseAdmin
      .from("angel_site_members")
      .select("user_id")
      .eq("site_slug", site.slug);
    for (const m of members ?? []) {
      const { data: bill } = await supabaseAdmin
        .from("angel_billing")
        .select("stripe_subscription_id,status,trial_end")
        .eq("user_id", m.user_id)
        .maybeSingle();
      if (
        !bill?.stripe_subscription_id ||
        bill.status !== "trialing" ||
        !bill.trial_end ||
        bill.trial_end <= graceCutoff
      ) {
        continue;
      }
      const updated = await stripeFetch(`/subscriptions/${bill.stripe_subscription_id}`, {
        trial_end: String(provenTrialEnd(Date.now())),
        proration_behavior: "none",
      });
      if (updated) {
        console.log(
          `[billing] ${site.slug}: trial kortad till ${PLAN.graceDays} dagars varsel för ägare ${m.user_id}`,
        );
        // Webhooken (customer.subscription.updated) synkar angel_billing +
        // sajternas billing_status — vi rör inte statusen här.
      }
    }
  }
}

/** Kundportalen (hantera kort, säga upp). */
export async function createPortalUrl(userId: string, returnUrl: string): Promise<string | null> {
  if (!secretKey()) return null;
  const { data } = await supabaseAdmin
    .from("angel_billing")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.stripe_customer_id) return null;
  const session = await stripeFetch("/billing_portal/sessions", {
    customer: data.stripe_customer_id,
    return_url: returnUrl,
  });
  return typeof session?.url === "string" ? session.url : null;
}

/** Verifiera Stripe-Signature (v1 = HMAC-SHA256 över "t.payload") och att
 *  tidsstämpeln är färsk. Ren nog att enhetstesta med kända vektorer. */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!header) return false;
  const parts = new Map(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)] as const;
    }),
  );
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Synka en användares billing-status till angel_billing + alla sajter
 *  användaren äger — UTOM exempt-sajter (pilot/labb rörs aldrig av webhook). */
export async function syncBillingStatus(
  customerId: string,
  subscriptionId: string | null,
  stripeStatus: string | null,
  trialEnd: number | null,
  periodEnd: number | null,
): Promise<void> {
  const status = mapSubscriptionStatus(stripeStatus);
  const { data: bill } = await supabaseAdmin
    .from("angel_billing")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!bill?.user_id) {
    console.warn(`[billing] webhook för okänd kund ${customerId} — ignorerad`);
    return;
  }
  await supabaseAdmin
    .from("angel_billing")
    .update({
      stripe_subscription_id: subscriptionId,
      status,
      trial_end: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", bill.user_id);
  const { data: sites } = await supabaseAdmin
    .from("angel_site_members")
    .select("site_slug")
    .eq("user_id", bill.user_id);
  for (const s of sites ?? []) {
    await supabaseAdmin
      .from("angel_sites")
      .update({ billing_status: status })
      .eq("slug", s.site_slug)
      .neq("billing_status", "exempt");
  }
}
