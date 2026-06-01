import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { spikePlaywright, spikeStagehand } from "@/lib/tests/spike.functions";

export const Route = createFileRoute("/spike")({
  head: () => ({ meta: [{ title: "Runtime spike" }] }),
  component: SpikePage,
});

type Result = { ok: boolean; durationMs: number; title?: string; error?: string; stack?: string } | null;

function SpikePage() {
  const pw = useServerFn(spikePlaywright);
  const sh = useServerFn(spikeStagehand);
  const [pwRes, setPwRes] = useState<Result>(null);
  const [shRes, setShRes] = useState<Result>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [shBusy, setShBusy] = useState(false);

  const run = async (which: "pw" | "sh") => {
    if (which === "pw") {
      setPwBusy(true); setPwRes(null);
      try { setPwRes(await pw()); }
      catch (e) { setPwRes({ ok: false, durationMs: 0, error: (e as Error).message }); }
      finally { setPwBusy(false); }
    } else {
      setShBusy(true); setShRes(null);
      try { setShRes(await sh()); }
      catch (e) { setShRes({ ok: false, durationMs: 0, error: (e as Error).message }); }
      finally { setShBusy(false); }
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8 font-mono text-sm">
      <h1 className="text-xl font-semibold">Runtime spike</h1>
      <p className="text-muted-foreground">
        Two-step probe: does workerd run Playwright / Stagehand as a CDP client against Browserbase?
      </p>

      <section className="space-y-2 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Spike A — playwright-core connectOverCDP</h2>
          <button
            onClick={() => run("pw")}
            disabled={pwBusy}
            className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
          >
            {pwBusy ? "Running…" : "Run"}
          </button>
        </div>
        <pre className="whitespace-pre-wrap break-words text-xs">
          {pwRes ? JSON.stringify(pwRes, null, 2) : "—"}
        </pre>
      </section>

      <section className="space-y-2 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Spike B — Stagehand env=BROWSERBASE</h2>
          <button
            onClick={() => run("sh")}
            disabled={shBusy}
            className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
          >
            {shBusy ? "Running…" : "Run"}
          </button>
        </div>
        <pre className="whitespace-pre-wrap break-words text-xs">
          {shRes ? JSON.stringify(shRes, null, 2) : "—"}
        </pre>
      </section>
    </div>
  );
}
