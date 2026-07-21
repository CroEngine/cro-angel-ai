// Domänverifiering (ren logik — löv-modul, inga imports).
//
// Ingest-nyckeln står i sajtens publika HTML: den identifierar sajten men
// bevisar ingenting. Beviset på kontroll är att trafiken kommer från sajtens
// egen domän — webbläsaren sätter Origin på cross-origin-POST:ar och den kan
// inte förfalskas från en annan sida. Semantik:
//
//   * Ingen registrerad domän (legacy/labb)  → tillåt (som före lanseringen).
//   * Registrerad domän + matchande Origin   → tillåt + "bevisad" (stämplas).
//   * Registrerad domän + AVVIKANDE Origin   → neka. Fail-closed på motbevis.
//   * Registrerad domän + INGEN Origin/Referer → tillåt utan bevis. Fail-open
//     på frånvaro: gamla webbläsare/ombud kan strippa headers, och att tappa
//     legitim trafik är dyrare än att släppa in ostämplad — serving kräver
//     ändå stämpeln, så ostämplad trafik kan aldrig ändra någons sida.
//   * Loopback (localhost/127.0.0.1/[::1])   → tillåt utan bevis (dev).

export interface OriginVerdict {
  allowed: boolean;
  /** True bara vid ÄKTA värdmatchning — det som får stämpla domain_verified_at. */
  proved: boolean;
}

/** Normalisera en domän-inmatning: URL eller värdnamn in → "exempel.se" ut
 *  (gemener, utan protokoll/port/sökväg/avslutande punkt, utan ledande www.).
 *  Ogiltig inmatning → null. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = new URL(s).hostname;
    else s = new URL(`https://${s}`).hostname;
  } catch {
    return null;
  }
  s = s.replace(/\.$/, "").replace(/^www\./, "");
  // Minst en punkt (tld) och inga blanksteg — "exempel" är inte en domän.
  if (!s.includes(".") || /\s/.test(s)) return null;
  return s;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Värden ur en Origin- eller Referer-header, eller null. */
export function headerHost(value: string | null | undefined): string | null {
  if (!value || value === "null") return null; // Origin: null = sandboxad kontext
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Matchar värden domänen? Exakt eller äkta underdomän (shop.exempel.se). */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Grind-beslutet för en ingest-förfrågan. Ren; aldrig throw. */
export function originVerdict(
  siteDomain: string | null | undefined,
  originHeader: string | null | undefined,
  refererHeader: string | null | undefined,
): OriginVerdict {
  const domain = normalizeDomain(siteDomain);
  if (!domain) return { allowed: true, proved: false }; // legacy/labb — ingen domän att bevisa
  const host = headerHost(originHeader) ?? headerHost(refererHeader);
  if (!host) return { allowed: true, proved: false }; // frånvaro ≠ motbevis
  if (LOOPBACK.has(host)) return { allowed: true, proved: false }; // dev
  if (hostMatchesDomain(host, domain)) return { allowed: true, proved: true };
  return { allowed: false, proved: false }; // motbevis — fail closed
}
