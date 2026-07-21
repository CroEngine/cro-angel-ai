import { useCallback, useEffect, useRef, useState } from "react";

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

export type StreamStatus = "idle" | "open" | "done" | "error";

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

    const handle = (type: string) => (ev: MessageEvent) => {
      if (typeof ev.data === "string" && ev.data.length > 500_000) {
        console.warn(`[useTestStream] large ${type} payload: ${(ev.data.length / 1024).toFixed(0)}kb — consider offloading to storage`);
      }
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(ev.data); } catch { /* keep empty */ }
      setEvents((prev) => [...prev, { type, data: parsed }]);
      if (type === "done") {
        setStatus("done");
        es.close();
      } else if (type === "error") {
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
      // EventSource auto-retries; only treat as terminal if we never opened.
      if (es.readyState === EventSource.CLOSED) {
        setStatus((s) => (s === "open" ? "error" : s));
      }
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
    setStatus((s) => (s === "open" ? "done" : s));
  }, []);

  return { events, status, stop };
}
