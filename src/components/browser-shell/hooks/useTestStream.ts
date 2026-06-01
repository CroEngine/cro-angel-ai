import { useEffect, useRef, useState } from "react";

export interface StreamEvent {
  type: string;
  data: Record<string, unknown>;
}

export type StreamStatus = "idle" | "open" | "done" | "error";

export function useTestStream(runId: string | null) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setEvents([]);
    if (!runId) {
      setStatus("idle");
      return;
    }
    setStatus("open");
    const es = new EventSource(`/api/tests/${runId}/stream`);
    esRef.current = es;

    const handle = (type: string) => (ev: MessageEvent) => {
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
  }, [runId]);

  return { events, status };
}
