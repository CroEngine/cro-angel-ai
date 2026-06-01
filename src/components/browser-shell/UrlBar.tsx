import { ArrowLeft, ArrowRight, RotateCw, Play, Square, MousePointer2, Hand } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RunState = "idle" | "connecting" | "running" | "done" | "error";

interface UrlBarProps {
  value: string;
  runState: RunState;
  statusMessage?: string;
  idleAfterLoad?: boolean;
  onSubmit: (url: string) => void;
  onReload: () => void;
  onRun: (url: string) => void;
  onStop: () => void;
}

const pillStyles: Record<RunState, string> = {
  idle: "bg-muted text-muted-foreground",
  connecting: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  running: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  done: "bg-muted text-foreground",
  error: "bg-destructive/15 text-destructive",
};

export function UrlBar({ value, runState, statusMessage, idleAfterLoad, onSubmit, onReload, onRun, onStop }: UrlBarProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };

  const isActive = runState === "connecting" || runState === "running";

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2">
      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={onReload}>
          <RotateCw className="h-4 w-4" />
        </Button>
      </div>
      <form onSubmit={handleSubmit} className="flex-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 rounded-md bg-muted/50 font-mono text-sm"
          spellCheck={false}
        />
      </form>

      <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", runState === "running" && idleAfterLoad ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : pillStyles[runState])}>
        {runState === "idle" && "idle"}
        {runState === "connecting" && "connecting…"}
        {runState === "running" && (idleAfterLoad ? "idle" : "running")}
        {runState === "done" && (statusMessage ?? "done")}
        {runState === "error" && (statusMessage ?? "error")}
      </span>

      {isActive ? (
        <Button variant="destructive" size="sm" className="h-8 gap-1" type="button" onClick={onStop}>
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      ) : (
        <Button size="sm" className="h-8 gap-1" type="button" onClick={() => onRun(draft)}>
          <Play className="h-3.5 w-3.5" />
          Run tests
        </Button>
      )}

      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <MousePointer2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" type="button">
          <Hand className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
