import { useMemo, useState } from "react";
import { TabStrip } from "./TabStrip";
import { UrlBar } from "./UrlBar";
import { Viewport } from "./Viewport";
import { ConsolePanel } from "./ConsolePanel";

const DEFAULT_URL = "https://glutenforum.se/";

export function BrowserShell() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [reloadKey, setReloadKey] = useState(0);

  const hostname = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }, [url]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <TabStrip title={hostname} />
      <UrlBar
        value={url}
        onSubmit={(next) => {
          setUrl(next);
          setReloadKey((k) => k + 1);
        }}
        onReload={() => setReloadKey((k) => k + 1)}
      />
      <Viewport url={url} reloadKey={reloadKey} />
      <ConsolePanel />
    </div>
  );
}
