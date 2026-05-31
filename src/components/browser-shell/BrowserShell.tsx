import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TabStrip } from "./TabStrip";
import { UrlBar, type RunState } from "./UrlBar";
import { Viewport } from "./Viewport";
import { ConsolePanel } from "./ConsolePanel";
import { useTestStream } from "./hooks/useTestStream";
import { startTestRun, stopTestRun } from "@/lib/tests/run.functions";

const DEFAULT_URL = "https://glutenforum.se/";

export function BrowserShell() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [reloadKey, setReloadKey] = useState(0);

  const [runId, setRunId] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);

  const startFn = useServerFn(startTestRun);
  const stopFn = useServerFn(stopTestRun);

  const { events, status: streamStatus } = useTestStream(runId);

  // Promote stream terminal events to runState.
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "done") {
        setRunState("done");
        setStatusMessage(e.data.aborted ? "done · aborted" : "done");
        return;
      }
      if (e.type === "error") {
        setRunState("error");
        setStatusMessage(`error · ${String(e.data.message ?? "")}`);
        return;
      }
    }
  }, [events]);

  useEffect(() => {
    if (streamStatus === "error") {
      setRunState((s) => (s === "running" ? "error" : s));
      setStatusMessage((m) => m ?? "stream lost");
    }
  }, [streamStatus]);

  const hostname = useMemo(() => {
    try { return new URL(url).hostname; } catch { return url; }
  }, [url]);

  const handleRun = useCallback(async (nextUrl: string) => {
    setUrl(nextUrl);
    setRunState("connecting");
    setStatusMessage(undefined);
    setLiveUrl(null);
    setRunId(null);
    try {
      const res = await startFn({ data: { url: nextUrl } });
      setRunId(res.runId);
      setLiveUrl(res.liveUrl);
      setRunState("running");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunState("error");
      setStatusMessage(message);
    }
  }, [startFn]);

  const handleStop = useCallback(async () => {
    if (!runId) return;
    try { await stopFn({ data: { runId } }); } catch { /* ignore */ }
  }, [runId, stopFn]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <TabStrip title={hostname} />
      <UrlBar
        value={url}
        runState={runState}
        statusMessage={statusMessage}
        onSubmit={(next) => {
          setUrl(next);
          setReloadKey((k) => k + 1);
          // When user just edits URL while idle, clear any stale live session.
          if (runState !== "running" && runState !== "connecting") {
            setLiveUrl(null);
          }
        }}
        onReload={() => setReloadKey((k) => k + 1)}
        onRun={handleRun}
        onStop={handleStop}
      />
      <Viewport url={url} reloadKey={reloadKey} liveUrl={liveUrl} />
      <ConsolePanel events={events} />
    </div>
  );
}
