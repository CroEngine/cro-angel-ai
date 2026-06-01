import { ArrowLeft, ArrowRight, RotateCw, Play, Square, MousePointer2, Hand, Snowflake, Circle } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

export function UrlBar({ value, sessionState, statusMessage, liveStartedAt, onSubmit, onRun, onStop, onResume }: UrlBarProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  useTicker(sessionState === "live");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };

  const isLive = sessionState === "live";

  const chipContent = useMemo(() => {
    switch (sessionState) {
      case "live": {
        const elapsed = liveStartedAt ? formatElapsed(Date.now() - liveStartedAt) : "0m 00s";
        return { icon: <Circle className="h-2.5 w-2.5 fill-current" />, label: `Live · ${elapsed}`, className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
      }
      case "frozen":
        return { icon: <Snowflake className="h-3 w-3" />, label: "Frozen · click to resume", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400 cursor-pointer hover:bg-sky-500/25" };
      case "error":
        return { icon: <Circle className="h-2.5 w-2.5 fill-current" />, label: statusMessage ?? "error", className: "bg-destructive/15 text-destructive" };
      case "cold":
      default:
        return { icon: <Circle className="h-2.5 w-2.5" />, label: "Cold", className: "bg-muted text-muted-foreground" };
    }
  }, [sessionState, liveStartedAt, statusMessage]);

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2">
      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled>
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>

      <button
        type="button"
        onClick={sessionState === "frozen" ? onResume : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
          chipContent.className,
        )}
        disabled={sessionState !== "frozen"}
      >
        {chipContent.icon}
        {chipContent.label}
      </button>

      <form onSubmit={handleSubmit} className="flex-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 rounded-md bg-muted/50 font-mono text-sm"
          spellCheck={false}
        />
      </form>

      {isLive ? (
        <Button variant="destructive" size="sm" className="h-8 gap-1" type="button" onClick={onStop}>
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

      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled>
          <MousePointer2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" disabled>
          <Hand className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
