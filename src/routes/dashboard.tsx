// The Angel Adaptive dashboard (Phase 1 / Learn Mode). Auth-gated: sign in, add a
// site (mints the public_site_key + shows the install snippet), then watch traffic
// land. No adaptation here — this is the analytics shell later milestones slot into.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { AuthGate, signOut } from "@/components/auth/AuthGate";
import { AnalyticsView } from "@/components/dashboard/AnalyticsView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { createSite, type DashboardSite, listSites } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Angel Adaptive — Dashboard" },
      { name: "description", content: "Your Learn-Mode analytics." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AuthGate>
      <DashboardInner />
    </AuthGate>
  );
}

function DashboardInner() {
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: () => listSites() });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sites = sitesQuery.data ?? [];
  const selected = sites.find((s) => s.id === selectedId) ?? sites[0] ?? null;

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-block size-2 rounded-full bg-primary" />
          Angel Adaptive
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            Learn
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {sitesQuery.isLoading ? (
          <Skeleton className="h-40" />
        ) : sites.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Add your site</CardTitle>
              <CardDescription>Enter your domain to get your install snippet.</CardDescription>
            </CardHeader>
            <CardContent>
              <SiteForm onCreated={(site) => setSelectedId(site.id)} />
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {sites.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm transition-colors " +
                    (selected?.id === s.id
                      ? "border-primary bg-primary/5 font-medium"
                      : "text-muted-foreground hover:bg-muted")
                  }
                >
                  {s.domain}
                </button>
              ))}
              <AddSiteButton onCreated={(site) => setSelectedId(site.id)} />
            </div>

            {selected && (
              <>
                <SnippetCard site={selected} />
                <AnalyticsView siteId={selected.id} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function SiteForm({ onCreated }: { onCreated?: (site: DashboardSite) => void }) {
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string) => createSite({ data: { domain: value } }),
    onSuccess: (site) => {
      void qc.invalidateQueries({ queryKey: ["sites"] });
      setDomain("");
      onCreated?.(site);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (domain.trim()) mutation.mutate(domain.trim());
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "…" : "Add site"}
        </Button>
      </div>
      {mutation.error && (
        <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
      )}
    </form>
  );
}

function AddSiteButton({ onCreated }: { onCreated?: (site: DashboardSite) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          + Add site
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a site</DialogTitle>
        </DialogHeader>
        <SiteForm
          onCreated={(site) => {
            setOpen(false);
            onCreated?.(site);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SnippetCard({ site }: { site: DashboardSite }) {
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://cdn.angeladaptive.ai";
  const tag = `<script src="${origin}/cdn/v1/script.js" data-site-id="${site.public_site_key}" async></script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(tag);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Install snippet</CardTitle>
        <CardDescription>
          Paste this once into your site&apos;s &lt;head&gt;. Then never touch it again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-2">
          <pre className="flex-1 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{tag}</code>
          </pre>
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
