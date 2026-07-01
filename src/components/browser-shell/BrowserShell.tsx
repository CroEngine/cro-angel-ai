import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TabStrip } from "./TabStrip";
import { UrlBar } from "./UrlBar";
import { Viewport, type FrozenSnapshot, type OverlayElement, type SessionState } from "./Viewport";
import { ConsolePanel } from "./ConsolePanel";
import { useTestStream } from "./hooks/useTestStream";
import { startTestRun } from "@/lib/tests/run.functions";

const DEFAULT_URL = "https://glutenforum.se/";
const HIDDEN_FREEZE_MS = 15_000;

export function BrowserShell() {
  const [url, setUrl] = useState(DEFAULT_URL);

  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // The URL the active run is crawling — captured at Run time so the stream
  // identity stays stable even if the editable URL bar changes mid-run.
  const [runUrl, setRunUrl] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("cold");
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<FrozenSnapshot | null>(null);
  const [psiRunKey, setPsiRunKey] = useState(0);

  const startFn = useServerFn(startTestRun);

  // Persist the crawled inventory under a per-domain slug so the server can
  // diff it against the previous crawl (drift tracking). Derived from the run's
  // URL, not the editable bar, so it stays stable for the whole run.
  const ingestSite = useMemo(() => {
    if (!runUrl) return null;
    try {
      return new URL(runUrl).hostname.replace(/^www\./, "") || null;
    } catch {
      return null;
    }
  }, [runUrl]);

  const { events, stop } = useTestStream(runId, sessionId, runUrl, ingestSite);

  // Pull the latest collect's screenshot + overlay out of the stream and
  // stash it so we can show the Frozen viewport after the session closes.
  // Then merge in trust-signal overlays from the latest pageAudit step
  // (collect provides the screenshot; pageAudit just contributes extra rects).
  useEffect(() => {
    let next: FrozenSnapshot | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== "step_passed") continue;
      if (e.data.kind !== "collect") continue;
      const d = e.data.data as
        | { screenshot?: { dataUrl: string; viewport: { w: number; h: number } }; overlayElements?: OverlayElement[] }
        | undefined;
      if (d?.screenshot) {
        next = {
          screenshotUrl: d.screenshot.dataUrl,
          viewport: d.screenshot.viewport,
          overlayElements: d.overlayElements ?? [],
        };
      } else {
        console.warn("[BrowserShell] collect step passed but no screenshot in payload");
      }
      break;
    }
    if (!next) return;
    // Merge in trust-signal overlays from the latest pageAudit step (if any).
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type !== "step_passed") continue;
      if (e.data.kind !== "pageAudit") continue;
      const d = e.data.data as { overlayElements?: OverlayElement[] } | undefined;
      if (d?.overlayElements?.length) {
        next = { ...next, overlayElements: [...next.overlayElements, ...d.overlayElements] };
      }
      break;
    }
    setFrozen(next);
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
          stop();
          setSessionState((prev) => (prev === "error" ? prev : "frozen"));
          setStatusMessage("done · aborted");
        }, HIDDEN_FREEZE_MS);
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      clearTimer();
    };
  }, [sessionState, stop]);


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
    setSessionId(null);
    setRunUrl(null);
    setFrozen(null); // drop previous snapshot so a crashed new run can't show stale data
    try {
      const res = await startFn({ data: { url: nextUrl } });
      setLiveUrl(res.liveUrl);
      // Set sessionId + runUrl before runId so the stream opens once, with all
      // three present (the effect keys on all of them).
      setSessionId(res.sessionId);
      setRunUrl(nextUrl);
      setRunId(res.runId);
      // Trigger PSI in parallel AFTER Browserbase started, so page audit data
      // never lags behind PSI results in the UI.
      setPsiRunKey((k) => k + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSessionState("error");
      setStatusMessage(message);
      setLiveStartedAt(null);
    }
  }, [startFn]);


  const handleStop = useCallback(() => {
    stop();
    setSessionState((prev) => (prev === "error" ? prev : "frozen"));
    setStatusMessage("done · aborted");
  }, [stop]);

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
          <ConsolePanel events={events} url={url} psiRunKey={psiRunKey} />
        </div>
      </div>
    </div>
  );
}
