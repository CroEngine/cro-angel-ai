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

// Stealth applied to every session. Only ungated options here: residential
// proxies + ad-block + captcha solving (on by default in the API; explicit for
// intent). These are safe on any plan and don't change behaviour on easy sites.
// NOTE: the OS fingerprint (`os`) is Enterprise-gated exactly like
// advancedStealth/verified ("400 mac OS is only available for verified users"),
// so it lives in ADVANCED_STEALTH, never in the always-on defaults — putting it
// here breaks every freeze on a non-Enterprise plan.
const BASE_STEALTH = {
  blockAds: true,
  solveCaptchas: true,
};
// Enterprise-gated anti-detection (PerimeterX/Akamai interstitials). Attempted
// only when a caller opts in; falls back to BASE_STEALTH if the API rejects it.
const ADVANCED_STEALTH = {
  advancedStealth: true,
  os: "mac" as const,
};

export async function createSession(
  opts: { advancedStealth?: boolean } = {},
): Promise<BrowserbaseSession> {
  const { client, projectId } = getClient();
  const base = { projectId, keepAlive: true, timeout: 16 * 60, proxies: true } as const;
  // Opt-in so normal sessions stay on the ungated path (no wasted 403/400
  // round-trip); when a caller requests it we attempt the Enterprise tier and
  // fall back to basic stealth on rejection, so it's ready once the plan allows.
  const wantAdvanced = opts.advancedStealth ?? false;
  let session;
  try {
    session = await client.sessions.create({
      ...base,
      browserSettings: wantAdvanced ? { ...BASE_STEALTH, ...ADVANCED_STEALTH } : BASE_STEALTH,
    });
  } catch (err) {
    if (!wantAdvanced) throw err;
    console.warn(
      `[browserbase] advanced stealth rejected (${
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
