// / — Angel landing: URL-paste ÄR sidan (ägarbeslut 2026-07-27, Claude/
// ChatGPT-minimalism). En fråga, ett fält, inget annat ovanför vecket —
// pastan startar hela tratten: förhandsvisningsjobb → /try visar exemplet
// på prospektets EGEN sida med siffror → installera-CTA in i signup.
//
// Design language behållet: warm paper (stone) + one deep emerald accent,
// hairline grid, mono margin annotations — crafted dev-tool feel, no
// gradients. Allt säljande långstoff är BORTA; en viskande trerads-strip
// under vecket bär substansen för den som scrollar.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
      {/* Ägarbeslut 2026-07-27: EN grön "Try Angel" i hörnet — inga
          sign in/sign up-länkar (inloggningen bor diskret i sidfoten).
          Knappen fokuserar inklistringsfältet: hela sidan ÄR try-flödet. */}
      <button
        type="button"
        onClick={() => {
          const el = document.getElementById("try-url") as HTMLInputElement | null;
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          el?.focus();
        }}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
      >
        Try Angel
      </button>
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
    <main
      className={`relative flex flex-1 items-center justify-center border-y border-stone-200 ${GRID_BG}`}
    >
      <Note className="left-6 top-12">[ visitor: mobile · google ]</Note>
      <Note className="right-6 top-24">[ lift: +0.9pp vs control ]</Note>
      <Note className="bottom-16 left-8">[ cwv: untouched ]</Note>
      <Note className="bottom-24 right-10">[ reversible: 100% ]</Note>
      <span className="absolute left-[180px] top-[180px] hidden -translate-x-1/2 -translate-y-1/2 text-emerald-600 lg:block">
        ✳
      </span>

      <div className="relative mx-auto w-full max-w-2xl px-4 py-24 text-center">
        <h1
          className={`${DISPLAY} text-4xl font-semibold leading-[1.08] tracking-tight sm:text-[52px]`}
        >
          Turn your website into an algorithm.
          <br />
          <span className="text-emerald-700">Convert more.</span>
        </h1>
        <TryUrlForm />

        <SnippetChip />

        <PoweredBy />
      </div>
    </main>
  );
}

// "Powered by"-raden (ägarbeslut 2026-07-27): ENBART infrastruktur Angel
// bevisbart kör på — aldrig kund- eller partnersken, aldrig leverantörer vi
// inte använder (ChatGPT/OpenAI hölls uttryckligen UTE tills de faktiskt är
// i stacken; Stripe läggs till när billing armeras). Tysta wordmarks i grått
// som tonar upp vid hover — samma viskningsnivå som marginalnoteringarna.
const POWERED_BY = ["Netlify", "Supabase", "Anthropic", "GitHub", "Browserbase"];

function PoweredBy() {
  return (
    <div className="mt-14">
      <div className="font-mono text-[10.5px] tracking-wider text-stone-400">
        [ powered by modern web infrastructure ]
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
        {POWERED_BY.map((name) => (
          <span
            key={name}
            className={`${DISPLAY} text-[15px] font-semibold tracking-tight text-stone-300 transition-colors hover:text-stone-500`}
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Trattens topp: URL in → köa förhandsvisningsjobbet → /try pollar tills
 *  exemplet (prospektets EGEN sida, before/after + siffror) är byggt och
 *  leder vidare till installationen. Samma jobb-API som förut — bara heron
 *  som bytt skepnad. */
function TryUrlForm() {
  const navigate = useNavigate();
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
        // SPA-navigering i stället för full omladdning (granskningsfynd
        // 2026-07-28): window.location gav en hel serverrundtur rakt in i
        // /try — långsammare och i onödan via SSR-vägen.
        void navigate({ to: "/try", search: { id: data.id } });
        return;
      }
      // Serverfel skyller aldrig på användaren (granskningsfynd 2026-08-14):
      // 503 disabled/unavailable och 500 write_failed föll tidigare ner i
      // "We couldn't read that as a website address" — falsk anklagelse mot
      // en helt giltig URL under ett driftavbrott på VÅR sida.
      setError(
        data.reason === "rate_limited"
          ? "That's the daily limit from your network — try again tomorrow."
          : data.reason === "private_host" || data.reason === "not_public"
            ? "That address isn't publicly reachable — paste your live site's URL."
            : res.status >= 500
              ? "Something went wrong on our side — try again in a minute."
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
          id="try-url"
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
          className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-emerald-700 text-white transition hover:bg-emerald-600 disabled:opacity-40"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-2.5 text-[13px] text-stone-400">
        See your website adapt in minutes. Enter your URL — no signup required.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-[13px] font-medium text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

// Den lilla snippet-chippen: "en rad kod" sagt VISUELLT i stället för med
// säljtext (ägarbeslut 2026-07-27: substanstexterna skapade brus för tidigt —
// de återkommer senare i tydligare format, inte på heron).
function SnippetChip() {
  return (
    <div className="mx-auto mt-12 inline-block text-left">
      <div className="font-mono text-[10.5px] tracking-wider text-stone-400">
        [ the whole install — one line ]
      </div>
      <code className="mt-1.5 block whitespace-pre-wrap break-all rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-stone-500 shadow-[0_1px_0_#e7e5e4]">
        <span className="text-stone-400">&lt;script</span> async src=
        <span className="text-emerald-700">&quot;…/adaptive.js&quot;</span> data-site=
        <span className="text-emerald-700">&quot;your-site&quot;</span>
        <span className="text-stone-400">&gt;&lt;/script&gt;</span>
      </code>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-stone-500">
        <div className="flex items-center gap-2 font-bold text-stone-800">
          <span className="text-emerald-700">✳</span> Angel
        </div>
        <span className="flex items-center gap-4">
          <Link to="/login" className="text-[13px] text-stone-400 hover:text-stone-700">
            Sign in
          </Link>
          <span className="font-mono text-[11px] tracking-wider text-stone-400">
            [ paste · preview · install · proven ]
          </span>
        </span>
      </div>
    </footer>
  );
}
