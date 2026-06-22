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

// Stealth defaults applied to every session. Residential proxies + ad-block +
// a desktop OS fingerprint + captcha solving (on by default in the API; set
// explicitly for intent). These are broadly safe and improve capture odds on
// bot-protected sites without changing behaviour on easy ones.
const BASE_STEALTH = {
  blockAds: true,
  solveCaptchas: true,
  os: "mac" as const,
};

export async function createSession(
  opts: { advancedStealth?: boolean } = {},
): Promise<BrowserbaseSession> {
  const { client, projectId } = getClient();
  const base = { projectId, keepAlive: true, timeout: 16 * 60, proxies: true } as const;
  // advancedStealth is the strongest anti-detection tier (PerimeterX/Akamai
  // interstitials) but is Enterprise-plan-gated (verified: 403 on lower tiers).
  // Opt-in so normal sessions don't pay a wasted 403 round-trip; when a caller
  // requests it we attempt it and fall back to basic stealth on rejection, so
  // the capability is ready the moment the plan supports it.
  const wantAdvanced = opts.advancedStealth ?? false;
  let session;
  try {
    session = await client.sessions.create({
      ...base,
      browserSettings: wantAdvanced ? { ...BASE_STEALTH, advancedStealth: true } : BASE_STEALTH,
    });
  } catch (err) {
    if (!wantAdvanced) throw err;
    console.warn(
      `[browserbase] advancedStealth rejected (${
        err instanceof Error ? err.message.slice(0, 140) : String(err)
      }); falling back to basic stealth`,
    );
    session = await client.sessions.create({ ...base, browserSettings: BASE_STEALTH });
  }
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
