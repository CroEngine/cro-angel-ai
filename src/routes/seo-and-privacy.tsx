// /seo-and-privacy — the honest customer-facing page: exactly what Angel sends,
// stores and changes, and why it does not hurt SEO or performance.
//
// Every claim on this page is enforced by code (bot gate, CWV guards, claims
// guard, consent modes) — when behaviour changes, this page must change with it.
// Same design language as the landing page: warm paper, one emerald accent.

import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/seo-and-privacy")({
  head: () => ({
    meta: [
      { title: "Angel — SEO, performance & privacy" },
      {
        name: "description",
        content:
          "Exactly what Angel sends to your site, what it stores, and why search engines always see your original page.",
      },
    ],
  }),
  component: SeoAndPrivacy,
});

const SECTIONS: { kicker: string; title: string; body: (string | ReactNode)[] }[] = [
  {
    kicker: "what loads",
    title: "One cached script, small calls",
    body: [
      "Your site adds one script tag, once. The script is ~27 KB minified (~10 KB over the wire, gzipped) and your visitors' browsers cache it.",
      "Per page view, the browser makes one decision call and receives ONLY that visitor's own view: a handful of small instructions (typically under 2 KB) — or nothing at all. The full catalogue of designs, other segments' variants, statistics and evidence never leave our servers.",
      "Beyond that: a small consent-configuration lookup, lightweight measurement beacons when measurement is enabled, and occasionally a one-time second script that reads your page's already-published content so designs can be grounded in it.",
    ],
  },
  {
    kicker: "what changes",
    title: "We rearrange what you already published — never invent",
    body: [
      "A segment design reorders existing sections or re-tightens existing copy. Rewritten copy passes an automated guard that rejects new numbers, new superlatives and new promise-language, and reorder/reveal operations can only reference blocks that already exist — there is no mechanism for inserting a new section. The guard checks tokens, not meaning, so a human (you) approves every design before it can serve.",
      "A segment design is applied all-or-nothing — if any part of it cannot be applied faithfully, the whole design rolls back and the visitor sees your original page — and it is verified in a real browser against layout gates (no overflow, no overlaps, no broken buttons, hero stays first) before any visitor can see it. Smaller single-element nudges are applied individually, each one reversible.",
    ],
  },
  {
    kicker: "seo",
    title: "Search engines always see your original page",
    body: [
      "Bots and crawlers — Googlebot, Bingbot, AI crawlers, SEO tools, uptime monitors — are excluded twice: the script refuses to run for them, and our servers ignore anything from them. What gets indexed is your page, untouched by experiments.",
      "Designs preserve meaning (same sections, same claims, different order), which is what search-engine guidelines for A/B testing ask for. No new URLs, no hidden pages, no cloaking surface.",
      "When a design proves itself a winner, we recommend making it your page's real code — you get the exact change list — so what search engines index converges with what your visitors see.",
    ],
  },
  {
    kicker: "performance",
    title: "Guarded by Core Web Vitals",
    body: [
      "On browsers that expose paint timing (the Chromium family — the majority of traffic), the script refuses changes that would hurt loading: it will not move or rewrite the page's largest-paint element after it has rendered, and it never stacks layout-shifting insertions. On browsers without paint timing the same small, pre-verified change set applies — nothing bigger.",
      "When measurement is enabled, we also collect real visitors' loading metrics (LCP, and layout shift where the browser exposes it) with each exposure — so if a design were making the page slower, that shows up in our own data, not just yours.",
    ],
  },
  {
    kicker: "privacy",
    title: "Anonymous by default, no cookies",
    body: [
      "Angel sets no cookies. In the default anonymous mode, no visitor identifier is stored at all and no behavioural data is attributed to anyone.",
      "If you (the site owner) attest a lawful basis for measurement, a random identifier — generated at random, never derived from a name, e-mail or IP address — is stored in the visitor's browser and included with measurement events, so a later conversion can be counted. Our servers store that random ID and the events; nothing that identifies the person. Per-tab journey data lives in session storage and disappears when the tab closes.",
      "Visitors' Global Privacy Control / Do Not Track signals opt them out of Angel's own consent handling. If your consent platform explicitly tells our tag that a visitor consented, we trust your platform's signal — honouring GPC/DNT is then its responsibility, as it is for every tool it governs.",
      "Known bots, crawlers and automation tools are dropped before anything is written, so they never pollute your numbers. Like every analytics tool, we cannot catch an attacker deliberately impersonating a human browser — our statistical gates are sized so noise like that does not create false winners.",
    ],
  },
];

function SeoAndPrivacy() {
  return (
    <div className="min-h-screen bg-[#fafaf9] text-stone-900 antialiased">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2 font-bold text-stone-800">
            <span className="text-emerald-700">✳</span> Angel
          </Link>
          <span className="font-mono text-[11px] tracking-wider text-stone-400">
            [ seo · performance · privacy ]
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">SEO, performance &amp; privacy</h1>
        <p className="mt-3 text-stone-600">
          Exactly what Angel sends to your site, what it stores, and why search engines always
          see your original page. Every claim below is enforced by code, not policy.
        </p>
        <div className="mt-10 flex flex-col gap-10">
          {SECTIONS.map((s, i) => (
            <section key={s.kicker}>
              <div className="font-mono text-[11px] tracking-wider text-emerald-700">
                [ {String(i + 1).padStart(2, "0")} / {String(SECTIONS.length).padStart(2, "0")} ] ·{" "}
                {s.kicker}
              </div>
              <h2 className="mt-2 text-xl font-semibold">{s.title}</h2>
              {s.body.map((p, j) => (
                <p key={j} className="mt-3 text-[15px] leading-relaxed text-stone-600">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
        <div className="mt-12 border-t border-stone-200 pt-6 text-sm text-stone-500">
          Questions about any of this?{" "}
          <a className="text-emerald-700 underline underline-offset-2" href="mailto:hello@croengine.com">
            Ask us
          </a>{" "}
          — the honest answer is the product.
        </div>
      </main>
    </div>
  );
}
