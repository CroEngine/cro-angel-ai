import { useEffect, useRef, useState } from "react";

export function Viewport({ url, reloadKey }: { url: string; reloadKey: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    setBlocked(false);
    const t = window.setTimeout(() => {
      // Heuristic: many framed sites still load; we leave the fallback opt-in via error event.
    }, 4000);
    return () => window.clearTimeout(t);
  }, [url, reloadKey]);

  return (
    <div className="relative flex-1 overflow-hidden bg-muted/20">
      <iframe
        key={reloadKey}
        ref={ref}
        src={url}
        title="Preview"
        className="h-full w-full border-0 bg-background"
        onError={() => setBlocked(true)}
      />
      {blocked && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/80">
          <p className="text-sm text-muted-foreground">
            This site cannot be embedded. Real browser session arrives in a later stage.
          </p>
        </div>
      )}
    </div>
  );
}
