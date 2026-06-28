// / — Angel Adaptive landing page.
//
// The public front door for the product. Explains what Angel Adaptive does and
// links into the live demo (/demo) and the dashboard (/dashboard). The internal
// crawler/analysis tool lives at /agent.

import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Sparkles,
  MousePointerClick,
  Layers,
  Radar,
  Wand2,
  BarChart3,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Angel Adaptive — the adaptive website layer" },
      {
        name: "description",
        content:
          "One snippet makes any website adapt to each visitor in real time — using content you already published. Right content, right person, right moment.",
      },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    icon: MousePointerClick,
    title: "Install one snippet",
    body: "A single line of JavaScript. No CMS integration, no redesign, no development.",
  },
  {
    icon: Layers,
    title: "Build a content inventory",
    body: "Angel crawls the site and catalogs the content that already exists — headlines, CTAs, testimonials, logos, FAQ, trust badges.",
  },
  {
    icon: Radar,
    title: "Understand the visitor",
    body: "Traffic source, device, language, country, returning vs. new — read in real time, in the browser.",
  },
  {
    icon: Wand2,
    title: "Adapt in real time",
    body: "A safe pattern library re-surfaces the right published content for this visitor. Two people can see different versions of the same URL.",
  },
  {
    icon: BarChart3,
    title: "Measure & learn",
    body: "Every adaptation is logged. See which changes lift conversion, per segment — and improve continuously.",
  },
];

const SAFETY = [
  "Never invents content — only re-surfaces what you already published",
  "Never changes your codebase or publishes new copy",
  "Every change is reversible and logged",
  "Can be switched off instantly",
];

function Landing() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-bold">
            <Sparkles className="h-5 w-5 text-violet-600" /> Angel Adaptive
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              to="/demo"
              className="rounded-md px-3 py-2 font-medium text-slate-600 hover:text-slate-900"
            >
              Demo
            </Link>
            <Link
              to="/dashboard"
              className="rounded-md px-3 py-2 font-medium text-slate-600 hover:text-slate-900"
            >
              Dashboard
            </Link>
            <Link
              to="/demo"
              className="ml-1 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white transition hover:bg-violet-500"
            >
              See it live <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
          <Sparkles className="h-3.5 w-3.5" /> The adaptive website layer
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Every visitor sees the <span className="text-violet-600">right version</span> of your site
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          Websites are static — everyone sees the same page. Angel Adaptive makes any site
          intelligent: one snippet, and it adapts to each visitor in real time using the content you
          already published. Right content, right person, right moment.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/demo"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white transition hover:bg-violet-500"
          >
            See the live demo <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/dashboard"
            className="rounded-lg border border-slate-200 px-6 py-3 font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Open the dashboard
          </Link>
        </div>
        <div className="mx-auto mt-10 max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
            The entire install
          </div>
          <code className="block break-all font-mono text-sm text-slate-800">
            &lt;script src="https://app.angel/adaptive.js" data-site="your-site"&gt;&lt;/script&gt;
          </code>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-100 bg-slate-50/60 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold">How it works</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-slate-600">
            Not a new website — an intelligent layer on top of the one you have.
          </p>
          <div className="mt-12 grid gap-5 md:grid-cols-3 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="text-xs font-semibold text-violet-600">Step {i + 1}</div>
                <h3 className="mt-1 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Safety */}
      <section className="py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-2 md:items-center">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <ShieldCheck className="h-3.5 w-3.5" /> Safe by design
            </div>
            <h2 className="text-3xl font-bold">It can only help — never go rogue</h2>
            <p className="mt-3 text-slate-600">
              Angel works from a fixed library of safe improvements built on your existing content.
              It never fabricates claims and never touches your codebase.
            </p>
          </div>
          <ul className="space-y-3">
            {SAFETY.map((s) => (
              <li
                key={s}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <span className="text-sm text-slate-700">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-100 bg-violet-600 py-16 text-center text-white">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-3xl font-bold">Optimize every visit, not just the average</h2>
          <p className="mx-auto mt-3 max-w-xl text-violet-100">
            That's the difference between a static website and an adaptive one.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/demo"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-violet-700 transition hover:bg-violet-50"
            >
              Try the demo <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/dashboard"
              className="rounded-lg border border-white/40 px-6 py-3 font-medium text-white transition hover:bg-white/10"
            >
              View the dashboard
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100 py-8 text-center text-sm text-slate-400">
        <div className="mx-auto max-w-6xl px-4">
          Angel Adaptive ·{" "}
          <Link to="/agent" className="hover:text-slate-600">
            SEO &amp; CRO agent
          </Link>
        </div>
      </footer>
    </div>
  );
}
