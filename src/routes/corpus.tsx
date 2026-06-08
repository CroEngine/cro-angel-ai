import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { Download, FileJson, ChevronDown, ChevronRight, ExternalLink, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listCorpus, ARTIFACT_FILES, type ArtifactFile } from "@/lib/corpus.functions";

const corpusQuery = queryOptions({
  queryKey: ["corpus"],
  queryFn: () => listCorpus(),
});

export const Route = createFileRoute("/corpus")({
  head: () => ({
    meta: [
      { title: "Corpus inspector — frysningsartefakter" },
      { name: "description", content: "Inspektera och ladda ner alla frysta artefakter per sajt." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(corpusQuery),
  component: CorpusPage,
});

const JSON_FILES: ArtifactFile[] = ["golden.json", "meta.json", "freeze-report.json"];

function formatKb(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function CorpusPage() {
  const { data } = useSuspenseQuery(corpusQuery);
  const { sites } = data;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Corpus inspector</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {sites.length} sajt{sites.length === 1 ? "" : "er"} i <code>corpus/</code>. Ladda ner artefakter eller bläddra i JSON inline.
            </p>
          </div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Tillbaka</Link>
        </header>

        {sites.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Inga frysta sajter ännu. Kör <code>bun run freeze --url=... --name=...</code>.
            </CardContent>
          </Card>
        ) : (
          sites.map((site) => <SiteCard key={site.name} site={site} />)
        )}
      </div>
    </div>
  );
}

function SiteCard({ site }: { site: ReturnType<typeof useSuspenseQuery<typeof corpusQuery>>["data"]["sites"][number] }) {
  const meta = site.meta as { url?: string; captured_at?: string; viewport?: { width: number; height: number }; notes?: string } | null;
  const fr = site.freezeReport as any;
  const g = site.goldenSummary;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-xl">{site.name}</CardTitle>
            {meta?.url && (
              <a href={meta.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                {meta.url} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
              {meta?.captured_at && <span>captured {meta.captured_at.slice(0, 10)}</span>}
              {meta?.viewport && <span>{meta.viewport.width}×{meta.viewport.height}</span>}
              {fr?.ok != null && (
                <Badge variant={fr.ok ? "default" : "destructive"}>{fr.ok ? "freeze ok" : "freeze failed"}</Badge>
              )}
            </div>
          </div>
          {site.files["screenshot.jpg"].exists && (
            <a href={`/api/corpus/${site.name}/screenshot.jpg`} target="_blank" rel="noopener noreferrer" className="block shrink-0">
              <img
                src={`/api/corpus/${site.name}/screenshot.jpg`}
                alt={`${site.name} screenshot`}
                className="h-24 w-40 rounded border border-border object-cover object-top"
              />
            </a>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filstatus */}
        <div className="flex flex-wrap gap-2">
          {ARTIFACT_FILES.map((f) => {
            const info = site.files[f];
            return (
              <Badge key={f} variant={info.exists ? "secondary" : "outline"} className="gap-1 font-mono text-xs">
                {info.exists ? <Check className="h-3 w-3 text-green-600" /> : <X className="h-3 w-3 text-red-500" />}
                {f} · {formatKb(info.sizeBytes)}
              </Badge>
            );
          })}
        </div>

        {/* Snabbsiffror */}
        {g && (
          <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            <Stat label="elements" value={g.elementCount} />
            <Stat label="primary CTA (AF)" value={g.primaryCtaAboveFold} />
            <Stat label="competing (AF)" value={g.competingAboveFold} />
            <Stat label="H1" value={g.h1[0] ?? "—"} mono />
            <Stat label="hero headline" value={g.heroHeadline ?? "—"} mono />
            <Stat label="hero CTA" value={g.heroCtaText ? `${g.heroCtaText} (${g.heroCtaIntent ?? "?"})` : "—"} mono />
            {g.title && <Stat label="<title>" value={g.title} mono className="sm:col-span-3" />}
            {g.sectionOrder && g.sectionOrder.length > 0 && (
              <Stat label="sectionOrder" value={g.sectionOrder.join(" → ")} mono className="sm:col-span-3" />
            )}
          </div>
        )}

        {/* Freeze-report siffror */}
        {fr?.capture && (
          <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm sm:grid-cols-4">
            <Stat label="mhtml kB" value={fr.capture.mhtmlKb} />
            <Stat label="fonts embedded" value={fr.capture.embeddedFontCount} />
            <Stat label="font fetch fails" value={fr.capture.fontFetchFailures?.length ?? 0} />
            <Stat label="goto ms" value={fr.timing?.gotoMs} />
          </div>
        )}

        {/* Downloads */}
        <div className="flex flex-wrap gap-2">
          {ARTIFACT_FILES.map((f) => {
            const info = site.files[f];
            if (!info.exists) return null;
            return (
              <a key={f} href={`/api/corpus/${site.name}/${f}?download=1`} download={`${site.name}-${f}`}>
                <Button variant="outline" size="sm" className="gap-1">
                  <Download className="h-3 w-3" /> {f}
                </Button>
              </a>
            );
          })}
        </div>

        {/* JSON-viewer */}
        <div className="space-y-2">
          {JSON_FILES.map((f) =>
            site.files[f].exists ? <JsonInline key={f} site={site.name} file={f} /> : null,
          )}
        </div>

        {meta?.notes && (
          <p className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            <span className="font-semibold">notes:</span> {meta.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: any;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={mono ? "truncate font-mono text-sm text-foreground" : "text-sm text-foreground"}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function JsonInline({ site, file }: { site: string; file: ArtifactFile }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && content == null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/corpus/${site}/${file}`);
        const text = await res.text();
        try {
          setContent(JSON.stringify(JSON.parse(text), null, 2));
        } catch {
          setContent(text);
        }
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="inline-flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <FileJson className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono">{file}</span>
        </span>
        <span className="text-xs text-muted-foreground">{open ? "dölj" : "visa"}</span>
      </button>
      {open && (
        <pre className="max-h-96 overflow-auto border-t border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
          {loading ? "laddar…" : content}
        </pre>
      )}
    </div>
  );
}
