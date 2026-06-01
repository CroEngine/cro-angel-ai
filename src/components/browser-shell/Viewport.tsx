import { Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ViewportProps {
  liveUrl: string | null;
  ended?: boolean;
  onClose?: () => void;
}

export function Viewport({ liveUrl, ended, onClose }: ViewportProps) {
  return (
    <div className="relative flex-1 overflow-hidden bg-muted/20">
      {liveUrl ? (
        <>
          <iframe
            key={`live-${liveUrl}`}
            src={liveUrl}
            title="Browserbase live session"
            className="h-full w-full border-0 bg-background"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
          <div
            className={
              "pointer-events-none absolute left-2 top-2 rounded-md px-2 py-1 text-xs font-medium " +
              (ended
                ? "bg-muted text-muted-foreground"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")
            }
          >
            {ended ? "ended · session paused" : "live · Browserbase"}
          </div>
          {onClose && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute right-2 top-2 h-7 gap-1 px-2 text-xs"
              onClick={onClose}
            >
              <X className="h-3 w-3" />
              Close
            </Button>
          )}
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Play className="h-5 w-5" />
          </div>
          <p className="text-sm">Click <span className="font-medium text-foreground">Run tests</span> to launch a Browserbase session.</p>
        </div>
      )}
    </div>
  );
}
