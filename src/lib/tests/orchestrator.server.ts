// In-memory event bus + run registry for the test runner.
// CRITICAL: process-local state. Works only inside a single Worker instance,
// which is fine for the Slice 2.1 prototype.

export type RunEventType = "session_started" | "log" | "done" | "error";

export interface RunEvent {
  type: RunEventType;
  data: Record<string, unknown>;
  ts: number;
}

type Listener = (event: RunEvent) => void;

interface Run {
  id: string;
  events: RunEvent[];
  listeners: Set<Listener>;
  terminated: boolean;
  abort: AbortController;
  closeSession: () => Promise<void>;
  lastActivity: number;
  watchdog?: ReturnType<typeof setTimeout>;
  hardTimeout?: ReturnType<typeof setTimeout>;
}

const runs = new Map<string, Run>();

const HARD_TIMEOUT_MS = 60_000;
const WATCHDOG_MS = 15_000;

export function createRun(id: string, closeSession: () => Promise<void>) {
  const run: Run = {
    id,
    events: [],
    listeners: new Set(),
    terminated: false,
    abort: new AbortController(),
    closeSession,
    lastActivity: Date.now(),
  };
  runs.set(id, run);

  run.hardTimeout = setTimeout(() => {
    void terminate(id, "done", { aborted: true, reason: "hard_timeout" });
  }, HARD_TIMEOUT_MS);

  const tick = () => {
    const r = runs.get(id);
    if (!r || r.terminated) return;
    if (Date.now() - r.lastActivity > WATCHDOG_MS) {
      void terminate(id, "done", { aborted: true, reason: "watchdog" });
      return;
    }
    r.watchdog = setTimeout(tick, 2_000);
  };
  run.watchdog = setTimeout(tick, 2_000);

  return run;
}

export function getRun(id: string) {
  return runs.get(id);
}

export function emit(id: string, type: RunEventType, data: Record<string, unknown> = {}) {
  const run = runs.get(id);
  if (!run || run.terminated) return;
  const event: RunEvent = { type, data, ts: Date.now() };
  run.events.push(event);
  run.lastActivity = Date.now();
  for (const l of run.listeners) {
    try {
      l(event);
    } catch {
      /* ignore */
    }
  }
}

export function subscribe(id: string, listener: Listener) {
  const run = runs.get(id);
  if (!run) return () => {};
  // Replay buffered events to new subscriber.
  for (const e of run.events) listener(e);
  run.listeners.add(listener);
  return () => {
    run.listeners.delete(listener);
  };
}

export async function terminate(
  id: string,
  type: "done" | "error",
  data: Record<string, unknown> = {},
) {
  const run = runs.get(id);
  if (!run || run.terminated) return;
  run.terminated = true;
  if (run.watchdog) clearTimeout(run.watchdog);
  if (run.hardTimeout) clearTimeout(run.hardTimeout);
  try {
    run.abort.abort();
  } catch {
    /* ignore */
  }
  try {
    await run.closeSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const e: RunEvent = { type: "log", data: { level: "warn", message: `closeSession failed: ${message}` }, ts: Date.now() };
    run.events.push(e);
    for (const l of run.listeners) {
      try { l(e); } catch { /* ignore */ }
    }
  }
  const event: RunEvent = { type, data, ts: Date.now() };
  run.events.push(event);
  for (const l of run.listeners) {
    try { l(event); } catch { /* ignore */ }
  }
  // Keep the run around briefly so late subscribers can replay the terminal event.
  setTimeout(() => {
    runs.delete(id);
  }, 30_000);
}

export function isTerminated(id: string) {
  const run = runs.get(id);
  return !run || run.terminated;
}
