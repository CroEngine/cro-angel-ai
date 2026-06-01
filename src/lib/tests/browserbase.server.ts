// Thin wrapper around the Browserbase SDK + raw CDP-over-WebSocket navigation.
// Slice 2.1: no Playwright. We only need create session, get live URL,
// navigate one tab to a URL, and close the session.

import Browserbase from "@browserbasehq/sdk";

export interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  liveUrl: string;
}

function getClient() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY missing");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID missing");
  return { client: new Browserbase({ apiKey }), projectId };
}

export async function createSession(): Promise<BrowserbaseSession> {
  const { client, projectId } = getClient();
  const session = await client.sessions.create({ projectId, keepAlive: true, timeout: 300 });
  const debug = await client.sessions.debug(session.id);
  return {
    id: session.id,
    connectUrl: session.connectUrl,
    liveUrl: debug.debuggerFullscreenUrl ?? debug.debuggerUrl,
  };
}

export async function closeSession(sessionId: string): Promise<void> {
  const { client, projectId } = getClient();
  try {
    await client.sessions.update(sessionId, {
      projectId,
      status: "REQUEST_RELEASE",
    });
  } catch {
    /* already closed or unknown — swallow */
  }
}

/**
 * Navigate the session to `url` via raw CDP. Resolves once the page reports
 * `Page.loadEventFired` (or after `timeoutMs` — whichever first).
 */
export async function navigateViaCDP(
  connectUrl: string,
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; onLog?: (msg: string) => void } = {},
): Promise<void> {
  const { signal, timeoutMs = 30_000, onLog } = opts;
  const log = (m: string) => onLog?.(m);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(connectUrl);
    let nextId = 1;
    const pending = new Map<number, (msg: Record<string, unknown>) => void>();
    let sessionId: string | undefined;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (err) reject(err); else resolve();
    };

    const timer = setTimeout(() => finish(new Error(`navigation timeout after ${timeoutMs}ms`)), timeoutMs);
    const onAbort = () => finish(new Error("aborted"));
    if (signal) {
      if (signal.aborted) { finish(new Error("aborted")); return; }
      signal.addEventListener("abort", onAbort);
    }

    const send = (method: string, params: Record<string, unknown> = {}, sid?: string) => {
      const id = nextId++;
      const payload: Record<string, unknown> = { id, method, params };
      if (sid) payload.sessionId = sid;
      return new Promise<Record<string, unknown>>((res) => {
        pending.set(id, res);
        ws.send(JSON.stringify(payload));
      });
    };

    ws.onopen = async () => {
      try {
        log(`CDP connected, locating existing page target`);
        const targets = (await send("Target.getTargets")) as {
          result?: { targetInfos?: Array<{ targetId: string; type: string }> };
        };
        const pageTarget = targets.result?.targetInfos?.find((t) => t.type === "page");
        if (!pageTarget) throw new Error("no existing page target found in session");
        const attached = (await send("Target.attachToTarget", {
          targetId: pageTarget.targetId,
          flatten: true,
        })) as { result?: { sessionId?: string } };
        sessionId = attached.result?.sessionId;
        if (!sessionId) throw new Error("Target.attachToTarget did not return a sessionId");
        await send("Page.enable", {}, sessionId);
        log(`navigating existing tab to ${url}`);
        await send("Page.navigate", { url }, sessionId);
        log("awaiting load event");
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const data = typeof ev.data === "string" ? ev.data : "";
        if (!data) return;
        const msg = JSON.parse(data) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          sessionId?: string;
        };
        if (typeof msg.id === "number") {
          const cb = pending.get(msg.id);
          if (cb) {
            pending.delete(msg.id);
            cb(msg as unknown as Record<string, unknown>);
          }
          return;
        }
        if (msg.method === "Page.loadEventFired" && msg.sessionId === sessionId) {
          log("page load fired");
          finish();
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => finish(new Error("CDP websocket error"));
    ws.onclose = () => {
      if (!settled) finish(new Error("CDP websocket closed before load"));
    };
  });
}
