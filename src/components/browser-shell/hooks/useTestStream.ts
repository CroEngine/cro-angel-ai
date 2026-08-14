import { useCallback, useEffect, useRef, useState } from "react";

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

export type StreamStatus = "idle" | "open" | "done" | "aborted" | "error";

// Opens the SSE stream that BOTH drives and reports the crawl. The crawl runs
// server-side inside this streaming request, so closing the EventSource (stop)
// aborts the run and releases the Browserbase session via the route's cancel().
export function useTestStream(
  runId: string | null,
  sessionId: string | null,
  url: string | null,
  ingestSite: string | null = null,
) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setEvents([]);
    if (!runId || !sessionId || !url) {
      setStatus("idle");
      return;
    }
    setStatus("open");
    const params = new URLSearchParams({ sessionId, url });
    // When set, the crawl persists its inventory under this site slug and the
    // server diffs it against the previous crawl (drift tracking).
    if (ingestSite) params.set("ingestSite", ingestSite);
    const qs = params.toString();
    const es = new EventSource(`/api/tests/${runId}/stream?${qs}`);
    esRef.current = es;
    // Sant när servern redan avslutat körningen (done/error) — då är en
    // efterföljande onerror bara den stängda anslutningen, inget nytt fel.
    let terminal = false;

    const handle = (type: string) => (ev: MessageEvent) => {
      if (typeof ev.data === "string" && ev.data.length > 500_000) {
        console.warn(
          `[useTestStream] large ${type} payload: ${(ev.data.length / 1024).toFixed(0)}kb — consider offloading to storage`,
        );
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        /* keep empty */
      }
      setEvents((prev) => [...prev, { type, data: parsed }]);
      if (type === "done") {
        terminal = true;
        setStatus("done");
        es.close();
      } else if (type === "error") {
        terminal = true;
        setStatus("error");
        es.close();
      }
    };

    es.addEventListener("session_started", handle("session_started"));
    es.addEventListener("log", handle("log"));
    es.addEventListener("state", handle("state"));
    es.addEventListener("step_started", handle("step_started"));
    es.addEventListener("step_passed", handle("step_passed"));
    es.addEventListener("step_failed", handle("step_failed"));
    es.addEventListener("done", handle("done"));
    es.addEventListener("error", handle("error"));
    es.onerror = () => {
      if (terminal) return;
      // INGEN auto-reconnect (granskningsfynd 2026-08-14): crawlen körs INUTI
      // själva GET-requesten (se $runId.stream.ts), så EventSource:s inbyggda
      // retry skulle re-issua GET:en och STARTA OM hela crawlen under samma
      // runId — med duplicerade events appendade på den behållna arrayen.
      // Stäng i stället strömmen och rapportera ett ärligt fel; eventet
      // plockas upp av BrowserShells terminal-promotion precis som ett
      // serverutsänt error.
      terminal = true;
      es.close();
      setStatus("error");
      setEvents((prev) => [
        ...prev,
        { type: "error", data: { message: "connection lost — run aborted", ts: Date.now() } },
      ]);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [runId, sessionId, url, ingestSite]);

  // Stop the run: closing the EventSource drops the request, which fires the
  // stream route's cancel() → aborts the crawl and releases the session. Events
  // already received are kept so the frozen view/console survive.
  const stop = useCallback(() => {
    esRef.current?.close();
    // "aborted", inte "done" (granskningsfynd 2026-08-14): en stoppad körning
    // är inte färdig — statusen ska låta vyerna skilja avbrutet från klart.
    setStatus((s) => (s === "open" ? "aborted" : s));
  }, []);

  return { events, status, stop };
}
