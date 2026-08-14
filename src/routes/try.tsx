// /try?id=… — prospekt-förhandsvisningens status- och resultatsida (trattens
// topp). Pollar /api/preview/job tills arbetaren byggt exemplet på prospektets
// EGEN sida, visar rapporten (before/after med deras egna bevis lyfta) och
// leder vidare in i signup → checkout ("free until your first verified
// variant" — kortet väntar, första debiteringen ÄR bevishändelsen).
//
// Ärlig väntan: bygget tar några minuter (isolerad arbetare, riktig browser).
// Sidan säger det rakt ut i stället för en evig spinner — samma ärlighets-
// kontrakt som resten av produkten.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

interface JobView {
  status: "queued" | "running" | "ok" | "failed";
  url: string;
  reportUrl: string | null;
  findings: { headlines?: string[]; liftTest?: string | null } | null;
  error: string | null;
}

const POLL_MS = 4000;
const MAX_POLL_MINUTES = 25;

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
  // grindarna släppt igenom förslaget — en HEAD-probe avgör om växlaren visas
  // (hållna jobb får 404 och behåller den ärliga rapportvyn).
  const [sandboxReady, setSandboxReady] = useState(false);
  const [arm, setArm] = useState<"after" | "before">("after");
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
        if (!cancelled) setSandboxReady(res.ok);
      })
      .catch(() => {
        if (!cancelled) setSandboxReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, job?.status]);

  const hostname = (() => {
    try {
      return job?.url ? new URL(job.url).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();

  return (
    <main className="min-h-screen bg-[#faf9f7] px-4 py-16 text-stone-900">
      <div className="mx-auto w-full max-w-3xl">
        <Link to="/" className="text-[13px] font-medium text-stone-500 hover:text-stone-800">
          ← Angel
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
        ) : (
          <>
            <Block title={`Here's what Angel found on ${hostname ?? "your page"}.`}>
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
                Every finding is a measurement of your live page — nothing is invented. The full
                report shows your page before and after, using only content you already published.
              </p>
            </Block>

            {/* Sandboxen (ägarfråga 2026-07-27: "kommer vi att se hemsidan i
                sandbox med ett förslag?"): prospektets RIKTIGA sida som
                skrollbar kopia, växlingsbar Original ⇄ Variant. Visas bara
                när grindarna släppt igenom förslaget — probe:n ovan får 404
                för hållna jobb. Mobilbredd med flit: scenariot är en mobil
                Google-besökare, samma viewport som varianten grindades i. */}
            {sandboxReady && id && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2">
                  <span className="font-mono text-[10.5px] uppercase tracking-[.12em] text-stone-400">
                    [ your page — try the change ]
                  </span>
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
                <div className="bg-stone-50 py-4">
                  <iframe
                    src={`/api/preview/page?id=${encodeURIComponent(id)}&which=${arm}`}
                    title={
                      arm === "after" ? "Your page with Angel's change" : "Your page as published"
                    }
                    sandbox=""
                    className="mx-auto block h-[72vh] w-[390px] max-w-full rounded-xl border border-stone-200 bg-white shadow-sm"
                  />
                </div>
                <p className="border-t border-stone-100 px-4 py-2 text-[12px] text-stone-400">
                  A frozen copy of your live page — scroll it. The variant is the exact change the
                  safety gates verified: no layout shift, LCP untouched, fully reversible.
                </p>
              </div>
            )}

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
                  title="Angel report"
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
                Install one line of code. Angel observes first, adapts with your approval, and
                proves the lift against a held-back control group.{" "}
                <span className="font-semibold">Free until your first verified variant</span> — your
                card waits until the robot has earned it.
              </p>
              <Link
                to="/signup"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-3 text-[15px] font-semibold text-white transition hover:bg-emerald-600"
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
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
