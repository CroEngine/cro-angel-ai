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
    title: "One cached script, one tiny call",
    body: [
      "Your site adds one script tag, once. The script is ~27 KB minified (~10 KB over the wire, gzipped) and your visitors' browsers cache it.",
      "Per page view, the browser makes one decision call and receives ONLY that visitor's own view: a handful of small instructions (typically under 2 KB) — or nothing at all. The full catalogue of designs, other segments' variants, statistics and evidence never leave our servers.",
    ],
  },
  {
    kicker: "what changes",
    title: "We rearrange what you already published — never invent",
    body: [
      "A variant reorders existing sections, or re-tightens existing copy. It cannot add claims, numbers, testimonials or content that is not already on your page — that is enforced by an automated guard, not a policy.",
      "Every change is reversible in one click, applied all-or-nothing (a partially-applicable design is fully rolled back), and verified in a real browser against layout gates (no overflow, no overlaps, no broken buttons, hero stays first) before any visitor can see it.",
    ],
  },
  {
    kicker: "seo",
    title: "Search engines always see your original page",
    body: [
      "Bots and crawlers — Googlebot, Bingbot, AI crawlers, SEO tools, uptime monitors — are excluded twice: the script refuses to run for them, and our servers ignore anything from them. What gets indexed is your page, untouched by experiments.",
      "Variants preserve meaning (same sections, same claims, different order), which is what search-engine guidelines for A/B testing ask for. No new URLs, no hidden pages, no cloaking surface.",
      "When a variant proves itself a winner, we recommend making it your page's real code — you get the exact change list — so what search engines index converges with what your visitors see.",
    ],
  },
  {
    kicker: "performance",
    title: "Guarded by Core Web Vitals, measured on real visitors",
    body: [
      "The script actively refuses changes that would hurt loading: it never moves or rewrites the page's largest-paint element after it has rendered, and it never stacks layout-shifting insertions.",
      "We continuously measure real visitors' LCP and layout shift in both test arms — if a variant were making the page slower, our own measurement is built to show it.",
    ],
  },
  {
    kicker: "privacy",
    title: "Anonymous by default, no cookies",
    body: [
      "Angel sets no cookies. In the default anonymous mode, no visitor identifier is stored at all and no behavioural data is attributed to anyone.",
      "If you (the site owner) attest a lawful basis for measurement, a random hash is kept in the visitor's own browser storage — never a name, e-mail or IP address — and visitors' Global Privacy Control / Do Not Track signals still opt them out individually. Per-tab journey data lives in session storage and disappears when the tab closes.",
      "Bot traffic is dropped before anything is written, so your numbers describe humans.",
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
