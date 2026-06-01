import { ScrollArea } from "@/components/ui/scroll-area";
import type { StreamEvent } from "./hooks/useTestStream";

function fmtTime(ts: unknown) {
  const n = typeof ts === "number" ? ts : Date.now();
  const d = new Date(n);
  return d.toLocaleTimeString([], { hour12: false });
}

function renderEvent(ev: StreamEvent): string {
  switch (ev.type) {
    case "session_started":
      return `session started · ${String(ev.data.sessionId ?? "")}`;
    case "log":
      return `[${String(ev.data.level ?? "info")}] ${String(ev.data.message ?? "")}`;
    case "step_started":
      return `→ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")}`;
    case "step_passed":
      return `✓ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")} (${String(ev.data.durationMs ?? "?")}ms)`;
    case "step_failed":
      return `✗ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")} — ${String(ev.data.error ?? "")}`;
    case "done": {
      const p = ev.data.passed, f = ev.data.failed;
      const counts = (typeof p === "number" || typeof f === "number") ? ` · ${p ?? 0} passed, ${f ?? 0} failed` : "";
      return ev.data.aborted
        ? `done · aborted (${String(ev.data.reason ?? "")})${counts}`
        : `done${counts}`;
    }
    case "error":
      return `error · ${String(ev.data.message ?? "")}`;
    default:
      return `${ev.type} · ${JSON.stringify(ev.data)}`;
  }
}

export function ConsolePanel({ events }: { events: StreamEvent[] }) {
  return (
    <div className="flex h-64 flex-col border-t border-border bg-background">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-base font-semibold text-foreground">Console</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border font-mono text-xs">
          {events.length === 0 ? (
            <div className="px-4 py-2 text-muted-foreground">
              No run yet. Click <span className="font-medium text-foreground">Run tests</span> to start a Browserbase session.
            </div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="flex items-start gap-4 px-4 py-2">
                <span
                  className={
                    "flex-1 whitespace-pre-wrap break-all " +
                    (ev.type === "error" || ev.type === "step_failed"
                      ? "text-destructive"
                      : "text-foreground")
                  }
                >
                  {renderEvent(ev)}
                </span>
                <span className="shrink-0 text-muted-foreground">{fmtTime(ev.data.ts)}</span>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
