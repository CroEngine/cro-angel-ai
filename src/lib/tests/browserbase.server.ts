// Thin wrapper around the Browserbase SDK. Session lifecycle only —
// all interaction with the session happens via Stagehand in engine.server.ts.

import Browserbase from "@browserbasehq/sdk";

export interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  liveUrl: string;
  /** Region the session runs in. Every Stagehand attach MUST forward this via
   *  `browserbaseSessionCreateParams: { region }` — Stagehand v3's hosted API
   *  is region-pinned and 400:ar an eu-central-1 session against the default
   *  us-west-2 endpoint (found the hard way, dry-run 2026-07-29). */
  region: BrowserbaseRegion;
}

export type BrowserbaseRegion = "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1";

/** Attribution stamped onto the session as userMetadata — makes sessions
 *  findable in the dashboard and queryable via
 *  `sessions.list({ q: "user_metadata['pipeline']:'freeze'" })` (string
 *  equality only). Total metadata must stay ≤512 chars JSON-stringified. */
export interface SessionMeta {
  /** e.g. "freeze", "app-crawl", "robustness". Defaults to the entry script name. */
  pipeline?: string;
  site?: string;
  runId?: string;
}

export interface CreateSessionOpts {
  advancedStealth?: boolean;
  /** Realistisk desktop-fingerprint (devices/OS/locale). Icke-Enterprise-lever
   *  mot fingerprint-baserad bot-detektering (DataDome m.fl.) — till skillnad
   *  från advancedStealth/os:"mac"/verified mode, som är Enterprise-gatade.
   *  Verifierat tillåtet på vår plan 2026-08-02. Default: av (Browserbases
   *  egen default-fingerprint), så vanliga captures är oförändrade. */
  fingerprint?: boolean;
  /** Proxy exit country, ISO 3166-1 alpha-2 (e.g. "SE"). Unset → Browserbase
   *  default routing, which is best-effort US — so Swedish sites captured
   *  without this see the US-IP web (CMP/geo-gates/i18n differ). Falls back
   *  to env BROWSERBASE_PROXY_COUNTRY, then to default routing. */
  proxyCountry?: string;
  meta?: SessionMeta;
  /** Sessionens default-viewport (render-vägen: 390×844) — se OBS i createSession. */
  viewport?: { width: number; height: number };
}

type Region = BrowserbaseRegion;
const REGIONS: readonly Region[] = ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"];

function getClient() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY missing");
  if (!projectId) throw new Error("BROWSERBASE_PROJECT_ID missing");
  // maxRetries 5 (SDK default 2): the SDK already retries 429/5xx honoring
  // Retry-After — the bump gives burst session-creation (scale runs at full
  // concurrency) enough headroom instead of dying on the first rate spike.
  return { client: new Browserbase({ apiKey, maxRetries: 5 }), projectId };
}

/** Ops/scripts escape hatch (bb-sweep etc.). Keeps this file the single
 *  importer of the SDK. */
export function getBrowserbaseClient() {
  return getClient();
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
// Realistisk desktop-fingerprint. Till skillnad från ADVANCED_STEALTH är
// devices/operatingSystems/locales TILLÅTNA på vår plan (verifierat 2026-08-02
// via stealth-gate-proben: `fingerprint`-objektet accepteras, medan
// advancedStealth och os:"mac" ger 403 "verified mode ... Enterprise").
// Detta ger DataDome/fingerprint-baserade skydd en trovärdig desktop-signatur
// i stället för Browserbases default. Opt-in per caller — vanliga captures rör
// den inte.
const DESKTOP_FINGERPRINT = {
  fingerprint: {
    devices: ["desktop" as const],
    operatingSystems: ["macos" as const, "windows" as const],
    locales: ["en-US"],
  },
};

// Region follows the proxy exit — they must move TOGETHER (browserbase-usage-
// review 2026-07-29): an eu-central-1 browser with default (US-routed) proxies
// crosses the Atlantic twice per page request, and an SE proxy from us-west-2
// once. EU proxy country → Frankfurt; unset/other → API default (us-west-2).
// BROWSERBASE_REGION overrides unconditionally (measurement/rollback knob).
const EU_COUNTRIES: ReadonlySet<string> = new Set([
  "SE",
  "NO",
  "DK",
  "FI",
  "IS",
  "DE",
  "NL",
  "FR",
  "GB",
  "IE",
  "ES",
  "IT",
  "PL",
  "AT",
  "BE",
  "CH",
  "CZ",
  "PT",
  "EE",
  "LV",
  "LT",
]);

function resolveRegion(proxyCountry: string | undefined): Region | undefined {
  const forced = process.env.BROWSERBASE_REGION;
  if (forced) {
    if ((REGIONS as readonly string[]).includes(forced)) return forced as Region;
    console.warn(`[browserbase] ignoring invalid BROWSERBASE_REGION="${forced}"`);
  }
  if (proxyCountry && EU_COUNTRIES.has(proxyCountry)) return "eu-central-1";
  return undefined; // API default (us-west-2)
}

/** Attribution fallback: the entry script's basename ("script:freeze-site").
 *  App call sites pass an explicit pipeline instead. */
function defaultPipeline(): string {
  const entry = process.argv[1];
  const base = entry
    ?.split(/[\\/]/)
    .pop()
    ?.replace(/\.(ts|mts|mjs|js)$/, "");
  return base ? `script:${base}` : "untagged";
}

export async function createSession(opts: CreateSessionOpts = {}): Promise<BrowserbaseSession> {
  const { client, projectId } = getClient();
  const proxyCountry = (opts.proxyCountry ?? process.env.BROWSERBASE_PROXY_COUNTRY)
    ?.trim()
    .toUpperCase();
  const meta = opts.meta ?? {};
  const userMetadata: Record<string, string> = {
    pipeline: meta.pipeline ?? defaultPipeline(),
  };
  if (meta.site) userMetadata.site = meta.site;
  if (meta.runId) userMetadata.runId = meta.runId;

  const base = {
    projectId,
    keepAlive: true,
    timeout: 16 * 60,
    // Geo-styrd residential proxy: default-routningen är best-effort USA, så
    // svenska siter MÅSTE ange proxyCountry för att capturen ska se det svenska
    // besökare ser. Verifierat live 2026-07-29: SE-geo ger svensk exit-IP.
    proxies: proxyCountry
      ? [{ type: "browserbase" as const, geolocation: { country: proxyCountry } }]
      : true,
    region: resolveRegion(proxyCountry),
    userMetadata,
  };
  // OBS viewport: opts.viewport gör måtten till sessionens DEFAULT — och med
  // browserbaseSessionCreateParams satt i attachen består de även efter
  // navigation (kanarie 4 29/7: innerWidth 390 genom hela frysningen).
  // Per-enhet-VÄXLING i robustness-runnern sker fortsatt via Stagehands
  // positionella page.setViewportSize(w, h), efter goto.
  // Opt-in so normal sessions stay on the ungated path (no wasted 403/400
  // round-trip); when a caller requests it we attempt the Enterprise tier and
  // fall back to basic stealth on rejection, so it's ready once the plan allows.
  const wantAdvanced = opts.advancedStealth ?? false;
  const wantFingerprint = opts.fingerprint ?? false;
  const settings = opts.viewport ? { viewport: opts.viewport } : {};
  const fp = wantFingerprint ? DESKTOP_FINGERPRINT : {};
  let session;
  try {
    session = await client.sessions.create({
      ...base,
      browserSettings: wantAdvanced
        ? { ...BASE_STEALTH, ...ADVANCED_STEALTH, ...fp, ...settings }
        : { ...BASE_STEALTH, ...fp, ...settings },
    });
  } catch (err) {
    if (!wantAdvanced) throw err;
    console.warn(
      `[browserbase] advanced stealth rejected (${
        err instanceof Error ? err.message.slice(0, 140) : String(err)
      }); falling back to basic stealth`,
    );
    session = await client.sessions.create({
      ...base,
      browserSettings: { ...BASE_STEALTH, ...fp, ...settings },
    });
  }
  // Inspector link: the session records video + network/console logs by
  // default — this line is what makes them findable from run output.
  console.log(
    `[browserbase] session ${session.id} (${userMetadata.pipeline}` +
      `${userMetadata.site ? ` · ${userMetadata.site}` : ""}` +
      `${proxyCountry ? ` · geo ${proxyCountry}` : ""}` +
      `${session.region ? ` · ${session.region}` : ""}) → ` +
      `https://www.browserbase.com/sessions/${session.id}`,
  );
  const debug = await client.sessions.debug(session.id);
  // Anslutnings-URL:en hämtas EFTER skapandet — Stagehands eget mönster
  // (launch/browserbase.js: sessions.retrieve, aldrig create-svaret).
  // Kanarie 2 29/7: create-URL:en gav connectOverCDP-timeout mot
  // wss://connect.usw2… medan Stagehand nådde samma infrastruktur via
  // retrieve-URL:en minuter tidigare.
  const live = await client.sessions.retrieve(session.id);
  return {
    id: session.id,
    connectUrl: live.connectUrl ?? session.connectUrl,
    liveUrl: debug.debuggerFullscreenUrl ?? debug.debuggerUrl,
    region: session.region,
  };
}

/** Region of an existing session — for Stagehand attaches that only hold a
 *  sessionId (the app's create-in-POST/attach-in-stream handoff). Stagehand's
 *  hosted API is region-pinned, so the attach must know this. Falls back to
 *  undefined (→ Stagehand default us-west-2) if the lookup fails. */
export async function getSessionRegion(sessionId: string): Promise<BrowserbaseRegion | undefined> {
  try {
    const { client } = getClient();
    const session = await client.sessions.retrieve(sessionId);
    return session.region;
  } catch (err) {
    console.warn(
      `[browserbase] sessions.retrieve(${sessionId}) failed (${
        err instanceof Error ? err.message.slice(0, 80) : String(err)
      }); Stagehand attach falls back to default region`,
    );
    return undefined;
  }
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

/** How many concurrent sessions a batch script may use: the project's REAL
 *  entitlement (projects.retrieve().concurrency — verified 25 on 2026-07-29;
 *  the old hard-coded 3 was a fossil) minus a reserve for the interactive
 *  app, bounded by the caller's cap. BROWSERBASE_MAX_SESSIONS overrides the
 *  lookup; API failure falls back to the old conservative 3. */
export async function resolveSessionBudget(
  opts: { reserve?: number; cap?: number } = {},
): Promise<number> {
  const { reserve = 2, cap = Number.POSITIVE_INFINITY } = opts;
  const forced = Number(process.env.BROWSERBASE_MAX_SESSIONS);
  if (Number.isFinite(forced) && forced >= 1) {
    return Math.min(cap, Math.floor(forced));
  }
  try {
    const { client, projectId } = getClient();
    const project = await client.projects.retrieve(projectId);
    const budget = Math.max(1, Math.min(cap, project.concurrency - reserve));
    console.log(
      `[browserbase] plan concurrency ${project.concurrency} → session budget ${budget} (reserve ${reserve})`,
    );
    return budget;
  } catch (err) {
    console.warn(
      `[browserbase] projects.retrieve failed (${
        err instanceof Error ? err.message.slice(0, 80) : String(err)
      }); falling back to session budget 3`,
    );
    return 3;
  }
}
