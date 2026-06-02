// Thin wrapper around the Browserbase SDK. Session lifecycle only —
// all interaction with the session happens via Stagehand in engine.server.ts.

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
  const session = await client.sessions.create({
    projectId,
    keepAlive: true,
    timeout: 16 * 60,
    proxies: true, // residential proxies — helps past Cloudflare/anti-bot challenges
  });
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
