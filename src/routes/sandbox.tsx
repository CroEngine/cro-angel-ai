// /sandbox — the admin sandbox: paste any URL, see the page FÖRE/EFTER with
// Agritm applied. Nothing is installed on the real site — the mirror is a
// private, token-gated copy — and sandbox slugs run anonymous mode, so a
// preview can never write events into measurement. The mirror iframes are
// opaque-origin (sandbox="allow-scripts", and the mirror response itself
// carries CSP `sandbox allow-scripts`), so mirrored-site scripts can't touch
// the admin's session.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { AppNav } from "@/components/app-nav";
import { MirrorFrame } from "@/components/mirror-frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createSandboxPreview, type SandboxPreview } from "@/lib/dashboard/sandbox.functions";

export const Route = createFileRoute("/sandbox")({
  head: () => ({
    meta: [{ title: "Agritm Adaptive — Sandbox" }, { name: "robots", content: "noindex" }],
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

/** One-liners for the applied-pattern chips; raw id as fallback. */
const PATTERN_LABEL: Record<string, string> = {
  emphasize_goal: "goal button emphasized",
  sticky_goal_cta: "sticky goal button (mobile)",
  show_secondary_cta: "softer secondary path",
  clarify_cta: "CTA text clarified",
  shorten_hero: "hero tightened",
  move_faq_up: "FAQ moved up",
  surface_pricing: "pricing surfaced",
  continue_where_left_off: "continue where you left off",
  show_customer_logos_early: "customer logos early",
  show_enterprise_testimonial: "testimonial surfaced",
  show_trust_badge: "trust signal visible",
  show_guarantee: "guarantee visible",
  show_case_study: "case study surfaced",
  show_no_credit_card: '"no credit card" badge',
  show_2min_setup: '"set up in minutes" badge',
  // Våg 8 — vertikala mönster (docs/wave8-pattern-spec.md):
  move_reviews_up: "reviews moved up",
  show_rating_near_goal: "site rating near the goal",
  show_payment_security: "payment security near the goal",
  show_monthly_giving_option: "monthly-giving path beside the gift",
  show_callback_option: "callback path near the goal",
  show_cancel_anytime: '"cancel anytime" badge',
};

const REASON_TEXT: Record<string, string> = {
  admin: "The sandbox is only available to admin accounts.",
  invalid_url: "That doesn't look like a valid address.",
  protocol: "Only http(s) addresses can be previewed.",
  ip_literal: "IP addresses can't be previewed — enter a domain name.",
  host: "This address can't be previewed.",
  credentials: "Addresses with embedded credentials aren't supported.",
  unavailable: "The sandbox isn't configured in this environment.",
};

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

  // The opaque mirror iframe reports what Agritm applied via postMessage. The
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
    <div className="min-h-screen bg-[#fafaf9] text-stone-900">
      <AppNav active="/sandbox" isAdmin />
      <main className="mx-auto max-w-6xl space-y-6 px-6 pb-16 pt-7">
        <header>
          <h1 className="font-heading text-[23px] font-bold tracking-tight">Sandbox</h1>
          <p className="mt-2 max-w-[640px] text-sm text-stone-500">
            Test Agritm on any site — a private mirror. Nothing is installed and no measurement data
            is created.
          </p>
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
                placeholder="https://your-customers-site.com"
                className="max-w-md"
                autoFocus
              />
              <Button type="submit" disabled={loading || !url.trim()}>
                {loading ? "Mirroring…" : "Preview"}
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
                  [ highlight changes ]
                </button>
              </div>
            </form>

            {preview && !preview.ok && (
              <p className="font-mono text-[11px] tracking-wider text-amber-600">
                {REASON_TEXT[preview.reason ?? ""] ?? "Couldn't preview the address."}
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
                      waiting for the decision…
                    </span>
                  ) : applied.length === 0 ? (
                    <span className="font-mono text-[11px] tracking-wider text-stone-400">
                      no changes yet — the first visit learns the page, reloading shortly…
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
                    label="[ BEFORE — untouched ]"
                  />
                  {afterSrc && (
                    <MirrorFrame
                      key={`after-${reloadKey}-${markera}`}
                      src={afterSrc}
                      frameW={frameW}
                      label="[ AFTER — with Agritm ]"
                      iframeRef={afterFrameRef}
                    />
                  )}
                </div>
                <p className="font-mono text-[10px] tracking-wide text-stone-400">
                  THE MIRROR IS PRIVATE AND RUNS ANONYMOUS MODE — NO EVENTS ARE WRITTEN, SO YOUR
                  STATS NEVER GET NOISE FROM THE SANDBOX. HEAVY APP SITES MAY RENDER PARTIALLY.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
