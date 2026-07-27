// / — Angel landing: URL-paste ÄR sidan (ägarbeslut 2026-07-27, Claude/
// ChatGPT-minimalism). En fråga, ett fält, inget annat ovanför vecket —
// pastan startar hela tratten: förhandsvisningsjobb → /try visar exemplet
// på prospektets EGEN sida med siffror → installera-CTA in i signup.
//
// Design language behållet: warm paper (stone) + one deep emerald accent,
// hairline grid, mono margin annotations — crafted dev-tool feel, no
// gradients. Allt säljande långstoff är BORTA; en viskande trerads-strip
// under vecket bär substansen för den som scrollar.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

const DISPLAY = "font-['Sora','Manrope',sans-serif]";
const GRID_BG =
  "bg-[linear-gradient(to_right,#eceae7_1px,transparent_1px),linear-gradient(to_bottom,#eceae7_1px,transparent_1px)] bg-[length:180px_180px] bg-[position:center_top]";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Angel — paste your website, see what it could do better" },
      {
        name: "description",
        content:
          "Paste your website's address. Angel builds a free example on your own page — what it would change and the numbers behind it — then installs with one line of code and proves the lift against a held-back control group.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-[#fafaf9] text-stone-900 antialiased">
      <Nav />
      <Hero />
      <QuietSubstance />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
        <span className="text-xl leading-none text-emerald-700">✳</span> Angel
      </div>
      <nav className="flex items-center gap-1 text-sm">
        <Link to="/login" className="px-3 py-2 font-medium text-stone-500 hover:text-stone-900">
          Sign in
        </Link>
        <Link
          to="/signup"
          className="rounded-lg px-3 py-2 font-medium text-stone-500 transition hover:text-stone-900"
        >
          Sign up
        </Link>
      </nav>
    </header>
  );
}

// Mono margin annotation on the hero grid — kept from v1: the quiet, honest
// numbers ARE the brand.
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
    <main className={`relative flex flex-1 items-center justify-center border-y border-stone-200 ${GRID_BG}`}>
      <Note className="left-6 top-12">[ visitor: mobile · google ]</Note>
      <Note className="right-6 top-24">[ lift: +0.9pp vs control ]</Note>
      <Note className="bottom-16 left-8">[ cwv: untouched ]</Note>
      <Note className="bottom-24 right-10">[ reversible: 100% ]</Note>
      <span className="absolute left-[180px] top-[180px] hidden -translate-x-1/2 -translate-y-1/2 text-emerald-600 lg:block">
        ✳
      </span>

      <div className="relative mx-auto w-full max-w-2xl px-4 py-24 text-center">
        <h1 className={`${DISPLAY} text-4xl font-semibold tracking-tight sm:text-5xl`}>
          What&apos;s your website?
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-stone-500">
          Paste your address. Angel builds a free example on your own page — what it would change,
          and the numbers behind it.
        </p>

        <TryUrlForm />

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-mono text-[11px] tracking-wider text-stone-400">
          <span>[ reads what you publish ]</span>
          <span>[ proves lift vs a control ]</span>
          <span>[ never makes it worse ]</span>
        </div>
      </div>
    </main>
  );
}

/** Trattens topp: URL in → köa förhandsvisningsjobbet → /try pollar tills
 *  exemplet (prospektets EGEN sida, before/after + siffror) är byggt och
 *  leder vidare till installationen. Samma jobb-API som förut — bara heron
 *  som bytt skepnad. */
function TryUrlForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/preview/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { ok: boolean; id?: string; reason?: string };
      if (data.ok && data.id) {
        window.location.href = `/try?id=${data.id}`;
        return;
      }
      setError(
        data.reason === "rate_limited"
          ? "That's the daily limit from your network — try again tomorrow."
          : data.reason === "private_host" || data.reason === "not_public"
            ? "That address isn't publicly reachable — paste your live site's URL."
            : "We couldn't read that as a website address — try the full URL.",
      );
    } catch {
      setError("Something went wrong on our side — try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-9 w-full max-w-xl">
      <div className="flex items-center gap-2 rounded-2xl border border-stone-300 bg-white p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] transition focus-within:border-emerald-600">
        <input
          type="text"
          inputMode="url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yourwebsite.com"
          className="min-w-0 flex-1 bg-transparent px-4 py-3 text-[17px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
          aria-label="Your website address"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          aria-label="Show me"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-stone-900 text-white transition hover:bg-stone-700 disabled:opacity-40"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-2.5 text-[12.5px] text-stone-400">
        Free · ready in a few minutes · no signup needed to look
      </p>
      {error && <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p>}
    </form>
  );
}

// Under vecket: substansen som EN viskande rad per steg — för den som
// scrollar, och för sökmotorerna. Inga kort, inga sektioner, inga CTA-block.
const STEPS = [
  {
    tag: "[ 01 · read ]",
    body: "Angel catalogs what your site already publishes — headlines, CTAs, trust signals. It never invents copy, only re-surfaces yours.",
  },
  {
    tag: "[ 02 · steer ]",
    body: "Each visitor gets the page tuned toward your goal — the right message per traffic source and device, in small reversible changes.",
  },
  {
    tag: "[ 03 · prove ]",
    body: "A slice of visitors is deliberately left alone as a control group. You get one honest number: the extra conversions Angel caused.",
  },
];

function QuietSubstance() {
  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <div className="space-y-5">
        {STEPS.map((s) => (
          <div key={s.tag} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
            <span className="flex-none font-mono text-[11px] tracking-wider text-emerald-700">
              {s.tag}
            </span>
            <p className="text-[14.5px] leading-relaxed text-stone-500">{s.body}</p>
          </div>
        ))}
        <div className="flex flex-col gap-1 border-t border-stone-200 pt-5 sm:flex-row sm:items-baseline sm:gap-4">
          <span className="flex-none font-mono text-[11px] tracking-wider text-stone-400">
            [ safety ]
          </span>
          <p className="text-[14.5px] leading-relaxed text-stone-500">
            One async line of code. Never touches your largest content element, never shifts layout,
            fails open, consent-first.{" "}
            <Link
              to="/seo-and-privacy"
              className="underline decoration-stone-300 underline-offset-2 hover:text-stone-700"
            >
              SEO, performance &amp; privacy
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-stone-500">
        <div className="flex items-center gap-2 font-bold text-stone-800">
          <span className="text-emerald-700">✳</span> Angel
        </div>
        <span className="font-mono text-[11px] tracking-wider text-stone-400">
          [ paste · preview · install · proven ]
        </span>
      </div>
    </footer>
  );
}
