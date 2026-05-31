interface ViewportProps {
  url: string;
  reloadKey: number;
  liveUrl: string | null;
}

export function Viewport({ url, reloadKey, liveUrl }: ViewportProps) {
  const src = liveUrl ?? url;
  return (
    <div className="relative flex-1 overflow-hidden bg-muted/20">
      <iframe
        key={liveUrl ? `live-${liveUrl}` : `static-${reloadKey}`}
        src={src}
        title={liveUrl ? "Browserbase live session" : "Preview"}
        className="h-full w-full border-0 bg-background"
        // Browserbase live debug view needs broad permissions.
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
      {liveUrl && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          live · Browserbase
        </div>
      )}
    </div>
  );
}
