import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TabStrip } from "./TabStrip";
import { UrlBar } from "./UrlBar";
import { Viewport, type FrozenSnapshot, type OverlayElement, type SessionState } from "./Viewport";
import { ConsolePanel } from "./ConsolePanel";
import { useTestStream } from "./hooks/useTestStream";
import { startTestRun, stopTestRun } from "@/lib/tests/run.functions";

const DEFAULT_URL = "https://glutenforum.se/";
const HIDDEN_FREEZE_MS = 15_000;

export function BrowserShell() {
  const [url, setUrl] = useState(DEFAULT_URL);

  const [runId, setRunId] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("cold");
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<FrozenSnapshot | null>(null);

  const startFn = useServerFn(startTestRun);
  const stopFn = useServerFn(stopTestRun);

  const { events } = useTestStream(runId);

  // Pull the latest collect's screenshot + overlay out of the stream and
  // stash it so we can show the Frozen viewport after the session closes.
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== "step_passed") continue;
      if (e.data.kind !== "collect") continue;
      const d = e.data.data as
        | { screenshot?: { dataUrl: string; viewport: { w: number; h: number } }; overlayElements?: OverlayElement[] }
        | undefined;
      if (d?.screenshot) {
        setFrozen({
          screenshotUrl: d.screenshot.dataUrl,
          viewport: d.screenshot.viewport,
          overlayElements: d.overlayElements ?? [],
        });
      }
      return;
    }
  }, [events]);

  // Start the live counter only when Browserbase actually confirms the session
  // is up — not on Run-click. Avoids ~1–2 s of lie at the start.
  useEffect(() => {
    if (liveStartedAt !== null) return;
    if (sessionState !== "live") return;
    if (events.some((e) => e.type === "session_started")) {
      setLiveStartedAt(Date.now());
    }
  }, [events, liveStartedAt, sessionState]);

  // Promote terminal events to sessionState.
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "done") {
        setSessionState((prev) => (prev === "error" ? prev : "frozen"));
        setStatusMessage(e.data.aborted ? "done · aborted" : "done");
        return;
      }
      if (e.type === "error") {
        setSessionState("error");
        setStatusMessage(`error · ${String(e.data.message ?? "")}`);
        return;
      }
    }
  }, [events]);

  // 15s hidden-tab freeze trigger: while Live and tab hidden, schedule a stop.
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (sessionState !== "live") return;
    const clearTimer = () => {
      if (hiddenTimer.current) {
        clearTimeout(hiddenTimer.current);
        hiddenTimer.current = null;
      }
    };
    const onChange = () => {
      // Always clear before setting — fix racekondition where snabba flikbyten
      // staplade flera timers.
      clearTimer();
      if (document.visibilityState === "hidden") {
        hiddenTimer.current = setTimeout(() => {
          if (runId) {
            void stopFn({ data: { runId } });
          }
        }, HIDDEN_FREEZE_MS);
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      clearTimer();
    };
  }, [sessionState, runId, stopFn]);


  const hostname = useMemo(() => {
    try { return new URL(url).hostname; } catch { return url; }
  }, [url]);

  const handleRun = useCallback(async (nextUrl: string) => {
    setUrl(nextUrl);
    setSessionState("live");
    setLiveStartedAt(null); // wait for session_started event
    setStatusMessage(undefined);
    setLiveUrl(null);
    setRunId(null);
    setFrozen(null); // drop previous snapshot so a crashed new run can't show stale data
    try {
      const res = await startFn({ data: { url: nextUrl } });
      setRunId(res.runId);
      setLiveUrl(res.liveUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSessionState("error");
      setStatusMessage(message);
      setLiveStartedAt(null);
    }
  }, [startFn]);


  const handleStop = useCallback(async () => {
    if (!runId) return;
    try { await stopFn({ data: { runId } }); } catch { /* ignore */ }
  }, [runId, stopFn]);

  const handleResume = useCallback(() => {
    void handleRun(url);
  }, [handleRun, url]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <TabStrip title={hostname} />
      <UrlBar
        value={url}
        sessionState={sessionState}
        statusMessage={statusMessage}
        liveStartedAt={liveStartedAt}
        onSubmit={(next) => setUrl(next)}
        onRun={handleRun}
        onStop={handleStop}
        onResume={handleResume}
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 lg:w-1/2 lg:border-r lg:border-border">
          <Viewport
            sessionState={sessionState}
            liveUrl={liveUrl}
            frozen={frozen}
            onResume={handleResume}
          />
        </div>
        <div className="flex min-h-0 flex-1 lg:w-1/2">
          <ConsolePanel events={events} />
        </div>
      </div>
    </div>
  );
}
