import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FindingsView } from "./FindingsView";
import { PageInsightsView } from "./PageInsightsView";
import type { StreamEvent } from "./hooks/useTestStream";
import type {
  CollectData,
  ElementCategory,
  PageAuditData,
  SectionKind,
} from "@/lib/tests/schema";

function fmtTime(ts: unknown) {
  const n = typeof ts === "number" ? ts : Date.now();
  const d = new Date(n);
  return d.toLocaleTimeString([], { hour12: false });
}

function isCollectData(v: unknown): v is CollectData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.target === "string" && typeof o.count === "number" && Array.isArray(o.elements);
}

function isPageAuditData(v: unknown): v is PageAuditData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.url === "string" && !!o.head && !!o.headings && Array.isArray(o.flags);
}

const CATEGORY_COLORS: Record<ElementCategory, string> = {
  cta_primary: "#10b981",
  cta_secondary: "#22d3ee",
  form_submit: "#f59e0b",
  icon_button: "#a78bfa",
  nav_item: "#64748b",
  link: "#60a5fa",
  other: "#f472b6",
};

const CATEGORY_LABELS: Record<ElementCategory, string> = {
  cta_primary: "CTA primary",
  cta_secondary: "CTA secondary",
  form_submit: "Form submit",
  icon_button: "Icon",
  nav_item: "Nav",
  link: "Link",
  other: "Other",
};

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

function renderEventLine(ev: StreamEvent): string {
  switch (ev.type) {
    case "session_started":
      return `session started · ${String(ev.data.sessionId ?? "")}`;
    case "log":
      return `[${String(ev.data.level ?? "info")}] ${String(ev.data.message ?? "")}`;
    case "step_started":
      return `→ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")}`;
    case "step_passed": {
      const base = `✓ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")} (${String(ev.data.durationMs ?? "?")}ms)`;
      if (ev.data.kind === "collect" && isCollectData(ev.data.data)) {
        return `${base} · ${ev.data.data.count} ${ev.data.data.target}`;
      }
      return base;
    }
    case "step_failed":
      return `✗ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")} — ${String(ev.data.error ?? "")}`;
    case "done": {
      const p = ev.data.passed, f = ev.data.failed;
      const counts = (typeof p === "number" || typeof f === "number") ? ` · ${p ?? 0} passed, ${f ?? 0} failed` : "";
      return ev.data.aborted
        ? `done · aborted (${String(ev.data.reason ?? "")})${counts}`
        : `done${counts}`;
    }
    case "error":
      return `error · ${String(ev.data.message ?? "")}`;
    default:
      return `${ev.type} · ${JSON.stringify(ev.data)}`;
  }
}

function CollectDetails({ data }: { data: CollectData }) {
  const preview = data.elements.slice(0, 5);
  return (
    <div className="mt-2 space-y-2 rounded border border-border bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {data.count} {data.target} (showing first {preview.length})
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={() => downloadJson(`${data.target}-${Date.now()}.json`, data.elements)}
        >
          Download JSON
        </Button>
      </div>
      {data.byCategory && Object.keys(data.byCategory).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(Object.entries(data.byCategory) as Array<[ElementCategory, number]>)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, n]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: CATEGORY_COLORS[cat] }}
                />
                {CATEGORY_LABELS[cat]} · {n}
              </span>
            ))}
        </div>
      )}
      {data.summary && (
        <div className="flex flex-wrap gap-1">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground">
            ↑ {data.summary.aboveFold} above fold
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground">
            ★ {data.summary.primaryCtaCount} primary CTA
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground">
            ⚔ Competing above fold: {data.summary.competingAboveFold}
          </span>
        </div>
      )}
      {data.summary?.bySection && Object.keys(data.summary.bySection).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(Object.entries(data.summary.bySection) as Array<[SectionKind, number]>)
            .sort((a, b) => b[1] - a[1])
            .map(([sec, n]) => (
              <span key={sec} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-foreground">
                ▦ {sec} · {n}
              </span>
            ))}
        </div>
      )}
      {data.summary?.groups && data.summary.groups.length > 0 && (
        <div className="rounded border border-border bg-background/50 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Repeated controls (collapsed from aggregates)
          </div>
          <ul className="space-y-0.5">
            {data.summary.groups.slice(0, 6).map((g, i) => (
              <li key={i} className="flex items-center gap-2 truncate text-[11px]">
                <span className="inline-flex h-4 min-w-7 shrink-0 items-center justify-center rounded bg-foreground/10 px-1 text-[9px] font-bold text-foreground">
                  ×{g.count}
                </span>
                <span className="truncate text-foreground">{g.label}</span>
                <span className="shrink-0 text-muted-foreground">— {g.section} · {g.intent}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.summary && data.summary.topVisualWeight.length > 0 && (
        <div className="rounded border border-border bg-background/50 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Top visual weight</div>
          <ul className="space-y-0.5">
            {data.summary.topVisualWeight.slice(0, 3).map((el, i) => (
              <li key={i} className="flex items-center gap-2 truncate text-[11px]">
                <span className="inline-flex h-4 w-7 shrink-0 items-center justify-center rounded bg-foreground/10 text-[9px] font-bold text-foreground">
                  {el.score}
                </span>
                <span className="truncate text-foreground">
                  {el.text || <em className="text-muted-foreground">(no text)</em>}
                </span>
                <span className="truncate text-muted-foreground">— {el.selector}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.length > 0 && (
        <ul className="space-y-1">
          {preview.map((el, i) => {
            const bg = el.computedStyles?.backgroundColor;
            const fg = el.computedStyles?.color;
            const catColor = el.category ? CATEGORY_COLORS[el.category] : undefined;
            return (
              <li key={i} className="flex items-center gap-2 truncate">
                <span
                  className="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                  style={{ background: catColor ?? "#0891b2" }}
                >
                  {i + 1}
                </span>
                {(bg || fg) && (
                  <span
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border text-[9px] font-bold"
                    style={{ background: bg, color: fg }}
                    title={`bg ${bg} · fg ${fg}`}
                  >
                    A
                  </span>
                )}
                <span className="truncate text-foreground">
                  {el.text || <em className="text-muted-foreground">(no text)</em>}
                </span>
                <span className="truncate text-muted-foreground">— {el.selector}</span>
                {!el.visible && <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">hidden</span>}
                {el.visible && !el.aboveFold && <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">below</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PageAuditDetails({ data }: { data: PageAuditData }) {
  const { head, headings, images, links, schema, content, robotsTxt, sitemap } = data;
  return (
    <div className="mt-2 space-y-2 rounded border border-border bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-muted-foreground">Page audit · {data.url}</span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={() => downloadJson(`page-audit-${Date.now()}.json`, data)}
        >
          Download JSON
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-border bg-background/50 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Head</div>
          <ul className="space-y-0.5">
            <li><span className="text-muted-foreground">title:</span> {head.title || <em className="text-muted-foreground">—</em>}</li>
            <li className="truncate"><span className="text-muted-foreground">desc:</span> {head.description || <em className="text-muted-foreground">—</em>}</li>
            <li><span className="text-muted-foreground">canonical:</span> {head.canonical || <em className="text-muted-foreground">—</em>}</li>
            <li><span className="text-muted-foreground">lang:</span> {head.lang || <em className="text-muted-foreground">—</em>}</li>
            <li><span className="text-muted-foreground">og:image:</span> {head.ogImage ? "✓" : "—"}</li>
            <li><span className="text-muted-foreground">twitter:</span> {head.twitterCard || "—"}</li>
          </ul>
        </div>
        <div className="rounded border border-border bg-background/50 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Structure</div>
          <ul className="space-y-0.5">
            <li>h1: {headings.h1Count} · h2: {headings.h2Count} · h3: {headings.h3Count}</li>
            <li>words: {content.wordCount} · sections: {content.sections}</li>
            <li>images: {images.total} (missing alt: {images.missingAlt}, {images.missingAltPct}%)</li>
            <li>links: {links.total} (int {links.internal} / ext {links.external})</li>
            <li>schema: {schema.count}{schema.types.length > 0 ? ` (${schema.types.join(", ")})` : ""}</li>
            <li>robots.txt: {robotsTxt.exists ? "✓" : "—"} · sitemap: {sitemap.exists ? `✓ (${sitemap.urlCount})` : "—"}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function ConsolePanel({ events, url, psiRunKey = 0 }: { events: StreamEvent[]; url: string; psiRunKey?: number }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col border-t border-border bg-background lg:border-t-0">
      <Tabs defaultValue="findings" className="flex h-full min-h-0 w-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="text-base font-semibold text-foreground">Console</h2>
          <TabsList className="h-8">
            <TabsTrigger value="findings" className="text-xs">Findings</TabsTrigger>
            <TabsTrigger value="pageinsight" className="text-xs">PageInsight</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="findings" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <FindingsView events={events} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="pageinsight" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <PageInsightsView url={url} runKey={psiRunKey} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="activity" className="m-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="divide-y divide-border font-mono text-xs">
              {events.length === 0 ? (
                <div className="px-4 py-2 text-muted-foreground">
                  No run yet. Click <span className="font-medium text-foreground">Run tests</span> to start a Browserbase session.
                </div>
              ) : (
                events.map((ev, i) => {
                  const isCollectPassed =
                    ev.type === "step_passed" && ev.data.kind === "collect" && isCollectData(ev.data.data);
                  const isPageAuditPassed =
                    ev.type === "step_passed" && ev.data.kind === "pageAudit" && isPageAuditData(ev.data.data);
                  return (
                    <div key={i} className="flex items-start gap-4 px-4 py-2">
                      <div className="flex-1 min-w-0">
                        <span
                          className={
                            "whitespace-pre-wrap break-all " +
                            (ev.type === "error" || ev.type === "step_failed"
                              ? "text-destructive"
                              : "text-foreground")
                          }
                        >
                          {renderEventLine(ev)}
                        </span>
                        {isCollectPassed && <CollectDetails data={ev.data.data as CollectData} />}
                        {isPageAuditPassed && <PageAuditDetails data={ev.data.data as PageAuditData} />}
                      </div>
                      <span className="shrink-0 text-muted-foreground">{fmtTime(ev.data.ts)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
