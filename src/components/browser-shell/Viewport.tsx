import { Play } from "lucide-react";

interface ViewportProps {
  liveUrl: string | null;
}

export function Viewport({ liveUrl }: ViewportProps) {
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
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            live · Browserbase
          </div>
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
