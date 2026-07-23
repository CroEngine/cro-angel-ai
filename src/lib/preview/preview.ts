// Prospekt-förhandsvisningens RENA kärna (testbar utan DB/nät): URL-validering,
// rate-limit-beslutet och fynd-mappningen. Trattens topp (ägarmodellen
// 2026-07-23): klistra in URL → se exemplet på SIN egen sida → Stripe-checkout
// ("free until your first verified variant") → installera → samla → bevisa.
//
// Säkerhetshållning: jobben körs av en ISOLERAD Actions-runner (samma mönster
// som day0-svepet), aldrig av prod-servern — men submit-valideringen blockerar
// ändå privata/lokala mål (SSRF-hygien i djupled) och begränsar takt per
// avsändare. Rapporterna landar under o-gissningsbara uuid-nycklar i den
// publika evidence-bucketen.

import { createHash } from "node:crypto";

export type PreviewJobStatus = "queued" | "running" | "ok" | "failed";

/** Max förhandsvisningar per avsändare och dygn — prospekt klistrar 1-2 URL:er;
 *  fler är skrapning. */
export const PREVIEW_MAX_PER_DAY = 3;
/** Ett kö-jobb äldre än så här utan körning är förlegat — arbetaren märker det
 *  failed i stället för att bygga ett exempel ingen längre väntar på. */
export const PREVIEW_STALE_HOURS = 48;

const PRIVATE_HOST_RX =
  /^(localhost|.*\.local|.*\.internal|.*\.lan|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** Validera en prospekt-URL → normaliserad https-URL eller ett vägrans-skäl.
 *  Bara publika http(s)-värdar; allt annat är ärligt "kan inte förhandsvisa". */
export function validatePreviewUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 300) return { ok: false, reason: "too_long" };
  let u: URL;
  try {
    // Prospekt skriver ofta bara "exempel.se" — anta https.
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return { ok: false, reason: "bad_protocol" };
  if (u.username || u.password) return { ok: false, reason: "credentials_in_url" };
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST_RX.test(host)) return { ok: false, reason: "private_host" };
  if (!host.includes(".")) return { ok: false, reason: "not_public" };
  // IPv4-literals: privata spärras ovan; publika literals är nästan alltid
  // skrapmål/misstag i den här tratten — vägra dem också.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return { ok: false, reason: "ip_literal" };
  u.hash = "";
  return { ok: true, url: u.toString() };
}

/** Avsändarnyckel för takt-begränsning: hashad IP — aldrig rå IP i DB. */
export function requesterHash(ip: string | null | undefined): string {
  return createHash("sha256")
    .update(`angel-preview·${ip ?? "unknown"}`)
    .digest("hex")
    .slice(0, 32);
}

/** Rate-limit-beslutet, rent: antal jobb från avsändaren senaste dygnet. */
export function previewAllowed(recentCount: number): boolean {
  return recentCount < PREVIEW_MAX_PER_DAY;
}

/** Fynd-sammanfattningen ur granskningens fynd.json — samma form som day0-
 *  svepets dashboard-kort (rubriker + flytt-testets status). */
export interface PreviewFindings {
  headlines: string[];
  liftTest: string | null;
}

export function mapFindings(fynd: unknown): PreviewFindings | null {
  if (!fynd || typeof fynd !== "object") return null;
  const f = fynd as { fynd?: { rubrik?: unknown; vikt?: unknown }[]; flyttStatus?: unknown };
  const rows = Array.isArray(f.fynd) ? f.fynd : [];
  return {
    headlines: rows
      .filter((r) => typeof r?.rubrik === "string")
      .sort((a, b) => (Number(a?.vikt) || 0) - (Number(b?.vikt) || 0))
      .slice(0, 3)
      .map((r) => r.rubrik as string),
    liftTest: typeof f.flyttStatus === "string" ? f.flyttStatus : null,
  };
}
