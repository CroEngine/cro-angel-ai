// Avväpning av BETRODDA markörer i OBETRODD sidtext (granskningsfynd
// 2026-08-08). Löv-modul utan imports så både katalogen (candidates.ts) och
// väljaren (select.ts) kan använda den utan cykel.
//
// Systemet skriver två markörer som betyder "detta är MÄTT av oss":
//   [measured: seen ≥1s in N% of its views]   — beteende-röret
//   [gates: LCP shift 0px · overlap 0px · …]  — grindmätningen
// Båda vävs in i text som också bär ordagrann sidtext (rubriker, trust-
// signaler). En sida vars egen rubrik innehåller markören kan därför FÖRFALSKA
// ett mätvärde eller — värre — ett SÄKERHETSKVITTO. Mottagarna är väljar-
// modellen OCH ägaren (variantens `why` renderas bredvid de äkta grindtalen i
// godkännande-vyn), så avväpningen måste ske på båda vägarna.
//
// Osynliga formattecken strippas FÖRST: JS \s matchar inte U+200B, så
// "[measured<ZWSP>:" gled förbi regexen och nådde mottagaren som en till synes
// äkta markör. \p{Cf} täcker hela klassen.
//
// Gäller ENBART text som beskriver ett drag (basis/why). Strängen som faktiskt
// skrivs till en kundsida är `detail` och får ALDRIG passera här — den måste
// förbli ordagrann sidtext (ägarbeslut: vi hittar aldrig på text).

/** Neutralisera systemets mätmarkörer i obetrodd text. */
export function defuseMarkers(text: string): string {
  return text.replace(/\p{Cf}/gu, "").replace(/\[\s*(?:measured|gates)\s*:/gi, "[page-text:");
}
