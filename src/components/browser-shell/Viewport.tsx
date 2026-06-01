import { CheckCircle2, Play, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ViewportProps {
  liveUrl: string | null;
  ended?: boolean;
  onClose?: () => void;
  onRunAgain?: () => void;
}

export function Viewport({ liveUrl, ended, onClose, onRunAgain }: ViewportProps) {
  return (
    <div className="relative flex-1 overflow-hidden bg-muted/20">
      {liveUrl ? (
        <>
          <iframe
            key={`live-${liveUrl}`}
            src={liveUrl}
            title="Browserbase live session"
            className={
              "h-full w-full border-0 bg-background transition-opacity duration-300 " +
              (ended ? "opacity-30" : "opacity-100")
            }
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />

          <div
            className={
              "pointer-events-none absolute left-3 top-3 z-10 rounded-md px-2 py-1 text-xs font-medium " +
              (ended
                ? "bg-muted text-muted-foreground"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400")
            }
          >
            {ended ? "Completed" : "live · Browserbase"}
          </div>

          {!ended && onClose && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute right-3 top-3 z-10 h-7 gap-1 px-2 text-xs"
              onClick={onClose}
            >
              <X className="h-3 w-3" />
              Close
            </Button>
          )}

          {ended && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-br from-background/80 via-background/70 to-muted/60 backdrop-blur-sm">
              <div className="mx-6 flex max-w-md flex-col items-center gap-5 rounded-xl border border-border bg-card/95 p-8 text-center shadow-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-lg font-semibold text-foreground">Session ended</h3>
                  <p className="text-sm text-muted-foreground">
                    Your test run completed and the live preview has been closed.
                  </p>
                </div>
                <div className="flex w-full items-center justify-center gap-2 pt-1">
                  {onRunAgain && (
                    <Button size="sm" onClick={onRunAgain} className="gap-1.5">
                      <RotateCw className="h-3.5 w-3.5" />
                      Run again
                    </Button>
                  )}
                  {onClose && (
                    <Button size="sm" variant="ghost" onClick={onClose}>
                      Close
                    </Button>
                  )}
                </div>
              </div>
            </div>
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
