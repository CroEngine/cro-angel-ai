// Datahygien (revisionen 2026-07-20, 38 verifierade fynd): läs-tidsrensning av
// känd förorening i eventdatan. RADERAR ALDRIG — rådatan är orörd så varje
// beslut här kan omprövas. Samma filter appliceras i ALLA läsvägar (dashboard-
// fönstret, motorns boost-feedback) och speglas i SQL-vyn angel_events_clean
// som segment-/arm-RPC:erna läser (håll listorna i synk med migrationen
// 20260720100000_angel_events_clean.sql).
//
// Generella regler (alla sajter):
//   - /admin-sidor är ägaren per definition — aldrig besöksdata.
//   - paths med angel_-params är simulator-/verktygskörningar.
//   - payload.simulated=true sätts av snippeten vid demo-overrides.
//   - conversion-dubbletter (samma session/besökare+decision inom 5 s) var
//     dubbelloggning av ETT klick — behåll första raden.
// Sajtspecifika listor (piloten): verifierade lasttest-fönster, ägar-/dev-
// hashar och simulatorkällor ur revisionen.

import type { DashEvent } from "./aggregate";

interface SiteHygiene {
  /** Verifierade syntetiska tidsfönster [från, till] (ms epoch, inklusive). */
  windows: Array<[number, number]>;
  /** Ägar-/utvecklar-hashar (bevisade + hög sannolikhet, se revisionen). */
  visitorHashes: ReadonlySet<string>;
  /** Kända ägarsessioner (bälte till hängslena ovan). */
  sessionIds: ReadonlySet<string>;
  /** Källor som ENBART demo-simulatorn kan ha skapat — hela sessionen ryker. */
  simulatorSources: ReadonlySet<string>;
  /** OWNER-2: konverteringssignalen (conversion/cta_click) var 100 % ägare/
   *  test fram till detta datum — nollställs före gränsen (ms epoch). */
  conversionsPoisonedBefore?: number;
}

const w = (from: string, to: string): [number, number] => [Date.parse(from), Date.parse(to)];

/** glutenforum.se — pilotens revisionslistor (wf_1da0becb, 2026-07-20).
 *  Fönstren fångar exakt de tre lasttest-burstarna (skeptikerverifierat:
 *  652 events, 0 oskyldiga innanför, burst-hasharna finns aldrig utanför). */
const GLUTENFORUM: SiteHygiene = {
  windows: [
    w("2026-07-07T20:45:00Z", "2026-07-07T20:46:30Z"),
    w("2026-07-10T06:24:00Z", "2026-07-10T06:26:30Z"),
    w("2026-07-11T12:56:00Z", "2026-07-11T12:58:30Z"),
  ],
  visitorHashes: new Set([
    // Bevisade (admin-inloggning / känd ägarsession):
    "ed3badd9-c7fe-40c2-aa4d-b0efd6048121",
    "bdc609d4-566e-45ee-bee6-85d173793649",
    "8d0fcc03-fbac-4541-8a33-aa92c7cc428d",
    "8c9da99e-d861-4b0d-9f41-03ea5744f0a9",
    "993269b5-034d-41c6-a158-d1debac8bdf2",
    "c5657fa3-ab60-4ca3-b808-206d6e72c046",
    // Hög sannolikhet (ägarens direct-'/'-mönster, dag-1-aktivitet):
    "018fd2d1-7d43-4cb8-ac1b-083eb6ff06a6",
    "8caf653f-88b3-487e-8197-d1e1a9054bbf",
    "3d34e125-11b4-4ef5-b44d-f24fd244c4d9",
    "ccb6e017-cc26-401f-8e4e-bc424124bc87",
    "3aa6b231-5a3e-4733-a931-a5e32c901e64",
    "b41f477b-c549-4782-8255-4ed654c3bf7f",
  ]),
  sessionIds: new Set(["4f5da1d5-3d83-4e21-9c77-08fcda495706"]),
  simulatorSources: new Set(["twitter", "bing"]),
  conversionsPoisonedBefore: Date.parse("2026-07-20T00:00:00Z"),
};

const BY_SITE: Record<string, SiteHygiene> = { "glutenforum.se": GLUTENFORUM };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Rensa ett event-fönster. Ren funktion; ordningen på raderna bevaras. */
export function cleanEvents(site: string, events: DashEvent[]): DashEvent[] {
  const cfg = BY_SITE[site];

  // Pass 1: sessioner vars ENTRÉ bär en simulatorkälla ryker i sin helhet —
  // deras klick/scroll är lika syntetiska som pageviewen.
  const simulatorSessions = new Set<string>();
  if (cfg) {
    for (const e of events) {
      if (e.type !== "pageview") continue;
      const sid = str(e.payload.sessionId);
      if (sid && cfg.simulatorSources.has(str(e.payload.trafficSource))) {
        simulatorSessions.add(sid);
      }
    }
  }

  // Pass 2: radfilter + conversion-dedup (första raden per nyckel vinner;
  // events kommer nyaste-först från läsvägen, så sortera nycklarna på tid).
  const convSeen = new Map<string, number[]>();
  const out: DashEvent[] = [];
  for (const e of events) {
    const path = str(e.payload.path);
    if (path.startsWith("/admin")) continue;
    if (path.includes("angel_")) continue;
    if (e.payload.simulated === true) continue;
    if (cfg) {
      const t = Date.parse(e.createdAt);
      if (Number.isFinite(t) && cfg.windows.some(([a, b]) => t >= a && t <= b)) continue;
      if (e.visitorHash && cfg.visitorHashes.has(e.visitorHash)) continue;
      const sid = str(e.payload.sessionId);
      if (sid && (cfg.sessionIds.has(sid) || simulatorSessions.has(sid))) continue;
      if (e.type === "pageview" && cfg.simulatorSources.has(str(e.payload.trafficSource)))
        continue; // sessionslösa legacy-pageviews med simulatorkälla
      if (
        cfg.conversionsPoisonedBefore !== undefined &&
        (e.type === "conversion" || e.type === "cta_click") &&
        Number.isFinite(t) &&
        t < cfg.conversionsPoisonedBefore
      )
        continue;
    }
    if (e.type === "conversion") {
      const key = `${str(e.payload.sessionId) || e.visitorHash || "?"}:${e.decisionId ?? ""}`;
      const t = Date.parse(e.createdAt);
      const seen = convSeen.get(key) ?? [];
      if (Number.isFinite(t) && seen.some((s) => Math.abs(s - t) <= 5000)) continue;
      if (Number.isFinite(t)) {
        seen.push(t);
        convSeen.set(key, seen);
      }
    }
    out.push(e);
  }
  return out;
}
