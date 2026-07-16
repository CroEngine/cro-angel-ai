// Stripe-webhooken — enda vägen billing-status ändras (aldrig från klienten).
// Signaturverifieras (HMAC, färskhetsfönster) innan något röres; overifierat
// eller okonfigurerat ⇒ 400/503 utan sidoeffekter.

import { createFileRoute } from "@tanstack/react-router";

import { syncBillingStatus, verifyStripeSignature } from "@/lib/billing/stripe.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface SubscriptionObj {
  id?: string;
  customer?: string;
  status?: string;
  trial_end?: number | null;
  current_period_end?: number | null;
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return json({ ok: false, reason: "not_configured" }, 503);
        const payload = await request.text();
        if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
          return json({ ok: false, reason: "bad_signature" }, 400);
        }
        let event: { type?: string; data?: { object?: Record<string, unknown> } };
        try {
          event = JSON.parse(payload) as typeof event;
        } catch {
          return json({ ok: false, reason: "bad_json" }, 400);
        }
        const obj = event.data?.object ?? {};
        try {
          switch (event.type) {
            case "checkout.session.completed": {
              // Kunden slutförde checkout — prenumerationen finns nu; läs dess
              // status via subscription-eventen som följer, men stämpla direkt
              // så dashboarden inte visar "none" i mellanrummet.
              const customer = typeof obj.customer === "string" ? obj.customer : null;
              const sub = typeof obj.subscription === "string" ? obj.subscription : null;
              if (customer) await syncBillingStatus(customer, sub, "trialing", null, null);
              break;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              const s = obj as SubscriptionObj;
              if (typeof s.customer === "string") {
                await syncBillingStatus(
                  s.customer,
                  s.id ?? null,
                  event.type === "customer.subscription.deleted" ? "canceled" : (s.status ?? null),
                  s.trial_end ?? null,
                  s.current_period_end ?? null,
                );
              }
              break;
            }
            default:
              break; // ointressanta events kvitteras bara
          }
        } catch (err) {
          console.warn(`[billing] webhook-hantering föll:`, err);
          // 200 ändå: Stripe ska inte storm-retry:a på våra interna fel; nästa
          // subscription-event synkar om statusen.
        }
        return json({ received: true });
      },
    },
  },
});
