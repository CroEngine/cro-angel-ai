import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TabStrip } from "./TabStrip";
import { UrlBar } from "./UrlBar";
import { Viewport, type FrozenSnapshot, type OverlayElement, type SessionState } from "./Viewport";
import { ConsolePanel, type ConsoleTab } from "./ConsolePanel";
import { useTestStream } from "./hooks/useTestStream";
import { buildPageReports } from "./findings";
import { interpretReports, type PageInterpretation } from "./interpret";
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
  const [interpretation, setInterpretation] = useState<PageInterpretation[] | null>(null);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("findings");

  const startFn = useServerFn(startTestRun);
  const stopFn = useServerFn(stopTestRun);

  const { events } = useTestStream(runId);

  const pageReports = useMemo(() => buildPageReports(events), [events]);
  const analyzeDisabled = pageReports.length === 0;

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
    setLiveStartedAt(null);
    setStatusMessage(undefined);
    setLiveUrl(null);
    setRunId(null);
    setFrozen(null);
    setInterpretation(null);
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

  const handleAnalyze = useCallback(() => {
    setInterpretation(interpretReports(pageReports));
    setConsoleTab("interpret");
  }, [pageReports]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <TabStrip title={hostname} />
      <UrlBar
        value={url}
        sessionState={sessionState}
        statusMessage={statusMessage}
        liveStartedAt={liveStartedAt}
        analyzeDisabled={analyzeDisabled}
        onSubmit={(next) => setUrl(next)}
        onRun={handleRun}
        onStop={handleStop}
        onAnalyze={handleAnalyze}
      />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 lg:w-1/2 lg:border-r lg:border-border">
          <Viewport
            sessionState={sessionState}
            liveUrl={liveUrl}
            frozen={frozen}
          />
        </div>
        <div className="flex min-h-0 flex-1 lg:w-1/2">
          <ConsolePanel
            events={events}
            interpretation={interpretation}
            tab={consoleTab}
            onTabChange={setConsoleTab}
          />
        </div>
      </div>
    </div>
  );
}
