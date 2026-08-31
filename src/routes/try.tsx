// /try?id=… — prospekt-förhandsvisningens status- och resultatsida (trattens
// topp). Pollar /api/preview/job tills arbetaren byggt exemplet på prospektets
// EGEN sida, och visar det UPPSLUKANDE (ägarbeslut 2026-08-30): kopian av
// deras sida ÄR sidans eget flöde — webbläsarens vanliga skroll skrollar
// deras sajt i naturlig fullhöjd, med en flytande kontrollrad (Original ⇄
// Variant + "what moved?"-spotlight). Flip byter synlighet mellan två
// monterade kopior — platsen i skrollen bevaras exakt. Efter sajtens slut
// skrollar man rakt in i fynden, rapporten och CTA:n.
//
// SANDBOX-SÄKERHETEN (kartläggning 2026-08-30): iframen kör
// sandbox="allow-same-origin" UTAN allow-scripts — kombinera dem ALDRIG här.
// Tre lager håller: kopiorna är script-strippade vid frysning, svarets CSP
// saknar script-src (default-src 'none' ⇒ inget exekverar, inline-handlers
// inräknade), och sandbox-flaggan stänger barnets egen exekvering. Kopian
// kan redan i dag öppnas direkt på vår origin utan sandbox alls, så
// allow-same-origin ger ingen förmåga en angripare inte redan har. Samma
// lättnad får ALDRIG kopieras till /api/sandbox/mirror-ramarna (kör riktiga
// sajters skript).
//
// Ärlig väntan: bygget tar några minuter (isolerad arbetare, riktig browser).
// Sidan säger det rakt ut i stället för en evig spinner — samma ärlighets-
// kontrakt som resten av produkten. Hållna jobb (grindarna sa nej) har inga
// sidkopior — HEAD-proben får 404 och sidan behåller den klassiska
// rapportvyn utan sandbox.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { encodePendingActivation, PENDING_ACTIVATION_KEY } from "@/lib/onboarding/derive";
import { findMovedSection, type DocumentLike } from "@/lib/preview/locate";

interface JobView {
  status: "queued" | "running" | "ok" | "failed";
  url: string;
  reportUrl: string | null;
  findings: {
    headlines?: string[];
    liftTest?: string | null;
    moved?: { tag: string | null; text: string } | null;
  } | null;
  error: string | null;
}

const POLL_MS = 4000;
const MAX_POLL_MINUTES = 25;

/** Spotlight-stilen injiceras i after-kopian (style-src 'unsafe-inline' i
 *  kopians CSP tillåter inline-<style>). En puls som spelar en gång och
 *  lämnar en diskret ram — aldrig något som förvanskar sidans eget uttryck. */
const SPOTLIGHT_CSS = `
.agritm-spotlight { outline: 3px solid rgba(4,120,87,.9); outline-offset: 4px;
  border-radius: 6px; animation: agritm-pulse 1.6s ease-out 2; }
@keyframes agritm-pulse {
  0% { outline-color: rgba(4,120,87,.95); outline-offset: 10px; }
  100% { outline-color: rgba(4,120,87,.45); outline-offset: 4px; }
}`;

function TryPage() {
  // Sökparametern via routern (granskningsfynd 2026-07-28): den gamla
  // typeof window-läsningen gav id=null vid SSR — servern renderade "We
  // can't find that preview." som FÖRSTA intryck för varje prospekt, och
  // hydreringen fick reparera. validateSearch gör id känt redan på servern.
  const { id } = Route.useSearch();
  const [job, setJob] = useState<JobView | null>(null);
  const [gone, setGone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Original/Variant-växlaren: före/efter-sidorna finns i lagringen BARA när
  // grindarna släppt igenom förslaget — en HEAD-probe avgör om scenen visas
  // (hållna jobb får 404 och behåller den ärliga rapportvyn). TRE lägen
  // (granskningsfynd 2026-08-31): medan proben är pending hålls ok-vyn
  // tillbaka — annars blixtrade hela klassiska kortlayouten (inkl. tunga
  // rapport-iframen) i en proberundtur innan scenen rev och byggde om allt.
  const [probe, setProbe] = useState<"pending" | "ok" | "missing">("pending");
  const [arm, setArm] = useState<"after" | "before">("after");
  // Naturlig dokumenthöjd per kopia — mäts vid load; scenen får den aktiva
  // armens höjd så sidans EGEN skroll bär hela kopian (ingen inre skroll).
  const [heights, setHeights] = useState<{ before: number | null; after: number | null }>({
    before: null,
    after: null,
  });
  const [canSpotlight, setCanSpotlight] = useState(false);
  const beforeRef = useRef<HTMLIFrameElement | null>(null);
  const afterRef = useRef<HTMLIFrameElement | null>(null);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Pollningen kan aldrig fastna (granskningsfynd 2026-07-28): den gamla
    // varianten schemalade nästa tick EFTER await — en hängande fetch (mobil-
    // nät, sovande flik) frös sidan i "Building…" för alltid och timeout-UI:t
    // nåddes aldrig. Nu: AbortController-timeout per anrop + omschemaläggning
    // i finally, och cleanup rensar timern så inget setState sker efter unmount.
    const tick = async () => {
      if (stop) return;
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 10_000);
      let terminal = false;
      try {
        const res = await fetch(`/api/preview/job?id=${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        if (stop) return;
        if (res.status === 404) {
          terminal = true;
          setGone(true);
          return;
        }
        const data = (await res.json()) as ({ ok: true } & JobView) | { ok: false };
        if (stop) return;
        if ("status" in data) {
          setJob(data);
          terminal = data.status === "ok" || data.status === "failed";
        } else if (res.status >= 400 && res.status < 500) {
          // Terminalt klientfel stoppar pollingen (granskningsfynd 2026-08-14):
          // ett stympat id ger 400 {ok:false, reason:"bad_id"} — utan detta
          // snurrade "Building your example…" i 25 minuter i stället för det
          // ärliga "We can't find that preview". 5xx lämnas åt nästa poll.
          terminal = true;
          setGone(true);
        }
      } catch {
        /* nätverksblipp/timeout — nästa poll försöker igen */
      } finally {
        clearTimeout(abortTimer);
        if (!stop && !terminal) {
          if (Date.now() - started.current > MAX_POLL_MINUTES * 60_000) {
            setTimedOut(true);
          } else {
            timer = setTimeout(tick, POLL_MS);
          }
        }
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!id || job?.status !== "ok") return;
    let cancelled = false;
    fetch(`/api/preview/page?id=${encodeURIComponent(id)}&which=after`, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setProbe(res.ok ? "ok" : "missing");
      })
      .catch(() => {
        if (!cancelled) setProbe("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [id, job?.status]);

  /** Vid load av en kopia: mät naturhöjden (en gång till strax efter, när
   *  data-URI-bilderna satt sig), neutralisera länkklick (en klickad länk
   *  hade annars navigerat ramen bort från kopian — formulär stoppas redan
   *  av kopians CSP), och avgör om spotlighten kan peka ut något. */
  const onCopyLoad = useCallback(
    (which: "before" | "after") => {
      const frame = which === "before" ? beforeRef.current : afterRef.current;
      const doc = frame?.contentDocument;
      if (!doc) return;
      try {
        // Bara LÄNK-navigering neutraliseras (granskningsfynd 2026-08-31):
        // ett blankt preventDefault gjorde även <details>-dragspel och andra
        // skriptfria interaktioner i kopian döda. Formulär stoppas av CSP:n.
        doc.addEventListener(
          "click",
          (e) => {
            const t = e.target as Element | null;
            if (t && typeof t.closest === "function" && t.closest("a[href]")) e.preventDefault();
          },
          true,
        );
        const measure = () => {
          const h = doc.documentElement?.scrollHeight ?? 0;
          if (h > 0) setHeights((prev) => (prev[which] === h ? prev : { ...prev, [which]: h }));
        };
        measure();
        setTimeout(measure, 600);
        if (which === "after") {
          const moved = job?.findings?.moved ?? null;
          setCanSpotlight(!!findMovedSection(doc as unknown as DocumentLike, moved));
        }
      } catch {
        /* utan åtkomst faller scenen tillbaka på inre skroll — aldrig ett kast */
      }
    },
    [job?.findings?.moved],
  );

  // Ommätning vid layoutskiften (granskningsfynd 2026-08-31): naturhöjden
  // mättes annars bara vid load — en rotation på en 360px-mobil reflowar
  // kopian och lämnade scenen med stal höjd (klippt innehåll eller ett dött
  // band). Debouncad resize/orientation-lyssnare i uppslukande läget.
  useEffect(() => {
    if (!(id && job?.status === "ok" && probe === "ok")) return;
    const remeasure = () => {
      for (const which of ["before", "after"] as const) {
        const doc = (which === "before" ? beforeRef : afterRef).current?.contentDocument;
        const h = doc?.documentElement?.scrollHeight ?? 0;
        if (h > 0) setHeights((prev) => (prev[which] === h ? prev : { ...prev, [which]: h }));
      }
    };
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(remeasure, 150);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [id, job?.status, probe]);

  /** "What moved?" — växla till varianten, lys upp den flyttade sektionen
   *  och skrolla dit. Ramen är i naturhöjd (aldrig inre skroll), så
   *  sektionens rect-topp i kopian ÄR dess offset från ramens topp. */
  const spotlight = useCallback(() => {
    setArm("after");
    const frame = afterRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    try {
      const el = findMovedSection(doc as unknown as DocumentLike, job?.findings?.moved ?? null);
      if (!el) return;
      if (!doc.getElementById("agritm-spotlight-style")) {
        const style = doc.createElement("style");
        style.id = "agritm-spotlight-style";
        style.textContent = SPOTLIGHT_CSS;
        doc.head?.appendChild(style);
      }
      const real = el as unknown as HTMLElement;
      real.classList.remove("agritm-spotlight");
      // Reflow så pulsanimationen spelar om vid upprepade klick.
      void real.offsetWidth;
      real.classList.add("agritm-spotlight");
      const frameTop = frame.getBoundingClientRect().top + window.scrollY;
      const secTop = real.getBoundingClientRect().top;
      window.scrollTo({ top: Math.max(0, frameTop + secTop - 96), behavior: "smooth" });
    } catch {
      /* spotlight är grädde — aldrig ett kast i resultatvyn */
    }
  }, [job?.findings?.moved]);

  const hostname = (() => {
    try {
      return job?.url ? new URL(job.url).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();

  // ── Uppslukande läget: kopian är sidans eget flöde ──────────────────────
  if (id && job?.status === "ok" && probe === "ok") {
    const stageHeight = heights[arm];
    // stage=1: scenens serveringsvariant — v-höjder omskrivna till px vid
    // frysviewporten, så 100vh-sektioner inte äter hela naturhöjdsramen.
    const copySrc = (which: "before" | "after") =>
      `/api/preview/page?id=${encodeURIComponent(id)}&which=${which}&stage=1`;
    const frameClass = (active: boolean) =>
      `mx-auto block w-[390px] max-w-full border-x border-stone-200 bg-white ${
        active ? "" : "invisible absolute inset-x-0 top-0"
      }`;
    return (
      <main className="min-h-screen bg-[#faf9f7] text-stone-900">
        {/* Flytande kontrollraden — enda krom ovanpå prospektets egen sida. */}
        <div className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/"
                className="flex-none text-[13px] font-medium text-stone-500 hover:text-stone-800"
              >
                ← Agritm
              </Link>
              <span className="hidden truncate font-mono text-[10.5px] uppercase tracking-[.12em] text-stone-400 sm:inline">
                [ {hostname ?? "your page"} — restaged ]
              </span>
            </div>
            <div className="flex items-center gap-2">
              {canSpotlight && (
                <button
                  type="button"
                  onClick={spotlight}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 transition hover:bg-emerald-100"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  What moved?
                </button>
              )}
              <div className="flex gap-0.5 rounded-lg bg-stone-100 p-0.5">
                {(
                  [
                    ["before", "Original"],
                    ["after", "Variant"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={arm === key}
                    onClick={() => setArm(key)}
                    className={`rounded-md px-3 py-1 text-[12px] font-semibold transition ${
                      arm === key
                        ? "bg-white text-emerald-800 shadow-sm"
                        : "text-stone-500 hover:text-stone-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Scenen: BÅDA kopiorna monterade i naturhöjd; flip byter bara
            synlighet ⇒ webbläsarens skrollposition — din plats på din egen
            sida — bevaras exakt. Höjden är den aktiva armens uppmätta
            dokumenthöjd; innan mätningen landat bär 100svh + inre skroll. */}
        <div className="bg-stone-100">
          <div
            className="relative mx-auto w-full max-w-[390px]"
            style={{ height: stageHeight ? `${stageHeight}px` : "100svh" }}
          >
            <iframe
              ref={beforeRef}
              src={copySrc("before")}
              title="Your page as published"
              sandbox="allow-same-origin"
              onLoad={() => onCopyLoad("before")}
              className={frameClass(arm === "before")}
              style={{ height: heights.before ? `${heights.before}px` : "100svh" }}
            />
            <iframe
              ref={afterRef}
              src={copySrc("after")}
              title="Your page with Agritm's change"
              sandbox="allow-same-origin"
              onLoad={() => onCopyLoad("after")}
              className={frameClass(arm === "after")}
              style={{ height: heights.after ? `${heights.after}px` : "100svh" }}
            />
          </div>
        </div>

        {/* Efter sajtens slut: fynden, rapporten och vägen vidare. */}
        <div className="border-t border-stone-200 bg-[#faf9f7] px-4 pb-16 pt-2">
          <div className="mx-auto w-full max-w-3xl">
            <p className="mt-4 text-center font-mono text-[10.5px] uppercase tracking-[.12em] text-stone-400">
              [ a frozen copy of your live page — the exact change the safety gates verified ]
            </p>
            <ResultCards job={job} id={id} hostname={hostname} />
          </div>
        </div>
      </main>
    );
  }

  // ── Klassiska läget: väntan, fel, borta — och hållna jobb (ingen kopia). ──
  return (
    <main className="min-h-screen bg-[#faf9f7] px-4 py-16 text-stone-900">
      <div className="mx-auto w-full max-w-3xl">
        <Link to="/" className="text-[13px] font-medium text-stone-500 hover:text-stone-800">
          ← Agritm
        </Link>

        {!id || gone ? (
          <Block title="We can't find that preview.">
            <p>
              The link may be old — previews are kept for a day or two.{" "}
              <Link to="/" className="font-semibold text-emerald-700 underline">
                Paste your URL again
              </Link>{" "}
              and we'll build a fresh one.
            </p>
          </Block>
        ) : !job || job.status === "queued" || job.status === "running" ? (
          timedOut ? (
            <Block title="This is taking longer than it should.">
              <p>
                Your example is still in the queue — leave this page open, or come back to this link
                later. If it never lands, your site may block robots; that's worth knowing too, and
                installing the one-line snippet sidesteps it entirely.
              </p>
            </Block>
          ) : (
            <Block title={`Building your example${hostname ? ` for ${hostname}` : ""}…`}>
              <p>
                A real browser is loading your page, mapping every section, finding the trust
                signals you already published, and test-lifting the strongest one above the fold —
                with screenshots of before and after.
              </p>
              <p className="mt-3 text-stone-500">
                This usually takes <span className="font-semibold">2–5 minutes</span>. The page
                checks by itself — no need to refresh.
              </p>
              <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-600" />
              </div>
            </Block>
          )
        ) : job.status === "failed" ? (
          <Block title="We couldn't build an example for that page.">
            <p>
              {job.error === "expired"
                ? "The preview queue was backed up and this job expired."
                : "The page couldn't be loaded or analysed — some sites block robots, and some pages have no liftable structure."}{" "}
              That's an honest no, not a maybe.{" "}
              <Link to="/" className="font-semibold text-emerald-700 underline">
                Try another URL
              </Link>
              , or install the snippet — the on-page engine sees what crawlers can't.
            </p>
          </Block>
        ) : probe === "pending" ? (
          /* Ok-vyn hålls tillbaka en proberundtur (granskningsfynd
             2026-08-31): annars blixtrade kortlayouten + tunga rapporten
             innan scenen rev och byggde om hela sidan. */
          <Block title={`Your example for ${hostname ?? "your page"} is ready.`}>
            <p className="text-stone-500">Preparing the view…</p>
          </Block>
        ) : (
          <ResultCards job={job} id={id} hostname={hostname} />
        )}
      </div>
    </main>
  );
}

/** Fynden, rapporten och CTA:n — delade mellan uppslukande läget (efter
 *  scenen) och klassiska läget (hållna jobb utan sidkopior). */
function ResultCards({ job, id, hostname }: { job: JobView; id: string; hostname: string | null }) {
  return (
    <>
      <Block title={`Here's what Agritm found on ${hostname ?? "your page"}.`}>
        {job.findings?.headlines && job.findings.headlines.length > 0 && (
          <ul className="mt-1 space-y-2">
            {job.findings.headlines.map((h) => (
              <li key={h} className="flex items-start gap-2 text-[15px]">
                <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-emerald-600" />
                {h}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-stone-600">
          Every finding is a measurement of your live page — nothing is invented. The full report
          shows your page before and after, using only content you already published.
        </p>
      </Block>

      {/* Rapporten VISAS direkt (ägarfynd 2026-07-27: "får ingen riktig
          rapport" — en länk är inte en rapport). Självbärande HTML ur
          vår egen lagring; länken kvar som sekundär för ny flik. */}
      {job.reportUrl && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[.12em] text-stone-400">
              [ the report — measured on your live page ]
            </span>
            <a
              href={job.reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-stone-500 hover:text-stone-800"
            >
              Open in a new tab
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <iframe
            src={job.reportUrl}
            title="Agritm report"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="h-[72vh] w-full"
          />
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6">
        <h2 className="text-[17px] font-semibold text-emerald-900">
          Want this measured on real visitors?
        </h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-emerald-900/80">
          Install one line of code. Agritm observes first, adapts with your approval, and proves the
          lift against a held-back control group.{" "}
          <span className="font-semibold">Free until your first verified variant</span> — your card
          waits until the robot has earned it.
        </p>
        {/* Handoffen (2026-08-18, "snuskigt enkel onboarding"): jobb-id:t
            läggs i localStorage så /welcome kan auto-skapa sajten ur
            demo-jobbet efter auth — domän/slug/namn härleds, inga
            formulär. localStorage (inte sessionStorage): bekräftelse-
            mejlets länk öppnar ofta en ny flik. */}
        <Link
          to="/signup"
          onClick={() => {
            try {
              localStorage.setItem(PENDING_ACTIVATION_KEY, encodePendingActivation(id, Date.now()));
            } catch {
              /* utan lagring faller flödet tillbaka till dashboardens formulär */
            }
          }}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-600"
        >
          {hostname ? `Activate on ${hostname} — free` : "Start free"}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
      <div className="mt-3 text-[14.5px] leading-relaxed text-stone-700">{children}</div>
    </div>
  );
}

export const Route = createFileRoute("/try")({
  // id valideras/normaliseras här så SSR och klient ser samma värde —
  // aldrig mer serverrenderat "We can't find that preview" för giltiga länkar.
  validateSearch: (s: Record<string, unknown>) => ({
    id: typeof s.id === "string" && s.id.length > 0 ? s.id : undefined,
  }),
  component: TryPage,
});
