import { useMemo, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StreamEvent } from "./hooks/useTestStream";
import {
  buildPageReports,
  type Finding,
  type FindingCategory,
  type PageReport,
} from "./findings";

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  seo: "SEO Analysis",
  cro: "Conversion (CRO)",
  ux: "UX & Structure",
  interaction: "Interactions",
};

const CATEGORY_ORDER: FindingCategory[] = ["seo", "cro", "ux", "interaction"];

const ACCENT = "#3b82f6";

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

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

// ---------------------------------------------------------------------------
// Heuristics for classifying a finding into a card variant.
// All purely presentational — finding data itself is unchanged.
// ---------------------------------------------------------------------------

type Kind = "status" | "metric" | "quote" | "stats" | "text";

interface Parsed {
  kind: Kind;
  value: string;
  meta?: string; // small mono chip, e.g. "56 chars" or "908 urls"
}

const STATUS_RE = /^(found|not found|set|not set|none|present|absent|missing)$/i;
const TRAILING_META_RE = /^(.+?)\s*\((\d[^()]*?)\)\s*$/;

function parseFinding(f: Finding): Parsed {
  const raw = (f.detail ?? "").trim();
  if (!raw) return { kind: "text", value: "" };

  // Extract trailing "(NN unit)" as a meta chip when the prefix is meaningful.
  let value = raw;
  let meta: string | undefined;
  const m = raw.match(TRAILING_META_RE);
  if (m && m[1].trim().length > 0) {
    value = m[1].trim();
    meta = m[2].trim();
  }

  if (STATUS_RE.test(value)) return { kind: "status", value, meta };
  if (value.startsWith('"')) return { kind: "quote", value, meta };
  if (value.includes(" · ")) return { kind: "stats", value: raw, meta: undefined };
  if (/^-?\d+(\.\d+)?$/.test(value)) return { kind: "metric", value, meta };
  return { kind: "text", value, meta };
}

// ---------------------------------------------------------------------------
// Variant components
// ---------------------------------------------------------------------------

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </label>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 font-mono text-[10px]"
      style={{ color: ACCENT, backgroundColor: `${ACCENT}0d` }}
    >
      {children}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  const positive = /^(found|set|present)$/i.test(value);
  const negative = /^(not found|not set|none|absent|missing)$/i.test(value);
  const tone = positive
    ? "bg-emerald-100 text-emerald-700"
    : negative
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-600";
  return (
    <div className={cn("inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", tone)}>
      {value}
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const { kind, value, meta } = parseFinding(f);
  const wide = kind === "quote" || kind === "stats";

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/30 p-4 transition-colors hover:border-primary/40",
        wide && "col-span-2",
      )}
    >
      <CardLabel>{f.label}</CardLabel>

      {kind === "status" && (
        <div className="flex items-center gap-2">
          <StatusBadge value={value} />
          {meta && <span className="text-[10px] font-medium italic text-muted-foreground">{meta}</span>}
        </div>
      )}

      {kind === "metric" && (
        <div className="flex items-baseline gap-1">
          <span className="font-heading text-xl font-bold text-foreground">{value}</span>
          {meta && <span className="text-[10px] font-medium text-muted-foreground">{meta}</span>}
        </div>
      )}

      {kind === "quote" && (
        <div className="flex items-start gap-3">
          <div
            className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: ACCENT }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm italic leading-relaxed text-foreground/80">{value}</p>
            {meta && <div className="mt-2"><MetaChip>{meta}</MetaChip></div>}
          </div>
        </div>
      )}

      {kind === "stats" && <StatsRow value={value} />}

      {kind === "text" && (
        <>
          <p className="text-sm font-medium leading-snug text-foreground">{value || "—"}</p>
          {meta && <div className="mt-2"><MetaChip>{meta}</MetaChip></div>}
        </>
      )}
    </div>
  );
}

function StatsRow({ value }: { value: string }) {
  const parts = value.split(" · ").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {parts.map((p, i) => (
        <span
          key={i}
          className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground/80"
        >
          {p}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category + Page card
// ---------------------------------------------------------------------------

function CategorySection({
  category,
  findings,
}: {
  category: FindingCategory;
  findings: Finding[];
}) {
  const [open, setOpen] = useState(true);
  if (findings.length === 0) return null;
  return (
    <section>
      <button
        onClick={() => setOpen((o) => !o)}
        className="group mb-4 flex w-full items-center gap-3"
        type="button"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90",
          )}
        />
        <h2 className="font-heading text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground group-hover:text-foreground">
          {CATEGORY_LABELS[category]}
        </h2>
        <div className="h-px flex-1 bg-border" />
        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          {findings.length}
        </span>
      </button>

      {open && (
        <div className="grid grid-cols-2 gap-3">
          {findings.map((f, i) => (
            <FindingCard key={i} f={f} />
          ))}
        </div>
      )}
    </section>
  );
}

function PageCard({ report }: { report: PageReport }) {
  const grouped = useMemo(() => {
    const g: Partial<Record<FindingCategory, Finding[]>> = {};
    for (const f of report.findings) {
      (g[f.category] ??= []).push(f);
    }
    return g;
  }, [report.findings]);

  const hasRaw = Boolean(report.rawPageAudit || report.rawCollect);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate font-heading text-sm font-bold tracking-tight text-foreground">
            {hostnameOf(report.url)}
          </h1>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-xs text-muted-foreground">
              {report.findings.length} datapoints analyzed
            </p>
          </div>
        </div>
        {hasRaw && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-3 text-xs font-semibold"
            onClick={() => {
              let collectForExport: unknown = report.rawCollect;
              if (report.rawCollect && typeof report.rawCollect === "object") {
                const { screenshot: _s, overlayElements: _o, ...rest } =
                  report.rawCollect as Record<string, unknown>;
                void _s; void _o;
                collectForExport = rest;
              }
              downloadJson(`page-${Date.now()}.json`, {
                url: report.url,
                pageAudit: report.rawPageAudit,
                collect: collectForExport,
              });
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Download JSON
          </Button>
        )}
      </header>

      <div className="space-y-8 p-5">
        {CATEGORY_ORDER.map((cat) => (
          <CategorySection key={cat} category={cat} findings={grouped[cat] ?? []} />
        ))}
        {report.findings.length === 0 && (
          <div className="text-xs text-muted-foreground">Waiting for data…</div>
        )}
      </div>
    </div>
  );
}

export function FindingsView({ events }: { events: StreamEvent[] }) {
  const reports = useMemo(() => buildPageReports(events), [events]);

  if (reports.length === 0) {
    return (
      <div className="flex min-h-full items-center justify-center px-4 py-3 text-xs text-muted-foreground">
        <p className="text-center">
          No pages analyzed yet. Data appears once the first{" "}
          <span className="font-medium text-foreground">goto</span> runs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {reports.map((r, i) => (
        <PageCard key={i} report={r} />
      ))}
    </div>
  );
}
