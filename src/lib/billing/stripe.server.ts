// Stripe-IO (server-only). Ingen SDK — Stripes API är form-kodat och litet
// nog för fetch (samma slimmade mönster som labeler/designer-adaptrarna).
// Utan STRIPE_SECRET_KEY är allt en artig no-op — produkten fungerar i
// observe-läge utan betalning konfigurerad.
//
// Flöde: Checkout Session (subscription, 30 dagars trial, kort krävs — det är
// Checkouts default i subscription-läge) → webhook (checkout.session.completed
// + customer.subscription.*) → angel_billing per användare → billing_status
// synkas ut på användarens sajter (serving-grinden läser den via SiteConfig).

import { createHmac, timingSafeEqual } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mapSubscriptionStatus } from "./billing";

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

/** Skapa en Checkout-session: prenumeration, 30 dagars trial, kort krävs.
 *  Returnerar checkout-URL:en eller null (okonfigurerat/fel). */
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
    "subscription_data[trial_period_days]": "30",
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=cancelled`,
  });
  return typeof session?.url === "string" ? session.url : null;
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
