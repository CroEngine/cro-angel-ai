// Content Inventory view: trigger a crawl, watch its status, and browse what
// Angel found on the site — grouped by category. This is the ground truth of what
// content exists (the only content Angel may ever rearrange).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getInventory, startCrawl } from "@/lib/crawl.functions";

export function InventoryView({ siteId }: { siteId: string }) {
  const qc = useQueryClient();

  const inv = useQuery({
    queryKey: ["inventory", siteId],
    queryFn: () => getInventory({ data: { siteId } }),
    refetchInterval: (q) => (q.state.data?.latestCrawl?.status === "running" ? 3000 : false),
  });

  const crawl = useMutation({
    mutationFn: () => startCrawl({ data: { siteId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inventory", siteId] }),
  });

  const latest = inv.data?.latestCrawl;
  const running = latest?.status === "running" || crawl.isPending;
  const total = inv.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-sm">Content inventory</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What Angel found on your site — the only content it may ever rearrange.
            </p>
          </div>
          <Button size="sm" disabled={running} onClick={() => crawl.mutate()}>
            {running ? "Crawling…" : total > 0 ? "Re-crawl" : "Crawl now"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {running && (
            <p className="text-xs text-muted-foreground">
              Capturing &amp; extracting your pages…
              {latest ? ` ${latest.pagesCrawled} page(s) so far` : ""}
            </p>
          )}
          {latest?.status === "failed" && (
            <p className="text-xs text-destructive">Crawl failed: {latest.error}</p>
          )}
          {crawl.error && (
            <p className="text-xs text-destructive">{(crawl.error as Error).message}</p>
          )}
          {!running && total === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">
              No inventory yet — run a crawl to index your content.
            </p>
          )}
          {(inv.data?.byCategory.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {inv.data!.byCategory.map((c) => (
                <span key={c.category} className="rounded-md border px-2 py-1 text-xs">
                  <span className="font-medium">{c.category}</span>{" "}
                  <span className="tabular-nums text-muted-foreground">{c.count}</span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {inv.isLoading ? (
        <Skeleton className="h-48" />
      ) : (inv.data?.items.length ?? 0) > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Category</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead className="w-28">Section</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.data!.items.slice(0, 100).map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="align-top">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{it.category}</span>
                    </TableCell>
                    <TableCell className="max-w-md truncate">
                      {it.text || <span className="text-muted-foreground">{it.selector}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{it.sectionKind ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {inv.data!.items.length > 100 && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Showing 100 of {inv.data!.total}.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
