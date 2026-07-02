// / — Angel Adaptive sales / demo landing page.
//
// The public front door. One job: make it crystal-clear that this is a
// one-line, ~2-minute setup, and explain the value (adapt to each visitor,
// prove the lift, never break the site) without cluttering the page. Links
// into signup / sign-in. The internal crawler tool lives at /agent.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Sparkles,
  Check,
  Copy,
  ArrowRight,
  ScanSearch,
  Crosshair,
  LineChart,
  ShieldCheck,
  Gauge,
  Undo2,
  EyeOff,
  Boxes,
} from "lucide-react";

const SNIPPET = `<script async src="https://croengine.netlify.app/adaptive.js" data-site="your-site"></script>`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Angel — one line of code. A site that converts better, proven." },
      {
        name: "description",
        content:
          "Add one line of code. Angel highlights the right thing for each visitor using content you already published, and proves the extra conversions against a held-back control group. ~2-minute setup. Never slows down or breaks your page.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Nav />
      <Hero />
      <Setup />
      <HowItWorks />
      <Safety />
      <Outcome />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 font-bold">
          <Sparkles className="h-5 w-5 text-violet-600" /> Angel
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/login"
            className="rounded-md px-3 py-2 font-medium text-slate-600 hover:text-slate-900"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="ml-1 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white transition hover:bg-violet-500"
          >
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-50 to-white" />
      <div className="relative mx-auto max-w-3xl px-4 pb-8 pt-16 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-semibold text-violet-700 shadow-sm">
          <Sparkles className="h-3.5 w-3.5" /> Setup takes about 2 minutes
        </span>
        <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl">
          Add one line of code.
          <br />
          <span className="text-violet-600">Your site converts better</span> — and you can prove it.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
          Angel highlights the right thing for each visitor — using the content you already
          published — and measures the extra conversions against a control group it holds back. No
          redesign. No developer. It never slows down or breaks your page.
        </p>

        {/* The one line — the whole setup, shown literally */}
        <div className="mx-auto mt-8 max-w-2xl">
          <SnippetBlock />
          <p className="mt-2 text-sm text-slate-500">
            That&apos;s the install. Paste it once in your site&apos;s <code>&lt;head&gt;</code> —
            no code changes, no redeploy.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-violet-500"
          >
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/demo"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            See it work
          </Link>
        </div>
      </div>
    </section>
  );
}

function SnippetBlock() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 text-left shadow-xl">
      <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
        <span className="ml-2 text-xs font-medium text-slate-400">index.html</span>
        <button
          onClick={copy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed text-slate-100">
        <code>
          <span className="text-slate-500">&lt;script</span> <span className="text-sky-300">async</span>{" "}
          <span className="text-sky-300">src</span>=
          <span className="text-emerald-300">&quot;https://croengine.netlify.app/adaptive.js&quot;</span>{" "}
          <span className="text-sky-300">data-site</span>=
          <span className="text-emerald-300">&quot;your-site&quot;</span>
          <span className="text-slate-500">&gt;&lt;/script&gt;</span>
        </code>
      </pre>
    </div>
  );
}

function Setup() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16">
      <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-violet-600">
        The whole setup
      </h2>
      <p className="mt-2 text-center text-2xl font-bold text-slate-900">
        Two steps. Then you&apos;re done.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <StepCard
          n={1}
          title="Paste one line"
          body="Drop the snippet in your <head> — via your site builder, tag manager, or template. No build, no redeploy."
        />
        <StepCard
          n={2}
          title="Pick your goal"
          body="In the dashboard, choose what a conversion is — the button or page that matters. Angel takes it from there."
        />
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">
        There is no step 3. No redesign, no CMS integration, no engineering time.
      </p>
    </section>
  );
}

function StepCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
        {n}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

const STEPS = [
  {
    icon: ScanSearch,
    title: "Reads what you already have",
    body: "Angel catalogs the content your site already publishes — headlines, CTAs, trust signals. It never invents copy, only re-surfaces yours.",
  },
  {
    icon: Crosshair,
    title: "Nudges each visitor to your goal",
    body: "It highlights the right thing for this visitor — page-aware, by traffic source and device — using small, safe changes that can't shift your layout.",
  },
  {
    icon: LineChart,
    title: "Proves the lift",
    body: "A slice of visitors is held back as a control group. You get one honest number: how many more conversions Angel actually caused.",
  },
];

function HowItWorks() {
  return (
    <section className="border-y border-slate-100 bg-slate-50/60">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-violet-600">
          How it works
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-2xl font-bold text-slate-900">
          Read your site. Point every visitor at your goal. Measure it.
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SAFETY = [
  {
    icon: Gauge,
    title: "Your speed stays intact",
    body: "Angel never touches your largest content element, so Core Web Vitals don't move. One small file, loaded async — nothing blocks your page.",
  },
  {
    icon: Undo2,
    title: "Fails open, always reversible",
    body: "Every change is recorded and undoable. If anything errors, your page renders exactly as you built it — Angel simply steps aside.",
  },
  {
    icon: ShieldCheck,
    title: "Consent-first",
    body: "GPC and Do-Not-Track are hard opt-outs. Until consent is in place it runs storage-free — it adapts the page but stores nothing.",
  },
  {
    icon: EyeOff,
    title: "A good tenant",
    body: "It stays out of your cookie banner and never fights your other tools or recommendations. It amplifies your conversion path, it doesn't take it over.",
  },
];

function Safety() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16">
      <div className="text-center">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-600">
          The part everyone worries about
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-2xl font-bold text-slate-900">
          A third-party script that changes your page? Yes — a careful one.
        </p>
        <p className="mx-auto mt-3 max-w-2xl text-slate-600">
          Angel is built on one rule: it must never make the page it&apos;s meant to improve worse.
        </p>
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {SAFETY.map((s) => (
          <div key={s.title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <s.icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Outcome() {
  return (
    <section className="border-y border-slate-100 bg-slate-50/60">
      <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-16 md:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-600">
            What you get
          </h2>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            One number that actually means something.
          </p>
          <p className="mt-3 text-slate-600">
            Not pageviews, not vanity metrics — the extra conversions Angel caused, measured against
            visitors it deliberately left alone. If it isn&apos;t lifting your goal, you&apos;ll see
            that too. Honest by construction.
          </p>
          <Link
            to="/signup"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500"
          >
            Start free <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {/* Small, tasteful illustration — not a full dashboard */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <LineChart className="h-4 w-4" /> What&apos;s working
          </div>
          <div className="mt-4 space-y-3">
            <LiftRow label="Highlight the signup CTA" adapted="4.8%" control="3.9%" lift="+0.9 pp" />
            <LiftRow label="Show trust badge" adapted="4.1%" control="3.8%" lift="+0.3 pp" muted />
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Illustrative. Each row compares the adapted group to a held-back control, and only calls
            a result once the sample is large enough to trust.
          </p>
        </div>
      </div>
    </section>
  );
}

function LiftRow({
  label,
  adapted,
  control,
  lift,
  muted,
}: {
  label: string;
  adapted: string;
  control: string;
  lift: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>
          {adapted} <span className="text-slate-300">vs</span> {control}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            muted ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {lift}
        </span>
      </div>
    </div>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 text-center">
      <Boxes className="mx-auto h-8 w-8 text-violet-600" />
      <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">
        Add one line. See the lift.
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-slate-600">
        Two minutes to install, a control group to keep you honest, and a promise to never make your
        site worse. Start free — no card, no sales call.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/signup"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-violet-500"
        >
          Start free <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3 text-base font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-100">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-slate-500">
        <div className="flex items-center gap-2 font-semibold text-slate-700">
          <Sparkles className="h-4 w-4 text-violet-600" /> Angel
        </div>
        <p>One line of code. A site that converts better — proven.</p>
      </div>
    </footer>
  );
}
