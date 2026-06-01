import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { StreamEvent } from "./hooks/useTestStream";

function fmtTime(ts: unknown) {
  const n = typeof ts === "number" ? ts : Date.now();
  const d = new Date(n);
  return d.toLocaleTimeString([], { hour12: false });
}

type CollectedElement = {
  text: string;
  tagName: string;
  selector: string;
  href: string | null;
  disabled: boolean;
  visible: boolean;
  aboveFold: boolean;
  rect: { x: number; y: number; w: number; h: number };
  attributes?: Record<string, string>;
  computedStyles?: {
    color?: string;
    backgroundColor?: string;
    fontSize?: string;
    fontWeight?: string;
    padding?: string;
    borderRadius?: string;
    border?: string;
    cursor?: string;
    display?: string;
  };
};

type CollectData = {
  target: string;
  count: number;
  elements: CollectedElement[];
};

function isCollectData(v: unknown): v is CollectData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.target === "string" && typeof o.count === "number" && Array.isArray(o.elements);
}

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

function renderEventLine(ev: StreamEvent): string {
  switch (ev.type) {
    case "session_started":
      return `session started · ${String(ev.data.sessionId ?? "")}`;
    case "log":
      return `[${String(ev.data.level ?? "info")}] ${String(ev.data.message ?? "")}`;
    case "step_started":
      return `→ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")}`;
    case "step_passed": {
      const base = `✓ [${String(ev.data.index ?? "?")}] ${String(ev.data.summary ?? "")} (${String(ev.data.durationMs ?? "?")}ms)`;
      if (ev.data.kind === "collect" && isCollectData(ev.data.data)) {
        return `${base} · ${ev.data.data.count} ${ev.data.data.target}`;
      }
      return base;
    }
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

function CollectDetails({ data }: { data: CollectData }) {
  const preview = data.elements.slice(0, 5);
  return (
    <div className="mt-2 space-y-2 rounded border border-border bg-muted/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          {data.count} {data.target} (showing first {preview.length})
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          onClick={() => downloadJson(`${data.target}-${Date.now()}.json`, data.elements)}
        >
          Download JSON
        </Button>
      </div>
      {preview.length > 0 && (
        <ul className="space-y-1">
          {preview.map((el, i) => {
            const bg = el.computedStyles?.backgroundColor;
            const fg = el.computedStyles?.color;
            return (
              <li key={i} className="flex items-center gap-2 truncate">
                <span className="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded bg-cyan-600 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                {(bg || fg) && (
                  <span
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border text-[9px] font-bold"
                    style={{ background: bg, color: fg }}
                    title={`bg ${bg} · fg ${fg}`}
                  >
                    A
                  </span>
                )}
                <span className="truncate text-foreground">
                  {el.text || <em className="text-muted-foreground">(no text)</em>}
                </span>
                <span className="truncate text-muted-foreground">— {el.selector}</span>
                {!el.visible && <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">hidden</span>}
                {el.visible && !el.aboveFold && <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">below</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
            events.map((ev, i) => {
              const isCollectPassed =
                ev.type === "step_passed" && ev.data.kind === "collect" && isCollectData(ev.data.data);
              return (
                <div key={i} className="flex items-start gap-4 px-4 py-2">
                  <div className="flex-1 min-w-0">
                    <span
                      className={
                        "whitespace-pre-wrap break-all " +
                        (ev.type === "error" || ev.type === "step_failed"
                          ? "text-destructive"
                          : "text-foreground")
                      }
                    >
                      {renderEventLine(ev)}
                    </span>
                    {isCollectPassed && <CollectDetails data={ev.data.data as CollectData} />}
                  </div>
                  <span className="shrink-0 text-muted-foreground">{fmtTime(ev.data.ts)}</span>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
