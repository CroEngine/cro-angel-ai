// /sandbox — the admin sandbox: paste any URL, see the page FÖRE/EFTER with
// Angel applied. Nothing is installed on the real site — the mirror is a
// private, token-gated copy — and sandbox slugs run anonymous mode, so a
// preview can never write events into measurement. The mirror iframes are
// opaque-origin (sandbox="allow-scripts", and the mirror response itself
// carries CSP `sandbox allow-scripts`), so mirrored-site scripts can't touch
// the admin's session.

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createSandboxPreview,
  type SandboxPreview,
} from "@/lib/dashboard/sandbox.functions";

export const Route = createFileRoute("/sandbox")({
  head: () => ({
    meta: [
      { title: "Angel Adaptive — Sandbox" },
      { name: "robots", content: "noindex" },
    ],
  }),
  // Client-only UX gate like /dashboard; the real gate is the admin check in
  // createSandboxPreview (server-side) — non-admins get a friendly refusal.
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: SandboxPage,
});

/** Swedish one-liners for the applied-pattern chips; raw id as fallback. */
const PATTERN_LABEL: Record<string, string> = {
  emphasize_goal: "målknappen framhävd",
  sticky_goal_cta: "sticky målknapp (mobil)",
  show_secondary_cta: "mjuk sekundär väg",
  clarify_cta: "CTA-text förtydligad",
  shorten_hero: "hero komprimerad",
  move_faq_up: "FAQ flyttad upp",
  surface_pricing: "priser lyfta",
  continue_where_left_off: "fortsätt där du var",
};

const REASON_TEXT: Record<string, string> = {
  admin: "Sandboxen är bara tillgänglig för admin-konton.",
  invalid_url: "Det där ser inte ut som en giltig adress.",
  protocol: "Bara http(s)-adresser kan förhandsgranskas.",
  ip_literal: "IP-adresser kan inte förhandsgranskas — ange ett domännamn.",
  host: "Den här adressen kan inte förhandsgranskas.",
  credentials: "Adresser med inbäddade inloggningsuppgifter stöds inte.",
  unavailable: "Sandboxen är inte konfigurerad i den här miljön.",
};

function MirrorFrame({
  src,
  frameW,
  label,
  iframeRef,
}: {
  src: string;
  frameW: number;
  label: string;
  iframeRef?: React.Ref<HTMLIFrameElement>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / frameW));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [frameW]);

  const wrapH = Math.round(
    typeof window !== "undefined" ? Math.min(640, window.innerHeight * 0.66) : 520,
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-wider text-stone-400">{label}</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] tracking-wider text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:decoration-emerald-700"
        >
          öppna i ny flik ↗
        </a>
      </div>
      <div
        ref={wrapRef}
        className="overflow-hidden rounded-md border border-stone-200 bg-white"
        style={{ height: wrapH }}
      >
        <iframe
          ref={iframeRef}
          src={src}
          title={label}
          sandbox="allow-scripts"
          style={{
            width: frameW,
            height: Math.round(wrapH / scale),
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: "0",
          }}
        />
      </div>
    </div>
  );
}

function SandboxPage() {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<SandboxPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"mobile" | "desktop">("desktop");
  const [markera, setMarkera] = useState(true);
  const [applied, setApplied] = useState<string[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const autoReloaded = useRef(false);
  const afterFrameRef = useRef<HTMLIFrameElement>(null);

  const frameW = device === "mobile" ? 375 : 1440;

  // The opaque mirror iframe reports what Angel applied via postMessage. The
  // mirrored page runs untrusted scripts, so only trust a message that actually
  // came from OUR EFTER iframe's window (its origin is "null" — opaque — so a
  // source-window check, not an origin check, is the meaningful guard). Worst
  // case without it is cosmetic (React-escaped chip labels), but this closes it.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== afterFrameRef.current?.contentWindow) return;
      const d = e.data as { type?: string; applied?: unknown } | null;
      if (!d || d.type !== "angel-sandbox") return;
      const list = Array.isArray(d.applied)
        ? d.applied.filter((p): p is string => typeof p === "string").slice(0, 12)
        : [];
      setApplied(list);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // First visit to a brand-new site: the harvest lands a few seconds after the
  // page loads, so nothing applies yet. Reload the EFTER frame once, automatically.
  useEffect(() => {
    if (applied === null || applied.length > 0 || autoReloaded.current) return;
    autoReloaded.current = true;
    const t = setTimeout(() => {
      setApplied(null);
      setReloadKey((k) => k + 1);
    }, 7000);
    return () => clearTimeout(t);
  }, [applied]);

  const run = async () => {
    if (!url.trim() || loading) return;
    setLoading(true);
    setApplied(null);
    autoReloaded.current = false;
    try {
      const res = await createSandboxPreview({ data: { url } });
      setPreview(res);
      setReloadKey((k) => k + 1);
    } catch {
      setPreview({ ok: false, reason: "unavailable" });
    } finally {
      setLoading(false);
    }
  };

  const afterSrc = preview?.mirrorPath
    ? `${preview.mirrorPath}${markera ? "&angel_debug=1" : ""}&r=${reloadKey}`
    : null;

  return (
    <div className="min-h-screen bg-[#fafaf9] px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <span className="text-2xl leading-none text-emerald-700">✳</span> Angel sandbox
            </h1>
            <p className="mt-1 font-mono text-[11px] tracking-wider text-stone-400">
              [ testa Angel på vilken sajt som helst — privat spegel, inget installeras,
              ingen mätdata skapas ]
            </p>
          </div>
          <Link
            to="/dashboard"
            className="font-mono text-[11px] tracking-wider text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:decoration-emerald-700"
          >
            ← dashboard
          </Link>
        </header>

        <Card className="border-stone-200 shadow-none">
          <CardContent className="space-y-4 pt-6">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run();
              }}
            >
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://kundens-sajt.se"
                className="max-w-md"
                autoFocus
              />
              <Button type="submit" disabled={loading || !url.trim()}>
                {loading ? "Speglar…" : "Förhandsgranska"}
              </Button>
              <div className="ml-auto flex items-center gap-1">
                {(["mobile", "desktop"] as const).map((dv) => (
                  <button
                    key={dv}
                    type="button"
                    onClick={() => setDevice(dv)}
                    className={`px-2.5 py-1 font-mono text-[11px] tracking-wider transition ${
                      device === dv
                        ? "bg-stone-900 text-white"
                        : "text-stone-500 hover:text-stone-900"
                    }`}
                  >
                    [ {dv === "mobile" ? "mobil" : "desktop"} ]
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setMarkera((v) => !v)}
                  className={`px-2.5 py-1 font-mono text-[11px] tracking-wider transition ${
                    markera ? "bg-emerald-700 text-white" : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  [ markera ändringar ]
                </button>
              </div>
            </form>

            {preview && !preview.ok && (
              <p className="font-mono text-[11px] tracking-wider text-amber-600">
                {REASON_TEXT[preview.reason ?? ""] ?? "Kunde inte förhandsgranska adressen."}
              </p>
            )}

            {preview?.ok && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] tracking-wider text-stone-400">
                    {preview.site} ·
                  </span>
                  {applied === null ? (
                    <span className="font-mono text-[11px] tracking-wider text-stone-400 animate-pulse">
                      väntar på beslut…
                    </span>
                  ) : applied.length === 0 ? (
                    <span className="font-mono text-[11px] tracking-wider text-stone-400">
                      inga ändringar ännu — första besöket lär sig sidan, laddar om strax…
                    </span>
                  ) : (
                    applied.map((p) => (
                      <span
                        key={p}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-[11px] tracking-wider text-emerald-700"
                      >
                        {PATTERN_LABEL[p] ?? p}
                      </span>
                    ))
                  )}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <MirrorFrame
                    src={`${preview.mirrorOffPath}&r=${reloadKey}`}
                    frameW={frameW}
                    label="[ FÖRE — sidan orörd ]"
                  />
                  {afterSrc && (
                    <MirrorFrame
                      key={`after-${reloadKey}-${markera}`}
                      src={afterSrc}
                      frameW={frameW}
                      label="[ EFTER — med Angel ]"
                      iframeRef={afterFrameRef}
                    />
                  )}
                </div>
                <p className="font-mono text-[10px] tracking-wide text-stone-400">
                  SPEGELN ÄR PRIVAT OCH KÖR ANONYMT LÄGE — INGA HÄNDELSER SKRIVS, SÅ STATISTIKEN
                  FÅR ALDRIG BRUS FRÅN SANDBOXEN. SAJTER MED TUNGA APPAR KAN RENDERA DELVIS.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
