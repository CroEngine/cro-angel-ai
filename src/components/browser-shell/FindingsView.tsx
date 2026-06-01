import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StreamEvent } from "./hooks/useTestStream";
import {
  buildPageReports,
  type Finding,
  type FindingCategory,
  type PageReport,
} from "./findings";

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  seo: "SEO",
  cro: "CRO",
  ux: "UX / Struktur",
  interaction: "Interaktioner",
};

const CATEGORY_ORDER: FindingCategory[] = ["seo", "cro", "ux", "interaction"];

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

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className="flex items-baseline gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">·</span>
      <span className="text-foreground">{f.label}</span>
      {f.detail && (
        <span className="truncate text-muted-foreground">— {f.detail}</span>
      )}
    </li>
  );
}

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
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground hover:text-primary"
      >
        <ChevronRight
          className={"h-3 w-3 transition-transform " + (open ? "rotate-90" : "")}
        />
        {CATEGORY_LABELS[category]}
        <span className="ml-1 text-muted-foreground">({findings.length})</span>
      </button>
      {open && (
        <ul className="ml-4 space-y-0 font-mono text-[11px]">
          {findings.map((f, i) => (
            <FindingRow key={i} f={f} />
          ))}
        </ul>
      )}
    </div>
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

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs font-semibold text-foreground">
            {report.url}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {report.findings.length} datapunkter
          </div>
        </div>
        {Boolean(report.rawPageAudit || report.rawCollect) && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-[10px]"
            onClick={() =>
              downloadJson(`page-${Date.now()}.json`, {
                url: report.url,
                pageAudit: report.rawPageAudit,
                collect: report.rawCollect,
              })
            }
          >
            Download JSON
          </Button>
        )}
      </div>
      <div className="space-y-2 px-3 py-2">
        {CATEGORY_ORDER.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            findings={grouped[cat] ?? []}
          />
        ))}
        {report.findings.length === 0 && (
          <div className="text-[11px] text-muted-foreground">
            Väntar på data…
          </div>
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
