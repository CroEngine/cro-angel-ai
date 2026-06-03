import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { runPsiMobile, runPsiDesktop } from "@/lib/tests/pagespeed.functions";
import type { PsiStrategyResult } from "@/lib/tests/pagespeed.functions";

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 90) return "text-emerald-500";
  if (score >= 50) return "text-amber-500";
  return "text-red-500";
}

function scoreBg(score: number | null): string {
  if (score === null) return "bg-muted";
  if (score >= 90) return "bg-emerald-500/15 border-emerald-500/30";
  if (score >= 50) return "bg-amber-500/15 border-amber-500/30";
  return "bg-red-500/15 border-red-500/30";
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtCls(v: number | null): string {
  return v === null ? "—" : v.toFixed(3);
}

function ScoreCard({ label, score }: { label: string; score: number | null }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border p-3", scoreBg(score))}>
      <div className={cn("text-2xl font-bold tabular-nums", scoreColor(score))}>
        {score === null ? "—" : score}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function StrategyPanel({ result }: { result: PsiStrategyResult }) {
  if (result.error) {
    const raw = result.error;
    const retried = raw.startsWith("[retried] ");
    const msg = raw.replace(/^\[retried\] /, "");
    const isTimeout = /AbortError|aborted/i.test(msg);
    const isFailedDoc = /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP/.test(msg);
    const friendly = isTimeout
      ? `Lighthouse hann inte ladda sidan inom 25s${retried ? " (även efter ett omförsök)" : ""}. Sidan är troligen för långsam — testa den andra fliken eller kör om.`
      : isFailedDoc
        ? `Lighthouse kunde inte ladda sidan på ${result.strategy}${retried ? " (även efter ett omförsök)" : ""}. Sidan svarar för långsamt — testa den andra fliken eller kör om.`
        : msg;
    return (
      <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
        <div className="font-medium text-amber-700 dark:text-amber-400">
          PSI misslyckades för {result.strategy}
        </div>
        <div className="text-foreground/80">{friendly}</div>
        {friendly !== msg && (
          <details className="text-[10px] text-muted-foreground">
            <summary className="cursor-pointer">Visa rått fel</summary>
            <pre className="mt-1 whitespace-pre-wrap break-all">{msg}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <ScoreCard label="Performance" score={result.scores.performance} />
        <ScoreCard label="Accessibility" score={result.scores.accessibility} />
        <ScoreCard label="Best Practices" score={result.scores.bestPractices} />
        <ScoreCard label="SEO" score={result.scores.seo} />
      </div>

      <div className="rounded border border-border bg-muted/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Core Web Vitals (Lab)</div>
          {result.vitals.hasFieldData && (
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-medium">
              + CrUX field data
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-border bg-background/50 p-2">
            <div className="text-[10px] text-muted-foreground">LCP</div>
            <div className="font-mono tabular-nums">{fmtMs(result.vitals.lcpMs)}</div>
            {result.vitals.fieldLcpMs !== null && (
              <div className="text-[10px] text-muted-foreground">field: {fmtMs(result.vitals.fieldLcpMs)}</div>
            )}
          </div>
          <div className="rounded border border-border bg-background/50 p-2">
            <div className="text-[10px] text-muted-foreground">FCP</div>
            <div className="font-mono tabular-nums">{fmtMs(result.vitals.fcpMs)}</div>
            {result.vitals.fieldFcpMs !== null && (
              <div className="text-[10px] text-muted-foreground">field: {fmtMs(result.vitals.fieldFcpMs)}</div>
            )}
          </div>
          <div className="rounded border border-border bg-background/50 p-2">
            <div className="text-[10px] text-muted-foreground">CLS</div>
            <div className="font-mono tabular-nums">{fmtCls(result.vitals.cls)}</div>
            {result.vitals.fieldClsP75 !== null && (
              <div className="text-[10px] text-muted-foreground">field p75: {fmtCls(result.vitals.fieldClsP75)}</div>
            )}
          </div>
          <div className="rounded border border-border bg-background/50 p-2">
            <div className="text-[10px] text-muted-foreground">TBT</div>
            <div className="font-mono tabular-nums">{fmtMs(result.vitals.tbtMs)}</div>
          </div>
          <div className="rounded border border-border bg-background/50 p-2">
            <div className="text-[10px] text-muted-foreground">Speed Index</div>
            <div className="font-mono tabular-nums">{fmtMs(result.vitals.speedIndexMs)}</div>
          </div>
          <div className="rounded border border-border bg-background/50 p-2">
            <div className="text-[10px] text-muted-foreground">TTI</div>
            <div className="font-mono tabular-nums">{fmtMs(result.vitals.ttiMs)}</div>
            {result.vitals.fieldInpMs !== null && (
              <div className="text-[10px] text-muted-foreground">field INP: {fmtMs(result.vitals.fieldInpMs)}</div>
            )}
          </div>
        </div>
      </div>

      {result.audits.opportunities.length > 0 && (
        <div className="rounded border border-border bg-muted/30 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Opportunities (potential savings)
          </div>
          <ul className="space-y-1">
            {result.audits.opportunities.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-xs">
                <span className="inline-flex h-5 min-w-12 shrink-0 items-center justify-center rounded bg-amber-500/20 px-1 text-[10px] font-bold tabular-nums text-amber-600">
                  -{fmtMs(o.savingsMs)}
                </span>
                <span className="flex-1 truncate text-foreground">{o.title}</span>
                {o.displayValue && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{o.displayValue}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.audits.diagnostics.length > 0 && (
        <div className="rounded border border-border bg-muted/30 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">Diagnostics</div>
          <ul className="space-y-1">
            {result.audits.diagnostics.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-xs">
                <span className="flex-1 truncate text-foreground">{d.title}</span>
                {d.displayValue && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{d.displayValue}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(() => {
        const rs = result.resourceSummary;
        const parts: Array<[string, number | null]> = [
          ["JS", rs.scriptKib], ["CSS", rs.stylesheetKib], ["IMG", rs.imageKib],
          ["Font", rs.fontKib], ["Doc", rs.documentKib], ["Media", rs.mediaKib],
          ["3rd-party", rs.thirdPartyKib], ["Other", rs.otherKib],
        ];
        const shown = parts.filter(([, v]) => v !== null && v > 0);
        if (shown.length === 0 && rs.totalKib === null) return null;
        return (
          <div className="rounded border border-border bg-muted/30 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              Resource breakdown
              {rs.totalKib !== null && (
                <span className="ml-2 font-mono normal-case tracking-normal text-foreground">
                  {rs.totalKib.toLocaleString()} KiB
                  {rs.totalRequests !== null && ` · ${rs.totalRequests} requests`}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {shown.map(([label, kib]) => (
                <span key={label} className="rounded border border-border bg-background/50 px-2 py-0.5 font-mono tabular-nums">
                  <span className="text-muted-foreground">{label}</span>{" "}
                  <span className="text-foreground">{kib!.toLocaleString()} KiB</span>
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {result.renderBlockingResources.length > 0 && (
        <div className="rounded border border-border bg-muted/30 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Render-blocking resources
          </div>
          <ul className="space-y-1">
            {result.renderBlockingResources.map((r) => {
              const filename = (() => {
                try { return new URL(r.url).pathname.split("/").pop() || r.url; }
                catch { return r.url; }
              })();
              return (
                <li key={r.url} className="flex items-center gap-2 text-xs">
                  <span className="inline-flex h-5 min-w-12 shrink-0 items-center justify-center rounded bg-red-500/20 px-1 text-[10px] font-bold tabular-nums text-red-600">
                    -{Math.round(r.wastedMs)}ms
                  </span>
                  <span className="flex-1 truncate font-mono text-[11px] text-foreground" title={r.url}>
                    {filename}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {Math.round(r.totalBytes / 1024)} KiB
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PageInsightsView({ url, runKey = 0 }: { url: string; runKey?: number }) {
  const psiMobile = useServerFn(runPsiMobile);
  const psiDesktop = useServerFn(runPsiDesktop);
  const [mobile, setMobile] = useState<PsiStrategyResult | null>(null);
  const [desktop, setDesktop] = useState<PsiStrategyResult | null>(null);
  const [mobileLoading, setMobileLoading] = useState(false);
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [strategy, setStrategy] = useState<"mobile" | "desktop">("mobile");

  const runBoth = () => {
    setMobile(null);
    setDesktop(null);
    setMobileLoading(true);
    setDesktopLoading(true);
    psiMobile({ data: { url } })
      .then((r) => setMobile(r))
      .catch((e) =>
        setMobile({
          strategy: "mobile",
          fetchedAt: new Date().toISOString(),
          scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
          vitals: {
            lcpMs: null, fcpMs: null, tbtMs: null, cls: null, speedIndexMs: null, ttiMs: null,
            fieldLcpMs: null, fieldFcpMs: null, fieldClsP75: null, fieldInpMs: null, hasFieldData: false,
          },
          audits: { opportunities: [], diagnostics: [] },
          resourceSummary: {
            totalKib: null, scriptKib: null, imageKib: null, stylesheetKib: null,
            fontKib: null, documentKib: null, mediaKib: null, otherKib: null,
            thirdPartyKib: null, totalRequests: null,
          },
          renderBlockingResources: [],
          thirdPartyEntities: [],
          thirdPartyBlockingTotalMs: 0,
          thirdPartyAuditMissing: true,
          error: e instanceof Error ? e.message : String(e),
        }),
      )
      .finally(() => setMobileLoading(false));
    psiDesktop({ data: { url } })
      .then((r) => setDesktop(r))
      .catch((e) =>
        setDesktop({
          strategy: "desktop",
          fetchedAt: new Date().toISOString(),
          scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
          vitals: {
            lcpMs: null, fcpMs: null, tbtMs: null, cls: null, speedIndexMs: null, ttiMs: null,
            fieldLcpMs: null, fieldFcpMs: null, fieldClsP75: null, fieldInpMs: null, hasFieldData: false,
          },
          audits: { opportunities: [], diagnostics: [] },
          resourceSummary: {
            totalKib: null, scriptKib: null, imageKib: null, stylesheetKib: null,
            fontKib: null, documentKib: null, mediaKib: null, otherKib: null,
            thirdPartyKib: null, totalRequests: null,
          },
          renderBlockingResources: [],
          thirdPartyEntities: [],
          thirdPartyBlockingTotalMs: 0,
          error: e instanceof Error ? e.message : String(e),
        }),
      )
      .finally(() => setDesktopLoading(false));
  };

  // Auto-trigger when BrowserShell signals a new Run. Skip mount (runKey === 0).
  useEffect(() => {
    if (runKey === 0) return;
    runBoth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, runKey]);

  const loading = mobileLoading || desktopLoading;
  const hasAny = mobile !== null || desktop !== null;
  const active = strategy === "mobile" ? mobile : desktop;
  const activeLoading = strategy === "mobile" ? mobileLoading : desktopLoading;

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Google PageSpeed Insights</div>
          <div className="truncate text-xs text-muted-foreground">{url}</div>
        </div>
        <div className="flex items-center gap-2">
          {hasAny && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => downloadJson(`psi-${Date.now()}.json`, { url, mobile, desktop })}
            >
              Download JSON
            </Button>
          )}
          <Button size="sm" className="h-7 px-3 text-[11px]" disabled={loading} onClick={runBoth}>
            {loading ? "Running…" : hasAny ? "Re-run" : "Run PSI"}
          </Button>
        </div>
      </div>

      {(hasAny || loading) && (
        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {(["mobile", "desktop"] as const).map((s) => {
            const isLoading = s === "mobile" ? mobileLoading : desktopLoading;
            return (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors inline-flex items-center justify-center gap-1.5",
                  strategy === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "mobile" ? "Mobile" : "Desktop"}
                {isLoading && (
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {activeLoading && !active && (
        <div className="rounded border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
          Fetching Lighthouse audit for {strategy}… typically 15–30s.
        </div>
      )}

      {active && <StrategyPanel result={active} />}

      {!hasAny && !loading && (
        <div className="rounded border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
          Klistra in en URL och klicka <span className="font-medium text-foreground">Run</span> — PSI startar
          automatiskt parallellt med Browserbase. Du kan också köra manuellt via{" "}
          <span className="font-medium text-foreground">Run PSI</span>.
        </div>
      )}
    </div>
  );
}
