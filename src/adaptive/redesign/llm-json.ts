// Robust parse av en JSON-ARRAY ur ett LLM-svar. Haiku lyder oftast "raw JSON
// only", men wrappar ibland svaret i en ```json-fence eller lägger prosa runt
// ("Here is the JSON:\n```json\n[...]\n```"). Den gamla fence-strippen
// (/^```(json)?|```$/g) dög bara när fencen låg PRECIS vid sträng-start/slut —
// en inledande radbrytning eller preamble lämnade en backtick kvar och
// JSON.parse föll ("Unrecognized token '`'", 200-sajts render-körningen
// 2026-07-25), vilket tyst fällde section-typern/rankningen till golv-only på de
// sajterna. Strippa alla fences, försök parsa hela, och fall tillbaka på den
// yttersta [...]-arrayen. Returnerar null om inget giltigt går att få ut —
// aldrig ett kast (anroparna är fail-open).
export function parseJsonArray(text: string): unknown {
  const cleaned = text.replace(/```json\s*|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf("[");
    const e = cleaned.lastIndexOf("]");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
