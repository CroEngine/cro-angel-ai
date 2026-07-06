// Förväntningar för __fixtures__/synthetic-fonts.mhtml.
//
// Pinnade named constants — vid drift kommer Test 1 i
// __tests__/harvest-font-urls.test.ts misslyckas med en deterministisk diff.
// MULTI-fallet räknar `multi.woff2` + `multi.woff` som TVÅ distinkta tokens
// (de delar face men är separata url()-tokens) → del av relativeResolved.
//
// docBase-fallbacken (nextory-fixen): en part vars Content-Location saknas
// eller inte duger som URL-bas får sina relativa url() lösta mot DOKUMENTETS
// URL — webbläsarsemantiken för constructed stylesheets, vars MHTML-parts har
// opaka cid:-Content-Locations. Fixturens nobase/invalid-parts resolvar därför
// numera (hink 3) istället för att hamna i hink 4. Producent-nivåns hink 4
// kräver nu att BÅDA baserna är obrukbara; primitiven (harvestFontUrls utan
// docBase) pinnar fortfarande no-base/invalid-base i sina egna tester.

export const SYNTHETIC_FIXTURE_EXPECTED = {
  // Per-hink token-occurrence-räknare (samma semantik som FontEmbedResult.fontUrlSummary).
  counts: {
    embedded: 2,
    absolute: 2,
    relativeResolved: 7,
  },
  unresolvable: [] as ReadonlyArray<{
    original: string;
    reason: "no-base" | "invalid-base";
  }>,
  // original-token → resolved (post-classify). Pekar exakt på vad Chromium
  // skulle fetcha vid replay om vi inte hade cid:-rewriten.
  resolved: {
    "/fonts/a.woff2": "https://synthetic.test/fonts/a.woff2",
    "b.woff2": "https://synthetic.test/assets/b.woff2",
    "../shared/c.woff2": "https://synthetic.test/shared/c.woff2",
    "https://synthetic.test/e1.woff2": "https://synthetic.test/e1.woff2",
    "https://synthetic.test/e2.woff2": "https://synthetic.test/e2.woff2",
    "/fonts/multi.woff2": "https://synthetic.test/fonts/multi.woff2",
    "/fonts/multi.woff": "https://synthetic.test/fonts/multi.woff",
    // docBase-fallback (dokumentets URL är https://synthetic.test/index.html):
    "nobase.woff2": "https://synthetic.test/nobase.woff2",
    "invalid.woff2": "https://synthetic.test/invalid.woff2",
  } as const,
  embeddedOriginals: [
    "data:font/woff2;base64,AAAA",
    "cid:font-synth-cid@snapshot",
  ] as const,
} as const;
