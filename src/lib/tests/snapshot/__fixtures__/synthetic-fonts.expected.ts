// Förväntningar för __fixtures__/synthetic-fonts.mhtml.
//
// Pinnade named constants — vid drift kommer Test 1 i
// __tests__/harvest-font-urls.test.ts misslyckas med en deterministisk diff.
// MULTI-fallet räknar `multi.woff2` + `multi.woff` som TVÅ distinkta tokens
// (de delar face men är separata url()-tokens) → relativeResolved: 5.

export const SYNTHETIC_FIXTURE_EXPECTED = {
  // Per-hink token-occurrence-räknare (samma semantik som FontEmbedResult.fontUrlSummary).
  counts: {
    embedded: 2,
    absolute: 2,
    relativeResolved: 5,
  },
  unresolvable: [
    { original: "nobase.woff2", reason: "no-base" },
    { original: "invalid.woff2", reason: "invalid-base" },
  ] as const,
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
  } as const,
  embeddedOriginals: [
    "data:font/woff2;base64,AAAA",
    "cid:font-synth-cid@snapshot",
  ] as const,
} as const;
