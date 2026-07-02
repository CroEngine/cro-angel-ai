// / — Angel sales/demo landing page.
//
// Design language: warm paper (stone) + one deep emerald accent, hairline
// grid background with mono margin annotations, mono section kickers
// ("[ 01 / 03 ] · ..."), everything in flat hairline grid cells — crafted
// dev-tool feel, no gradients, no shadows. The one-line install is the hero.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";

const SNIPPET = `<script async src="https://croengine.netlify.app/adaptive.js" data-site="your-site"></script>`;

const DISPLAY = "font-['Sora','Manrope',sans-serif]";
const GRID_BG =
  "bg-[linear-gradient(to_right,#eceae7_1px,transparent_1px),linear-gradient(to_bottom,#eceae7_1px,transparent_1px)] bg-[length:180px_180px] bg-[position:center_top]";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Angel — add one line of code, get provable conversion lift" },
      {
        name: "description",
        content:
          "One line of code. Angel steers every visitor toward your conversion goal using content you already published, and proves the extra conversions against a held-back control group. ~2-minute setup. Never makes your site worse.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-[#fafaf9] text-stone-900 antialiased">
      <Announcement />
      <Nav />
      <Hero />
      <ProofStrip />
      <HowItWorks />
      <Safety />
      <Outcome />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Announcement() {
  return (
    <div className="px-4 pt-4">
      <Link
        to="/signup"
        className="mx-auto block max-w-6xl rounded-xl bg-emerald-700 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-emerald-600"
      >
        Free while in early access — every site gets the full engine.{" "}
        <span className="underline underline-offset-2">Start now →</span>
      </Link>
    </div>
  );
}

function Nav() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
        <span className="text-xl leading-none text-emerald-700">✳</span> Angel
      </div>
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/demo" className="px-3 py-2 font-medium text-stone-600 hover:text-stone-900">
          Demo
        </Link>
        <Link to="/login" className="px-3 py-2 font-medium text-stone-600 hover:text-stone-900">
          Sign in
        </Link>
        <Link
          to="/signup"
          className="rounded-lg bg-stone-900 px-4 py-2 font-semibold text-white transition hover:bg-stone-700"
        >
          Sign up
        </Link>
      </nav>
    </header>
  );
}

// Mono margin annotation on the hero grid.
function Note({ className, children }: { className: string; children: string }) {
  return (
    <span
      className={`absolute hidden font-mono text-[11px] tracking-wider text-stone-400 lg:block ${className}`}
    >
      {children}
    </span>
  );
}

function Hero() {
  return (
    <section className={`relative border-y border-stone-200 ${GRID_BG}`}>
      <Note className="left-4 top-10">[ visitor: mobile ]</Note>
      <Note className="right-4 top-24">[ lift: +0.9pp ]</Note>
      <Note className="bottom-24 left-6">[ control: 12% ]</Note>
      <Note className="bottom-40 right-8">[ cwv: ok ]</Note>
      <span className="absolute left-[180px] top-[180px] hidden -translate-x-1/2 -translate-y-1/2 text-emerald-600 lg:block">
        ✳
      </span>
      <span className="absolute right-[180px] top-[360px] hidden -translate-y-1/2 translate-x-1/2 text-emerald-600 lg:block">
        ✳
      </span>

      <div className="relative mx-auto max-w-3xl px-4 pb-16 pt-20 text-center">
        <Link
          to="/signup"
          className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white py-1 pl-4 pr-1 text-sm font-medium text-stone-700"
        >
          Setup takes about 2 minutes
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white">
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
        <h1
          className={`${DISPLAY} mt-8 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-[52px]`}
        >
          Add one line of code.
          <br />
          <span className="text-emerald-700">Get provable lift.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-stone-600">
          Angel steers every visitor toward your conversion goal — using content you already
          published — and proves the extra conversions against a held-back control group.{" "}
          <span className="rounded bg-stone-200/70 px-1.5 py-0.5 text-stone-700">
            No developer needed.
          </span>
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="rounded-lg bg-emerald-700 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-600"
          >
            Start for free
          </Link>
          <Link
            to="/demo"
            className="rounded-lg border border-stone-300 bg-white px-6 py-3 text-[15px] font-semibold text-stone-700 transition hover:bg-stone-50"
          >
            See it work
          </Link>
        </div>

        <SnippetPanel />
      </div>
    </section>
  );
}

function SnippetPanel() {
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
    <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-stone-200 bg-white text-left shadow-[0_1px_0_#e7e5e4]">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2">
        <span className="font-mono text-[11px] tracking-wider text-stone-400">
          index.html — the whole install
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-2 py-1 font-mono text-[11px] font-medium text-stone-600 transition hover:bg-stone-100"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-all px-4 py-3.5 font-mono text-[12.5px] leading-relaxed">
        <code>
          <span className="mr-3 select-none text-stone-300">1</span>
          <span className="text-stone-400">&lt;script</span>{" "}
          <span className="text-stone-500">async src=</span>
          <span className="text-emerald-700">
            &quot;https://croengine.netlify.app/adaptive.js&quot;
          </span>{" "}
          <span className="text-stone-500">data-site=</span>
          <span className="text-emerald-700">&quot;your-site&quot;</span>
          <span className="text-stone-400">&gt;&lt;/script&gt;</span>
        </code>
      </pre>
    </div>
  );
}

const PROOF = [
  { big: "~2 min", small: "setup, one line" },
  { big: "0", small: "layout shift caused" },
  { big: "100%", small: "reversible changes" },
  { big: "A/B", small: "held-back control" },
];

function ProofStrip() {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-stone-200 border-x border-b border-stone-200 bg-white md:grid-cols-4">
      {PROOF.map((p) => (
        <div key={p.small} className="px-6 py-6">
          <div className={`${DISPLAY} text-2xl font-semibold text-emerald-700`}>{p.big}</div>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-stone-400">
            {p.small}
          </div>
        </div>
      ))}
    </section>
  );
}

function Kicker({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[12px] tracking-wider text-stone-400">
      <span className="h-3 w-px bg-emerald-600" />[ <span className="text-emerald-700">{n}</span> /
      03 ] · {label}
    </div>
  );
}

const STEPS = [
  {
    tag: "[ read ]",
    title: "It reads what you already have",
    body: "Angel catalogs the content your site already publishes — headlines, CTAs, trust signals. It never invents copy, only re-surfaces yours.",
  },
  {
    tag: "[ steer ]",
    title: "Nudges each visitor to your goal",
    body: "You pick the button or page that counts as a conversion. Angel highlights the path to it — page-aware, per traffic source and device — with small, safe changes.",
  },
  {
    tag: "[ prove ]",
    title: "Proves the lift honestly",
    body: "A slice of visitors is deliberately left alone as a control group. You get one number: how many extra conversions Angel actually caused.",
  },
];

function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Kicker n="01" label="HOW IT WORKS" />
      <h2 className={`${DISPLAY} mt-4 max-w-xl text-3xl font-semibold tracking-tight`}>
        Read your site. Point every visitor at your goal. Measure it.
      </h2>
      <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.tag} className="bg-white p-7">
            <div className="font-mono text-[11px] tracking-wider text-stone-400">{s.tag}</div>
            <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-stone-600">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const SAFETY = [
  {
    tag: "[ speed ]",
    title: "Your Core Web Vitals don't move",
    body: "It never touches your largest content element and never shifts layout. One small file, loaded async.",
  },
  {
    tag: "[ reversible ]",
    title: "Fails open, always undoable",
    body: "Every change is recorded and reversible. If anything errors, your page renders exactly as you built it.",
  },
  {
    tag: "[ consent ]",
    title: "Consent-first by default",
    body: "GPC and Do-Not-Track are hard opt-outs. Until consent is in place it adapts the page but stores nothing.",
  },
  {
    tag: "[ coexist ]",
    title: "A good tenant on your page",
    body: "Stays out of your cookie banner, never fights your other tools or recommendations. It amplifies your funnel, it doesn't take it over.",
  },
];

function Safety() {
  return (
    <section className="border-y border-stone-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <Kicker n="02" label="NEVER MAKES IT WORSE" />
        <h2 className={`${DISPLAY} mt-4 max-w-2xl text-3xl font-semibold tracking-tight`}>
          A third-party script that changes your page? Yes — a careful one.
        </h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-2">
          {SAFETY.map((s) => (
            <div key={s.tag} className="bg-[#fafaf9] p-7">
              <div className="font-mono text-[11px] tracking-wider text-emerald-700">{s.tag}</div>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[15px] text-stone-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Outcome() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Kicker n="03" label="WHAT YOU GET" />
      <div className="mt-6 grid items-center gap-10 md:grid-cols-2">
        <div>
          <h2 className={`${DISPLAY} text-3xl font-semibold tracking-tight`}>
            One number that actually means something.
          </h2>
          <p className="mt-4 leading-relaxed text-stone-600">
            Not pageviews. Not vanity metrics. The extra conversions Angel caused, measured against
            visitors it deliberately left alone — and it only calls a result once the sample is big
            enough to trust. If it isn&apos;t lifting your goal, you&apos;ll see that too.
          </p>
          <Link
            to="/signup"
            className="mt-6 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            Start for free
          </Link>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-4 py-2 font-mono text-[11px] tracking-wider text-stone-400">
            [ what&apos;s working ]
          </div>
          <div className="space-y-2.5 p-4">
            <LiftRow label="Highlight the signup CTA" a="4.8%" b="3.9%" lift="+0.9pp" />
            <LiftRow label="Show trust badge" a="4.1%" b="3.8%" lift="+0.3pp" muted />
          </div>
          <p className="border-t border-stone-200 px-4 py-2.5 font-mono text-[10px] leading-relaxed tracking-wide text-stone-400">
            ILLUSTRATIVE · ADAPTED VS HELD-BACK CONTROL · CALLED ONLY AT TRUSTWORTHY SAMPLE SIZE
          </p>
        </div>
      </div>
    </section>
  );
}

function LiftRow({
  label,
  a,
  b,
  lift,
  muted,
}: {
  label: string;
  a: string;
  b: string;
  lift: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-stone-100 bg-[#fafaf9] px-3 py-2.5">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <span className="flex items-center gap-3 font-mono text-xs text-stone-400">
        {a} <span className="text-stone-300">vs</span> {b}{" "}
        <span
          className={`rounded px-2 py-0.5 font-semibold ${
            muted ? "bg-stone-200 text-stone-600" : "bg-emerald-700 text-white"
          }`}
        >
          {lift}
        </span>
      </span>
    </div>
  );
}

function FinalCta() {
  return (
    <section className={`border-t border-stone-200 ${GRID_BG}`}>
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <div className="font-mono text-[12px] tracking-wider text-stone-400">
          [ two steps · no step three ]
        </div>
        <h2 className={`${DISPLAY} mt-4 text-4xl font-semibold tracking-tight`}>
          Paste the line. Pick your goal.
          <br />
          <span className="text-emerald-700">Watch the lift.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-stone-600">
          Free while in early access — no card, no sales call, and a promise to never make your
          site worse.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/signup"
            className="rounded-lg bg-emerald-700 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-600"
          >
            Start for free
          </Link>
          <Link
            to="/login"
            className="rounded-lg border border-stone-300 bg-white px-6 py-3 text-[15px] font-semibold text-stone-700 transition hover:bg-stone-50"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-stone-500">
        <div className="flex items-center gap-2 font-bold text-stone-800">
          <span className="text-emerald-700">✳</span> Angel
        </div>
        <span className="font-mono text-[11px] tracking-wider text-stone-400">
          [ one line of code · provable lift · never worse ]
        </span>
      </div>
    </footer>
  );
}
