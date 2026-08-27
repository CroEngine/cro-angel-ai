// / — Agritm landing: URL-paste ÄR sidan (ägarbeslut 2026-07-27, Claude/
// ChatGPT-minimalism). En fråga, ett fält, inget annat ovanför vecket —
// pastan startar hela tratten: förhandsvisningsjobb → /try visar exemplet
// på prospektets EGEN sida med siffror → installera-CTA in i signup.
//
// Design language behållet: warm paper (stone) + one deep emerald accent,
// hairline grid, mono margin annotations — crafted dev-tool feel, no
// gradients.
//
// SÄLJLAGREN UNDER VECKET (ägarbeslut 2026-08-18): 2026-07-27-beslutet tog
// bort substanstexterna "för tidigt — de återkommer senare i tydligare
// format". Det här är det formatet: hur-det-funkar i tre steg, de fem
// löftena (motorns egna regler som kundlöften), ärliga siffror (statiska
// motorfakta + live-aggregat från /api/public/stats) och pilot-caset.
// Hårda regeln från samma beslut: ALDRIG påhittad statistik — varje siffra
// på sidan är mätt (korpusen, grindarna, databasen) eller utelämnad.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { statTiles, type PublicStats } from "@/lib/public-stats/stats";

const DISPLAY = "font-['Sora','Manrope',sans-serif]";
const GRID_BG =
  "bg-[linear-gradient(to_right,#eceae7_1px,transparent_1px),linear-gradient(to_bottom,#eceae7_1px,transparent_1px)] bg-[length:180px_180px] bg-[position:center_top]";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agritm — paste your website, see what it could do better" },
      {
        name: "description",
        content:
          "Paste your website's address. Agritm builds a free example on your own page — what it would change and the numbers behind it — then installs with one line of code and proves the lift against a held-back control group.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-[#fafaf9] text-stone-900 antialiased">
      <Nav />
      {/* ETT <main>-landmärke för allt huvudinnehåll (granskningsfynd
          2026-08-18: sektionerna låg utanför main — skärmläsarens "hoppa
          till innehåll" missade allt under vecket). */}
      <main className="flex flex-1 flex-col">
        <Hero />
        <HowItWorks />
        <Promises />
        <HonestNumbers />
        <PilotCase />
        <BottomCta />
      </main>
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
        <span className="text-xl leading-none text-emerald-700">✳</span> Agritm
      </div>
      {/* Ägarbeslut 2026-07-27: EN grön "Try Agritm" i hörnet — inga
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
        Try Agritm
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
    // min-h håller "inget annat ovanför vecket" (ägarbeslut 2026-07-27) nu
    // när sidan fått innehåll under: heron fyller första skärmen själv i
    // stället för att krympa till naturlig höjd. 73px = navens höjd + hairline.
    // <section>, inte <main> — landmärket bor i Landing sedan sektionerna kom.
    <section
      className={`relative flex min-h-[calc(100svh-73px)] flex-1 items-center justify-center border-y border-stone-200 ${GRID_BG}`}
    >
      <Note className="left-6 top-12">[ visitor: mobile · google ]</Note>
      {/* Var "[ lift: +0.9pp vs control ]" — en siffra utan källa från
          v1-designen. Ärlighetsregeln 2026-08-18 gäller även gammalt stoff:
          annotationen bär nu den VERIFIERADE variantens grindrad i stället. */}
      <Note className="right-6 top-24">[ ctas intact: 2/2 · lcp shift: 0px ]</Note>
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
    </section>
  );
}

// "Powered by"-raden (ägarbeslut 2026-07-27): ENBART infrastruktur Agritm
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

/** Gemensam sektionsram under vecket: mono-bracket-etikett + rubrik i
 *  display-snittet — samma viskningsnivå som marginalnoteringarna. */
function Section({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-stone-200">
      <div className="mx-auto w-full max-w-5xl px-6 py-20">
        <div className="font-mono text-[10.5px] tracking-wider text-stone-400">{label}</div>
        <h2 className={`${DISPLAY} mt-2 text-2xl font-semibold tracking-tight sm:text-3xl`}>
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Paste",
      body: "Agritm reads your live page, finds every section, and builds one example improvement on your actual site — before/after screenshots included. No signup, no install.",
    },
    {
      n: "02",
      title: "Approve",
      body: "Every proposal arrives with picture proof and its safety numbers: layout shift, buttons re-checked, fully reversible. Nothing goes live until you click approve.",
    },
    {
      n: "03",
      title: "Proven",
      body: "Your approved change is shown to real visitors and measured against a held-back control group. What wins stays. What doesn't is retired — automatically.",
    },
  ];
  return (
    <Section label="[ how it works ]" title="Paste. Approve. Proven.">
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          >
            <div className="font-mono text-[11px] tracking-wider text-emerald-700">{s.n}</div>
            <h3 className={`${DISPLAY} mt-1.5 text-lg font-semibold`}>{s.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-stone-600">{s.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// De fem löftena ÄR motorns egna hårda regler (move-only-vokabulären,
// verbatim-regeln, beteenderankningen, facit-mätningen, ägarknappen) —
// omskrivna som kundlöften. Ändras en regel i motorn måste raden här ändras
// med den; sidan får aldrig lova något koden inte håller.
function Promises() {
  const promises = [
    {
      title: "We never rewrite your copy.",
      body: "Agritm only rearranges sections that already exist on your page.",
    },
    {
      title: "We never invent content.",
      body: "Every word stays yours, verbatim. Nothing is generated onto your site.",
    },
    {
      title: "Ranked on real visitors.",
      body: "Proposals come from what your visitors actually do — not from taste.",
    },
    {
      title: "Measured against control.",
      body: "Every live change proves itself against a held-back group, or is retired.",
    },
    {
      title: "Nothing ships without your click.",
      body: "A verified proposal waits for you. Going live is always your decision.",
    },
  ];
  return (
    <Section label="[ five promises ]" title="Built to be trusted with your website.">
      <ul className="mt-8 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {promises.map((p) => (
          <li key={p.title} className="flex items-baseline gap-4 px-6 py-4">
            <span aria-hidden className="text-emerald-700">
              ✓
            </span>
            <div>
              <span className="font-semibold text-stone-800">{p.title}</span>{" "}
              <span className="text-[14px] text-stone-500">{p.body}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Statiska motorfakta — varje siffra har en källa i repo/körningarna:
//  92%   — sektionsupplösningen mot korpusen av riktiga sajter (36/39,
//          mätt 2026-08-16 via file://-lastade MHTML-kopior). INGEN länk till
//          /corpus (granskningsfynd 2026-08-18): sidan är inloggningsgrindad
//          admin-yta — "open corpus" på en publik startsida vore osant tills
//          en publik korpusvy finns.
//  8 px  — LCP_SHIFT_FAIL_PX i render-gates.ts. Granskningsfynd 2026-08-18:
//          "0 px" var falskt — budgeten är 8 px; de hittills verifierade
//          förslagen MÄTTE 0 px, men löftet på sidan måste vara grindens.
//  100%  — reversibilitetsgrinden: varje applicerat drag kan rullas tillbaka
//  1,400+ — testsviten bakom motorn (~1424 vid skrivtillfället)
const ENGINE_FACTS = [
  {
    value: "92%",
    label: "of real-world pages resolve to movable sections — measured on our test corpus",
  },
  {
    value: "8 px",
    label:
      "the most your largest element may shift — one pixel more and the proposal is auto-rejected",
  },
  { value: "100%", label: "reversible — every change can be rolled back with one click" },
  { value: "1,400+", label: "automated tests behind the engine" },
];

function HonestNumbers() {
  // Live-siffrorna hämtas klientside och döljs helt när hämtningen faller
  // eller allt är noll (statTiles ärlighetsregel) — sektionen står sig på de
  // statiska fakta ensam. Ingen spinner: siffror dyker upp när de finns.
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/public/stats", { signal: ctrl.signal });
        const data = (await res.json()) as { ok: boolean; stats?: PublicStats };
        if (data.ok && data.stats) setStats(data.stats);
      } catch {
        /* tyst — sektionen renderar de statiska fakta ändå */
      }
    })();
    return () => ctrl.abort();
  }, []);
  const live = statTiles(stats);

  return (
    <Section label="[ honest numbers ]" title="No made-up statistics. These are measured.">
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ENGINE_FACTS.map((f) => (
          <div
            key={f.value}
            className="rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          >
            <div className={`${DISPLAY} text-3xl font-semibold text-emerald-700`}>{f.value}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500">{f.label}</p>
          </div>
        ))}
      </div>
      {live.length > 0 && (
        <div className="mt-10">
          <div className="font-mono text-[10.5px] tracking-wider text-stone-400">
            [ live from the engine ]
          </div>
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            {live.map((t) => (
              <div key={t.label} className="flex items-baseline gap-2.5">
                <span className={`${DISPLAY} text-2xl font-semibold text-stone-800`}>
                  {t.value}
                </span>
                <span className="text-[13px] text-stone-500">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-8 text-[13px] text-stone-400">
        The 92% is 36 of 39 real websites in our test corpus resolving to movable sections. The live
        counters read straight from the engine&apos;s database.
      </p>
    </Section>
  );
}

// Pilot-caset i DÅTID med datumstämpel (granskningsfynd 2026-08-18: hårdkodad
// presens — "waits for the owner's click", "measuring right now" — blir tyst
// osann när variantens tillstånd ändras). Varje mening är sann som historik:
// cellen / × alla (212 besök, 8,5 % mot sajtsnittet 2,6 %), varianten
// verifierad 2026-08-17, grindsiffrorna är variantens uppmätta evidence.
// Nutidsclaims hör hemma i live-räknarna ovanför, som läser databasen.
function PilotCase() {
  return (
    <Section label="[ from the pilot ]" title="What one night with the engine looks like.">
      <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <p className="text-[15px] leading-relaxed text-stone-600">
          One August night on our pilot site, the engine measured the home page converting at{" "}
          <span className="font-semibold text-stone-800">8.5%</span> against a{" "}
          <span className="font-semibold text-stone-800">2.6%</span> site-wide average — and by
          morning had built, gate-checked and verified a change that shows every visitor what
          already works, before/after screenshots attached. Going live stayed where it always stays:
          behind the owner&apos;s click.
        </p>
        <p className="mt-4 font-mono text-[11px] tracking-wider text-stone-400">
          [ pilot log · aug 2026 · measured gates: lcp shift 0px · ctas intact 2/2 · overlap 0px ·
          reversible ]
        </p>
      </div>
    </Section>
  );
}

function BottomCta() {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-5xl px-6 py-20 text-center">
        <h2 className={`${DISPLAY} text-2xl font-semibold tracking-tight sm:text-3xl`}>
          See it on your own website.
        </h2>
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById("try-url") as HTMLInputElement | null;
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            el?.focus();
          }}
          className="mt-6 rounded-xl bg-emerald-700 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-600"
        >
          Try Agritm — free example
        </button>
        <p className="mt-3 text-[13px] text-stone-400">
          Free until your first verified variant. No signup required for the example.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-sm text-stone-500">
        <div className="flex items-center gap-2 font-bold text-stone-800">
          <span className="text-emerald-700">✳</span> Agritm
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
