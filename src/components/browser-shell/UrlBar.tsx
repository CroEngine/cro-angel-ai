import { BarChart3, Play, Square } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { SessionState } from "./Viewport";

interface UrlBarProps {
  value: string;
  sessionState: SessionState;
  statusMessage?: string;
  liveStartedAt: number | null;
  analyzeDisabled?: boolean;
  onSubmit: (url: string) => void;
  onRun: (url: string) => void;
  onStop: () => void;
  onAnalyze: () => void;
}

export function UrlBar({
  value,
  sessionState,
  analyzeDisabled,
  onSubmit,
  onRun,
  onStop,
  onAnalyze,
}: UrlBarProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(draft);
  };

  const isLive = sessionState === "live";

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

      {isLive ? (
        <Button variant="destructive" size="sm" className="h-8 gap-1" type="button" onClick={onStop}>
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      ) : (
        <>
          <Button size="sm" className="h-8 gap-1" type="button" onClick={() => onRun(draft)}>
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            type="button"
            onClick={onAnalyze}
            disabled={analyzeDisabled}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Analyze
          </Button>
        </>
      )}
    </div>
  );
}
