## Kör bryggan

Allt är på plats i koden (mhtml-fonts.server.ts, fetch-records.test.ts, breadth-smoke.ts) och vitest-sviten är grön förutom de två kända pre-existerande Chromium-buggarna.

Sista steget: kör `scripts/breadth-smoke.ts` mot Chromium + livenät och läs första `divergence_inline_present_render_miss` ur output / `harmonization-diff.json`.

### Steg
1. Kör `bun run scripts/breadth-smoke.ts` med timeout ~10 min.
2. Fånga stdout/stderr och dump-filerna (`harmonization-diff.json` m.fl.).
3. Rapportera första divergence-raden ordagrant — det är svaret vi jagat sedan Lexend Deca.
4. Om sum-asserten i buildFamilyView-join:en triggar: rapportera familjen + URL och stanna (det är förväntad hård krasch enligt din spec).

Ingen kodändring i detta steg — bara körning och avläsning.