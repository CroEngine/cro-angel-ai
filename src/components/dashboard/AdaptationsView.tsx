// "What Angel is doing" — the decision engine made visible. For each segment it
// shows whether Angel would adapt, the plain-language reasoning, and the concrete
// ops — plus a Preview button that runs the plan on the owner's real site. This is
// the expert-review surface: Angel shows its work and asks nothing of the visitor.

import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type AdaptationsOverview,
  getAdaptations,
  type SegmentDecision,
} from "@/lib/adaptations.functions";

export function AdaptationsView({ siteId }: { siteId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["adaptations", siteId],
    queryFn: () => getAdaptations({ data: { siteId, days: 30 } }),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="pt-6 text-sm text-destructive">
          Couldn’t load adaptations: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  if (data.totalSessions === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No sessions yet — install the snippet and Angel will start deciding how to help each
          segment.
        </CardContent>
      </Card>
    );
  }

  const adapting = data.segments.filter((s) => s.status === "adapt");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What Angel would do</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Angel only adapts segments that measurably underperform — everyone else sees your
            original site, untouched. Nothing here is live until you turn it on.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.inventoryCount === 0 && (
            <Banner>
              Angel needs your content first — run a crawl in the <strong>Content</strong> tab so it
              has a proven inventory to rearrange.
            </Banner>
          )}
          {data.learning && (
            <Banner tone="amber">
              Early signal — {data.totalSessions.toLocaleString()} sessions so far. Treat these as
              provisional until Angel has watched longer.
            </Banner>
          )}
          {data.inventoryCount > 0 && !data.learning && adapting.length === 0 && (
            <p className="py-1 text-sm text-muted-foreground">
              No segment is underperforming enough to adapt right now. Angel is holding steady.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {data.segments.map((s) => (
          <SegmentCard key={s.source} s={s} hasInventory={data.inventoryCount > 0} />
        ))}
      </div>
    </div>
  );
}

function SegmentCard({ s, hasInventory }: { s: SegmentDecision; hasInventory: boolean }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {s.label}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {s.sessions.toLocaleString()} sessions · {Math.round(s.share * 100)}%
          </span>
        </CardTitle>
        <StatusPill status={s.status} hasInventory={hasInventory} />
      </CardHeader>
      <CardContent>
        {s.status === "adapt" ? (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {s.rationale.map((r, i) => (
                <li key={i} className="text-sm">
                  {r}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-1.5">
              {s.ops.map((op, i) => (
                <span
                  key={i}
                  className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">{op.kind}</span> {op.detail}
                </span>
              ))}
            </div>
            {s.preview && <PreviewButton preview={s.preview} />}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {s.status === "thin"
              ? "Still learning — too few sessions to act on yet."
              : "Performing at or above your average. Angel leaves it untouched."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({
  status,
  hasInventory,
}: {
  status: SegmentDecision["status"];
  hasInventory: boolean;
}) {
  if (status === "adapt") {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600">
        Would adapt
      </span>
    );
  }
  if (status === "thin") {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        Learning
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {hasInventory ? "No change" : "Needs inventory"}
    </span>
  );
}

// Copies a one-liner the owner pastes into their site's console: it stashes the plan
// in sessionStorage and reloads, so the installed snippet boots and applies it. The
// preview persists as they click around; clearing the key (or reloading after) stops it.
function PreviewButton({ preview }: { preview: NonNullable<SegmentDecision["preview"]> }) {
  const [copied, setCopied] = useState(false);
  const payload = JSON.stringify(preview);
  const code = `sessionStorage.setItem('__angel_preview', ${JSON.stringify(payload)}); location.reload();`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? "Copied — paste in your site console" : "Preview on my site"}
      </Button>
      <span className="text-xs text-muted-foreground">
        Runs on your live site for you only; reload to stop.
      </span>
    </div>
  );
}

function Banner({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "amber" }) {
  const cls = tone === "amber" ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/40";
  return (
    <div className={`rounded-md border px-3 py-2 text-xs text-muted-foreground ${cls}`}>
      {children}
    </div>
  );
}
