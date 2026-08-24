// /welcome — onboardingens enda skärm (ägarbeslut 2026-08-18, "snuskigt
// enkel"): sajten är redan auto-skapad ur demo-jobbet (localStorage-handoffen
// från /try via auth), så här återstår exakt tre saker — klistra in raden,
// se den kopplas upp live, och slå på besökarmätningen. Inga formulär: allt
// härleddes ur URL:en prospektet redan gav oss.
//
// Live-pulsen pollar getInstallState (4 s, try.tsx-mönstret) tills
// domain_verified_at stämplats av första origin-bevisade eventet — samma
// stämpel som day-0-mejlet. Attesterings-steget återanvänder setConsentMode
// och dashboardens exakta formuleringar (juridiskt meningsfull text ändras
// inte i en onboarding-puts).

import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { activateFromPreview, getInstallState } from "@/lib/onboarding/onboarding.functions";
import { decodePendingActivation, PENDING_ACTIVATION_KEY } from "@/lib/onboarding/derive";
import { buildSnippet } from "@/lib/snippet";
import { setConsentMode } from "@/lib/dashboard/dashboard.functions";

/** localStorage bakom try/catch (granskningsfynd 2026-08-19: blockerad
 *  lagring kastade i boot-effekten och lämnade sidan i evig spinner —
 *  syskonställena i try.tsx/auth-form vaktar redan samma nyckel). */
function readPending(now: number): { jobId: string } | null {
  try {
    return decodePendingActivation(localStorage.getItem(PENDING_ACTIVATION_KEY), now);
  } catch {
    return null;
  }
}
function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_ACTIVATION_KEY);
  } catch {
    /* redan utom räckhåll */
  }
}

export const Route = createFileRoute("/welcome")({
  validateSearch: (search: Record<string, unknown>): { site?: string } => ({
    site: typeof search.site === "string" && search.site ? search.site : undefined,
  }),
  // Klient-UX-grind som dashboarden: sessionen bor i localStorage (osynlig
  // under SSR); riktiga skyddet är server-side på varje server-fn.
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  head: () => ({ meta: [{ title: "Welcome — one line left" }] }),
  component: Welcome,
});

interface SiteState {
  slug: string;
  domain: string;
  ingestKey: string | null;
  installedAt: string | null;
  consentMode: "anonymous" | "attested" | null;
}

const POLL_MS = 4000;

// Plattformsanvisningar — var raden klistras. Generiska, verifierbara steg;
// inga skärmdumpar att hålla i synk.
const PLATFORMS: { key: string; label: string; steps: string[] }[] = [
  {
    key: "wordpress",
    label: "WordPress",
    steps: [
      "Install the free “WPCode” plugin (or any header/footer snippet plugin).",
      "Code Snippets → Header & Footer → paste the line into Header.",
      "Save — done. (Editing theme files works too: paste before </head>.)",
    ],
  },
  {
    key: "wix",
    label: "Wix",
    steps: [
      "Settings → Custom Code → Add Custom Code.",
      "Paste the line, apply to All pages, load once, place in Head.",
    ],
  },
  {
    key: "squarespace",
    label: "Squarespace",
    steps: ["Settings → Advanced → Code Injection.", "Paste the line into Header and save."],
  },
  {
    key: "shopify",
    label: "Shopify",
    steps: [
      "Online Store → Themes → Edit code.",
      "Open layout/theme.liquid and paste the line just before </head>.",
    ],
  },
  {
    key: "webflow",
    label: "Webflow",
    steps: ["Site settings → Custom code.", "Paste the line into Head code and publish."],
  },
  {
    key: "html",
    label: "Any site",
    steps: ["Paste the line just before </head> in your page template."],
  },
];

function Welcome() {
  const { site: siteParam } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<"boot" | "activating" | "ready" | "empty" | "failed">("boot");
  const [error, setError] = useState<{ text: string; retryable: boolean } | null>(null);
  const [site, setSite] = useState<SiteState | null>(null);
  const [platform, setPlatform] = useState(PLATFORMS[0].key);
  const [copied, setCopied] = useState(false);
  const [attestFailed, setAttestFailed] = useState(false);
  const started = useRef(false);

  // Aktivera ur handoffen, eller läs befintlig sajt ur ?site= (återbesök).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const pending = readPending(Date.now());
      if (pending) {
        setState("activating");
        const r = await activateFromPreview({ data: { jobId: pending.jobId } }).catch(() => null);
        if (r?.ok && r.slug && r.domain) {
          clearPending();
          // Riktigt läge direkt (granskningsfynd 2026-08-19: hårdkodade
          // null/anonymous visade "Waiting…"/"Paused" i 4 s för en redan
          // installerad, attesterad sajt som återaktiverades).
          const s = await getInstallState({ data: { site: r.slug } }).catch(() => null);
          setSite({
            slug: r.slug,
            domain: r.domain,
            ingestKey: s?.ok ? s.ingestKey : (r.ingestKey ?? null),
            installedAt: s?.ok ? s.installedAt : null,
            consentMode: s?.ok ? s.consentMode : "anonymous",
          });
          setState("ready");
          // ?site= i URL:en så en reload under installsteget landar rätt
          // (granskningsfynd 2026-08-19: utan den blev omladdning "Nothing
          // to set up here" för en splitterny sajt).
          void navigate({ to: "/welcome", search: { site: r.slug }, replace: true });
          return;
        }
        // Ärliga felvägar. Nyckeln rensas BARA vid definitiva avslag —
        // ett nätfel/transient 'error' behåller handoffen så en omladdning
        // kan lyckas (granskningsfynd 2026-08-19).
        const definitive =
          r?.reason === "job_not_found" ||
          r?.reason === "bad_domain" ||
          r?.reason === "domain_taken" ||
          r?.reason === "taken";
        if (definitive) clearPending();
        setError(
          r?.reason === "domain_taken" || r?.reason === "taken"
            ? {
                text: "That website is already registered to another account. If it's yours, sign in with that account — or contact us.",
                retryable: false,
              }
            : definitive
              ? {
                  text: "We couldn't carry your demo over — add your site from the dashboard instead.",
                  retryable: false,
                }
              : {
                  text: "Something went wrong on our side — reload this page to try again.",
                  retryable: true,
                },
        );
        setState("failed");
        return;
      }
      if (siteParam) {
        const s = await getInstallState({ data: { site: siteParam } }).catch(() => null);
        if (s?.ok && s.domain) {
          setSite({
            slug: siteParam,
            domain: s.domain,
            ingestKey: s.ingestKey,
            installedAt: s.installedAt,
            consentMode: s.consentMode,
          });
          setState("ready");
          return;
        }
      }
      setState("empty");
    })();
  }, [siteParam, navigate]);

  // Live-pulsen tills snippeten setts. Samma skyddsräcken som try.tsx-pollen
  // (granskningsfynd 2026-08-19: setInterval + hängande anrop staplade
  // requests, och sena svar kunde skriva över färskt läge): timeout-kedja med
  // omschemaläggning EFTER svaret, in-flight kan aldrig överlappa, installedAt
  // nedgraderas aldrig (null skriver inte över satt värde), och pulsen ger
  // upp efter 30 min — omladdning återupptar.
  useEffect(() => {
    if (state !== "ready" || !site || site.installedAt) return;
    const slug = site.slug;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const tick = async () => {
      if (stop) return;
      try {
        const s = await getInstallState({ data: { site: slug } }).catch(() => null);
        if (stop) return;
        if (s?.ok) {
          setSite((prev) =>
            prev
              ? {
                  ...prev,
                  installedAt: prev.installedAt ?? s.installedAt,
                  consentMode: s.consentMode ?? prev.consentMode,
                }
              : prev,
          );
          if (s.installedAt) return;
        }
      } finally {
        if (!stop && Date.now() - startedAt < 30 * 60_000) {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      }
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [state, site?.slug, site?.installedAt]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = site ? buildSnippet(site.slug, site.ingestKey, origin) : "";
  const installed = !!site?.installedAt;
  const attested = site?.consentMode === "attested";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* markera-och-kopiera funkar alltid som reserv */
    }
  };

  const attest = async () => {
    if (!site) return;
    setAttestFailed(false);
    const r = await setConsentMode({ data: { site: site.slug, mode: "attested" } }).catch(
      () => null,
    );
    if (r?.ok) {
      setSite((prev) => (prev ? { ...prev, consentMode: "attested" } : prev));
    } else {
      // Tyst misslyckande på den juridiskt/mätmässigt viktiga knappen vore
      // värst av allt (granskningsfynd 2026-08-19) — säg ärligt att det inte
      // sparades.
      setAttestFailed(true);
    }
  };

  const chosen = PLATFORMS.find((p) => p.key === platform) ?? PLATFORMS[0];

  return (
    <main className="min-h-screen bg-[#fafaf9] px-4 py-10 text-stone-900 antialiased">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
          <span className="text-xl leading-none text-emerald-700">✳</span> Angel
        </div>

        {(state === "boot" || state === "activating") && (
          <Block title="Setting up your site…">
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-stone-200">
              <div className="h-full w-1/3 animate-pulse rounded bg-emerald-600" />
            </div>
          </Block>
        )}

        {state === "failed" && (
          <Block title="We couldn't set that up automatically.">
            <p className="mt-2 text-[14.5px] text-stone-600">{error?.text}</p>
            {error?.retryable ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Try again
              </button>
            ) : (
              <Link
                to="/dashboard"
                className="mt-4 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Open the dashboard
              </Link>
            )}
          </Block>
        )}

        {state === "empty" && (
          <Block title="Nothing to set up here.">
            <p className="mt-2 text-[14.5px] text-stone-600">
              Start from the demo on the front page, or add your site in the dashboard.
            </p>
            <Link
              to="/dashboard"
              className="mt-4 inline-block rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600"
            >
              Open the dashboard
            </Link>
          </Block>
        )}

        {state === "ready" && site && (
          <>
            <h1 className="mt-6 text-[26px] font-semibold tracking-tight">
              {site.domain} is connected. <span className="text-emerald-700">One line left.</span>
            </h1>

            <Block label="[ step 1 — install ]" title="Paste this on your site">
              <code className="mt-3 block whitespace-pre-wrap break-all rounded-lg border border-stone-200 bg-stone-50 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-stone-700">
                {snippet}
              </code>
              <button
                type="button"
                onClick={copy}
                className="mt-3 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
              >
                {copied ? "Copied ✓" : "Copy the line"}
              </button>
              <div className="mt-5 flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlatform(p.key)}
                    className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                      platform === p.key
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-stone-300 bg-white text-stone-600 hover:border-stone-400"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13.5px] text-stone-600">
                {chosen.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </Block>

            <Block label="[ step 2 — watch it connect ]" title="We'll see it the moment it's live">
              {installed ? (
                <p className="mt-2 flex items-center gap-2 text-[14.5px] text-stone-700">
                  <span className="h-2.5 w-2.5 flex-none rounded-full bg-emerald-600" />
                  <span>
                    <strong>We can see {site.domain}.</strong> The engine takes it from here — first
                    insights need about a week of real visits.
                  </span>
                </p>
              ) : (
                <p className="mt-2 flex items-center gap-2 text-[14.5px] text-stone-600">
                  <span className="h-2.5 w-2.5 flex-none animate-pulse rounded-full bg-amber-500" />
                  <span>
                    Waiting for the first visit from {site.domain}… paste the line, then open your
                    site in another tab. This updates by itself.
                  </span>
                </p>
              )}
            </Block>

            <Block label="[ step 3 — visitor measurement ]" title="Turn on measurement">
              {attested ? (
                <p className="mt-2 text-[14.5px] text-stone-700">
                  <strong className="text-emerald-700">On.</strong> Angel uses a persistent visitor
                  id and conversion events on this site to measure lift. Visitors who signal GPC or
                  Do Not Track are always excluded.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[14.5px] text-stone-600">
                    Paused — Angel adapts the page but stores no visitor id and records no events,
                    so lift isn&apos;t measured on this site. You acknowledged the
                    visitor-information terms at signup; this switch turns measurement on for{" "}
                    {site.domain}.
                  </p>
                  <button
                    type="button"
                    onClick={attest}
                    className="mt-3 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
                  >
                    Turn on visitor measurement
                  </button>
                  {attestFailed && (
                    <p role="alert" className="mt-2 text-[13px] font-medium text-rose-600">
                      That didn&apos;t save — measurement is still paused. Try again.
                    </p>
                  )}
                </>
              )}
            </Block>

            <div className="mt-8 text-center">
              <Link
                to="/dashboard"
                className="text-[14px] font-semibold text-emerald-700 hover:underline"
              >
                Open your dashboard →
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Block({
  label,
  title,
  children,
}: {
  label?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      {label && (
        <div className="mb-1 font-mono text-[10.5px] tracking-wider text-stone-400">{label}</div>
      )}
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      {children}
    </div>
  );
}
