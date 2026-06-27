// /demo — a self-contained sample landing page used to demonstrate the full
// Angel Adaptive loop end-to-end: the snippet loads, reads the visitor context
// (here driven by the simulator query params), calls /api/adaptive/decide,
// applies patterns to the slots below, and logs events.
//
// Every adaptable region is tagged with `data-angel-slot`. Slots that should be
// hidden until revealed carry `data-angel-hidden` (the snippet ships the CSS).

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Angel Adaptive — Demo" },
      { name: "description", content: "Live demo of the Angel Adaptive personalization loop." },
    ],
  }),
  component: Demo,
});

interface AppliedState {
  decisionId: string;
  applied: string[];
  reasons: { pattern: string; reason: string }[];
}

const SCENARIOS: { label: string; query: string }[] = [
  { label: "LinkedIn · Desktop · New", query: "?angel_source=linkedin&angel_device=desktop" },
  { label: "Google · Mobile · New", query: "?angel_source=google&angel_device=mobile" },
  {
    label: "Google Ads · Desktop",
    query: "?angel_source=google&angel_medium=cpc&angel_device=desktop",
  },
  { label: "Returning · Viewed pricing", query: "?angel_returning=1&angel_pricing=1" },
  { label: "Direct · Reset", query: "" },
];

function Demo() {
  const [state, setState] = useState<AppliedState | null>(null);

  useEffect(() => {
    function onApplied(e: Event) {
      const detail = (e as CustomEvent).detail;
      const decision = detail?.decision;
      setState({
        decisionId: decision?.decisionId ?? "",
        applied: detail?.applied ?? [],
        reasons: (decision?.adaptations ?? []).map((a: { pattern: string; reason: string }) => ({
          pattern: a.pattern,
          reason: a.reason,
        })),
      });
    }
    document.addEventListener("angel:applied", onApplied);

    // Inject the snippet exactly as a customer would (one tag).
    const s = document.createElement("script");
    s.src = "/adaptive.js";
    s.async = true;
    s.setAttribute("data-site", "demo");
    document.body.appendChild(s);

    return () => {
      document.removeEventListener("angel:applied", onApplied);
      s.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ----- Simulator (not part of the adapted page) ----- */}
      <div className="sticky top-0 z-50 border-b border-slate-200 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2 text-sm">
          <span className="mr-2 font-semibold">Angel simulator:</span>
          {SCENARIOS.map((sc) => (
            <a
              key={sc.label}
              href={`/demo${sc.query}`}
              className="rounded-full bg-white/10 px-3 py-1 transition hover:bg-white/20"
            >
              {sc.label}
            </a>
          ))}
          <button
            onClick={() => window.AngelAdaptive?.reset()}
            className="ml-auto rounded-full bg-violet-600 px-3 py-1 font-medium transition hover:bg-violet-500"
          >
            Reset adaptations
          </button>
        </div>
      </div>

      {/* ----- Applied-adaptations readout ----- */}
      {state && (
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            <div className="font-semibold">
              Decision {state.decisionId || "—"} · {state.applied.length} adaptation
              {state.applied.length === 1 ? "" : "s"} applied
            </div>
            <ul className="mt-1 list-disc pl-5">
              {state.reasons.map((r) => (
                <li key={r.pattern}>
                  <span className="font-mono text-xs">{r.pattern}</span> — {r.reason}
                </li>
              ))}
              {state.reasons.length === 0 && <li>No adaptations for this visitor.</li>}
            </ul>
          </div>
        </div>
      )}

      {/* ================= The "customer" landing page ================= */}
      <main className="mx-auto max-w-5xl px-4 pb-24">
        {/* Hero */}
        <section data-angel-slot="hero" className="py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Ship onboarding flows in minutes, not weeks
          </h1>
          <p data-angel-secondary className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Acme is the developer-first platform for building, testing, and shipping in-product
            onboarding. Drag-and-drop builder, analytics, and a powerful API — all in one place,
            trusted by thousands of teams worldwide.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              data-angel-slot="cta"
              className="rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
            >
              <span data-angel-text>Get started</span>
            </button>
            <a
              href="#pricing"
              className="px-4 py-3 font-medium text-slate-600 hover:text-slate-900"
            >
              See pricing
            </a>
          </div>
        </section>

        {/* Customer logos */}
        <section data-angel-slot="customer_logos" className="border-y border-slate-100 py-8">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-400">
            Trusted by teams at
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-lg font-bold text-slate-400">
            <span>HubSpot</span>
            <span>Spotify</span>
            <span>Volvo</span>
            <span>Klarna</span>
            <span>Notion</span>
          </div>
        </section>

        {/* Testimonial (hidden until revealed) */}
        <section data-angel-slot="testimonial" data-angel-hidden className="py-12">
          <blockquote className="mx-auto max-w-3xl text-center text-2xl font-medium text-slate-800">
            “Angel-style personalization lifted our enterprise trial conversions by 38%.”
            <footer className="mt-3 text-base font-normal text-slate-500">
              — VP of Growth, Enterprise SaaS
            </footer>
          </blockquote>
        </section>

        {/* Trust badges (hidden until revealed) */}
        <section data-angel-slot="trust_badge" data-angel-hidden className="py-6">
          <div className="flex flex-wrap justify-center gap-3 text-sm font-semibold text-slate-600">
            <span className="rounded border border-slate-200 px-3 py-1">GDPR</span>
            <span className="rounded border border-slate-200 px-3 py-1">ISO 27001</span>
            <span className="rounded border border-slate-200 px-3 py-1">SOC 2</span>
          </div>
        </section>

        {/* Case study (hidden until revealed) */}
        <section data-angel-slot="case_study" data-angel-hidden className="py-10">
          <div className="rounded-xl bg-slate-50 p-6 text-center">
            <h3 className="text-xl font-semibold">Case study: 3× faster activation at Klarna</h3>
            <p className="mt-2 text-slate-600">
              How a 12-person growth team cut time-to-value from days to hours.
            </p>
          </div>
        </section>

        {/* Security (hidden until revealed) */}
        <section
          data-angel-slot="security"
          data-angel-hidden
          className="py-8 text-center text-slate-600"
        >
          Enterprise-grade security: SSO/SAML, audit logs, data residency, and 99.99% uptime SLA.
        </section>

        {/* Guarantee (hidden until revealed) */}
        <section
          data-angel-slot="guarantee"
          data-angel-hidden
          className="py-6 text-center font-medium text-slate-700"
        >
          30-day money-back guarantee · Cancel anytime
        </section>

        {/* Pricing */}
        <section id="pricing" data-angel-slot="pricing" className="py-14">
          <h2 className="text-center text-3xl font-bold">Simple, transparent pricing</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { name: "Starter", price: "$0", popular: false },
              { name: "Pro", price: "$49", popular: true },
              { name: "Enterprise", price: "Custom", popular: false },
            ].map((plan) => (
              <div
                key={plan.name}
                {...(plan.popular ? { "data-angel-slot": "pricing_popular" } : {})}
                className="rounded-xl border border-slate-200 p-6 text-center"
              >
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {plan.name}
                </div>
                <div className="mt-2 text-3xl font-bold">{plan.price}</div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section data-angel-slot="faq" className="py-12">
          <h2 className="text-2xl font-bold">Frequently asked questions</h2>
          <div className="mt-4 space-y-3 text-slate-700">
            <p className="font-medium">Is there a free trial?</p>
            <p className="font-medium">Do I need a credit card to start?</p>
            <p className="font-medium">How long does setup take?</p>
          </div>
        </section>
      </main>
    </div>
  );
}
