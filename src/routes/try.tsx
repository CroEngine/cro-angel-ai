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
  const id =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("id") : null;
  const [job, setJob] = useState<JobView | null>(null);
  const [gone, setGone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/preview/job?id=${encodeURIComponent(id)}`);
        if (res.status === 404) {
          setGone(true);
          return;
        }
        const data = (await res.json()) as ({ ok: true } & JobView) | { ok: false };
        if ("status" in data) setJob(data);
        if ("status" in data && (data.status === "ok" || data.status === "failed")) return;
      } catch {
        /* nätverksblipp — nästa poll försöker igen */
      }
      if (Date.now() - started.current > MAX_POLL_MINUTES * 60_000) {
        setTimedOut(true);
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id]);

  const hostname = (() => {
    try {
      return job?.url ? new URL(job.url).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();

  return (
    <main className="min-h-screen bg-[#faf9f7] px-4 py-16 text-stone-900">
      <div className="mx-auto w-full max-w-2xl">
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
              {job.reportUrl && (
                <a
                  href={job.reportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-[14px] font-semibold text-stone-800 hover:bg-stone-50"
                >
                  Open the full report
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </Block>

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

export const Route = createFileRoute("/try")({ component: TryPage });
