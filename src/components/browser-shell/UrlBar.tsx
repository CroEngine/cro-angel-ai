import { RotateCw, Play, Square } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { SessionState } from "./Viewport";

interface UrlBarProps {
  value: string;
  sessionState: SessionState;
  statusMessage?: string;
  liveStartedAt: number | null;
  onSubmit: (url: string) => void;
  onRun: (url: string) => void;
  onStop: () => void;
  onResume: () => void;
}

export function UrlBar({
  value,
  sessionState,
  statusMessage,
  liveStartedAt,
  onSubmit,
  onRun,
  onStop,
  onResume,
}: UrlBarProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };

  const isLive = sessionState === "live";

  // Tickande klocka för live-räknaren — liveStartedAt sätts först när
  // Browserbase bekräftat sessionen (session_started), se BrowserShell.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive || liveStartedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [isLive, liveStartedAt]);
  const elapsedS =
    isLive && liveStartedAt !== null ? Math.max(0, Math.floor((now - liveStartedAt) / 1000)) : null;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2">
      <form onSubmit={handleSubmit} className="flex-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 rounded-md bg-muted/50 font-mono text-sm"
          spellCheck={false}
        />
      </form>

      {/* Statusytan (granskningsfynd 2026-08-14): props:en fanns men
          renderades aldrig — körningsfel var helt tysta för ägaren. */}
      {elapsedS !== null && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="off">
          live · {elapsedS}s
        </span>
      )}
      {statusMessage && (
        <span
          role="status"
          title={statusMessage}
          className={`max-w-[40ch] truncate text-xs ${
            sessionState === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {statusMessage}
        </span>
      )}

      {isLive ? (
        <Button
          variant="destructive"
          size="sm"
          className="h-8 gap-1"
          type="button"
          onClick={onStop}
        >
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      ) : sessionState === "frozen" ? (
        <Button size="sm" className="h-8 gap-1" type="button" onClick={onResume}>
          <RotateCw className="h-3.5 w-3.5" />
          Resume
        </Button>
      ) : (
        <Button size="sm" className="h-8 gap-1" type="button" onClick={() => onRun(draft)}>
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
      )}
    </div>
  );
}
