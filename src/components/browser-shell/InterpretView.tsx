import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  Category,
  InterpretFinding,
  PageInterpretation,
  Severity,
  Win,
} from "./interpret";

const CATEGORY_LABELS: Record<Category, string> = {
  seo: "SEO Analysis",
  cro: "Conversion (CRO)",
  ux: "UX & Structure",
  trust: "Trust",
};

const CATEGORY_ORDER: Category[] = ["seo", "cro", "ux", "trust"];

const SEVERITY_STYLES: Record<Severity, string> = {
  high: "border-red-300 bg-red-50 text-red-700",
  medium: "border-amber-300 bg-amber-50 text-amber-700",
  low: "border-blue-300 bg-blue-50 text-blue-700",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
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

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

function scorePillBg(score: number): string {
  if (score >= 80) return "bg-emerald-50 border-emerald-200 text-emerald-700";
  if (score >= 50) return "bg-amber-50 border-amber-200 text-amber-700";
  return "bg-red-50 border-red-200 text-red-700";
}

interface InterpretViewProps {
  interpretation: PageInterpretation[] | null;
}

export function InterpretView({ interpretation }: InterpretViewProps) {
  if (!interpretation) {
    return (
      <div className="flex min-h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Click <span className="font-medium text-foreground">Analyze</span> to interpret findings.
        </p>
      </div>
    );
  }

  if (interpretation.length === 0) {
    return (
      <div className="flex min-h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">No page audit data available to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {interpretation.map((page) => (
        <PageCard key={page.url} page={page} />
      ))}
    </div>
  );
}

function PageCard({ page }: { page: PageInterpretation }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-heading truncate text-sm font-bold text-foreground">{hostnameOf(page.url)}</h1>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-xs text-muted-foreground">
              {page.findings.length} issue{page.findings.length === 1 ? "" : "s"} · {page.wins.length} passed
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="flex flex-col items-end">
            <span className={cn("font-heading text-2xl font-bold leading-none", scoreColor(page.scores.overall))}>
              {page.scores.overall}
            </span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Overall</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => downloadJson(`analysis-${hostnameOf(page.url)}-${Date.now()}.json`, page)}
          >
            <Download className="h-3.5 w-3.5" />
            JSON
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border bg-muted/20 px-5 py-3">
        {CATEGORY_ORDER.map((cat) => (
          <span
            key={cat}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
              scorePillBg(page.scores[cat]),
            )}
          >
            <span className="uppercase tracking-wide">{cat}</span>
            <span>{page.scores[cat]}</span>
          </span>
        ))}
      </div>

      <div className="space-y-8 p-5">
        {CATEGORY_ORDER.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            findings={page.findings.filter((f) => f.category === cat)}
            wins={page.wins.filter((w) => w.category === cat)}
          />
        ))}
      </div>
    </article>
  );
}

function CategorySection({
  category,
  findings,
  wins,
}: {
  category: Category;
  findings: InterpretFinding[];
  wins: Win[];
}) {
  const [winsOpen, setWinsOpen] = useState(false);

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-heading text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {CATEGORY_LABELS[category]}
        </h2>
        <div className="h-px flex-1 bg-border" />
        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          {findings.length}
        </span>
      </div>

      {findings.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="text-xs font-semibold text-emerald-700">No issues found</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {findings.map((f) => (
            <IssueCard key={f.ruleId} finding={f} />
          ))}
        </div>
      )}

      {wins.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setWinsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", winsOpen ? "rotate-0" : "-rotate-90")}
            />
            {wins.length} passed check{wins.length === 1 ? "" : "s"}
          </button>
          {winsOpen && (
            <ul className="mt-2 space-y-1 pl-5">
              {wins.map((w) => (
                <li key={w.ruleId} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {w.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function IssueCard({ finding }: { finding: InterpretFinding }) {
  const isLong = finding.evidence.length > 60;
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/30 p-4 transition-colors hover:border-primary/40",
        isLong && "md:col-span-2",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            SEVERITY_STYLES[finding.severity],
          )}
        >
          {SEVERITY_LABELS[finding.severity]}
        </span>
      </div>
      <h3 className="font-heading text-sm font-semibold text-foreground">{finding.title}</h3>
      <p className="mt-1.5 inline-block rounded border border-border bg-background/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
        {finding.evidence}
      </p>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">{finding.ruleId}</p>
    </div>
  );
}
