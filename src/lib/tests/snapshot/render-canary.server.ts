// Render-canary: gate före Fas 2 (font-subsetting).
//
// Verifierar att de cid:-inbäddade fontfilerna FAKTISKT rendrar i replay,
// inte bara "registreras". En FontFace kan ha status='loaded' utan att en
// enda glyf har hämtats; en familj kan vara registrerad i document.fonts
// utan att layouten faktiskt använder den. Vi mäter båda:
//
//   1. document.fonts.check('16px "F"', sample) — har glyfer för texten?
//   2. Bredd-diff mot intentional fallback (monospace) — påverkar familjen
//      layout? Identisk bredd ⇒ Chromium ramlade tillbaka tyst.
//
// Fail-villkor (ok=false):
//   - missing.length > 0                  (förväntad familj saknas helt)
//   - någon family där fontsCheckPass=false OCH widthVsFallback.distinct=false
//
// "Registrerad men oanvänd" loggas i unusedRegistered men gate:ar INTE —
// det är precis vad Fas 2-subsettern ska beskära.

import type { Page } from "playwright";

export interface FamilyReport {
  family: string;
  registered: boolean;
  loadedCount: number;
  totalCount: number;
  fontsCheckPass: boolean;
  widthVsFallback: {
    embedded: number;
    fallback: number;
    diff: number;
    distinct: boolean;
  };
  sampleText: string;
  sampleSource: "dom" | "default";
}

export interface RenderCanaryReport {
  ok: boolean;
  expected: string[];
  diagnostics: {
    documentFontsSize: number;
    documentFontsLoaded: number;
    documentFontsFamilies: string[];
  };
  families: FamilyReport[];
  missing: string[];
  unusedRegistered: string[];
  failures: string[];
  thresholdPx: number;
}

const DEFAULT_SAMPLE = "The quick brown fox jumps over 0123456789";
const DIFF_THRESHOLD_PX = 0.5;

export async function runRenderCanary(
  page: Page,
  expectedFamilies: string[],
  opts: { thresholdPx?: number } = {},
): Promise<RenderCanaryReport> {
  const thresholdPx = opts.thresholdPx ?? DIFF_THRESHOLD_PX;
  // Vänta in fonts-pipen, bäst ansträngning. Misslyckas tyst — vi mäter ändå.
  await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});

  const raw = await page.evaluate(
    ({ families, defaultSample, thresholdPx }) => {
      const all = Array.from(document.fonts as unknown as Iterable<FontFace>);
      const diagnostics = {
        documentFontsSize: document.fonts.size,
        documentFontsLoaded: all.filter((f) => f.status === "loaded").length,
        documentFontsFamilies: Array.from(new Set(all.map((f) => stripQuotes(f.family)))),
      };

      function stripQuotes(s: string): string {
        return s.replace(/^['"]|['"]$/g, "").trim();
      }

      // Plocka en synlig textnod som faktiskt har den givna familjen i sin
      // computed font-family. Säkerställer att vi mäter mot text som sidan
      // verkligen renderar — viktigt för rätt unicode-range subset.
      function sampleForFamily(family: string): { text: string; source: "dom" | "default" } {
        const needle = family.toLowerCase();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n: Node | null = walker.nextNode();
        let scanned = 0;
        while (n && scanned < 5000) {
          scanned++;
          const text = (n.nodeValue || "").trim();
          if (text.length >= 3 && text.length <= 64) {
            const el = n.parentElement;
            if (el) {
              const ff = getComputedStyle(el).fontFamily.toLowerCase();
              if (ff.includes(needle)) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return { text, source: "dom" };
                }
              }
            }
          }
          n = walker.nextNode();
        }
        return { text: defaultSample, source: "default" };
      }

      function measureWidth(text: string, fontFamily: string): number {
        const span = document.createElement("span");
        span.textContent = text;
        span.style.cssText =
          `position:absolute;left:-99999px;top:-99999px;visibility:hidden;` +
          `white-space:pre;font:16px ${fontFamily};letter-spacing:normal;`;
        document.body.appendChild(span);
        const w = span.getBoundingClientRect().width;
        span.remove();
        return w;
      }

      const out = families.map((family) => {
        const familyFaces = all.filter(
          (f) => stripQuotes(f.family).toLowerCase() === family.toLowerCase(),
        );
        const registered = familyFaces.length > 0;
        const loadedCount = familyFaces.filter((f) => f.status === "loaded").length;
        const totalCount = familyFaces.length;
        const { text: sampleText, source } = sampleForFamily(family);
        // Citera familjenamn så CSS-parsern hanterar mellanslag säkert.
        const quoted = `"${family.replace(/"/g, '\\"')}"`;
        let fontsCheckPass = false;
        try {
          fontsCheckPass = document.fonts.check(`16px ${quoted}`, sampleText);
        } catch {
          fontsCheckPass = false;
        }
        const embedded = measureWidth(sampleText, `${quoted}, monospace`);
        const fallback = measureWidth(sampleText, `monospace`);
        const diff = Math.abs(embedded - fallback);
        return {
          family,
          registered,
          loadedCount,
          totalCount,
          fontsCheckPass,
          widthVsFallback: {
            embedded,
            fallback,
            diff,
            distinct: diff > thresholdPx,
          },
          sampleText,
          sampleSource: source,
        };
      });

      return { diagnostics, families: out };
    },
    { families: expectedFamilies, defaultSample: DEFAULT_SAMPLE, thresholdPx },
  );

  const families = raw.families as FamilyReport[];
  const missing = families.filter((f) => !f.registered).map((f) => f.family);
  const unusedRegistered = families
    .filter((f) => f.registered && !f.widthVsFallback.distinct)
    .map((f) => f.family);
  const hardFails = families.filter(
    (f) => f.registered && !f.fontsCheckPass && !f.widthVsFallback.distinct,
  );

  const failures: string[] = [];
  if (missing.length > 0) {
    failures.push(`missing families: ${missing.join(", ")}`);
  }
  for (const f of hardFails) {
    failures.push(
      `family "${f.family}": fonts.check=false AND width identical to fallback ` +
        `(embedded=${f.widthVsFallback.embedded.toFixed(2)}, fallback=${f.widthVsFallback.fallback.toFixed(2)})`,
    );
  }

  return {
    ok: failures.length === 0,
    expected: expectedFamilies,
    diagnostics: raw.diagnostics,
    families,
    missing,
    unusedRegistered,
    failures,
    thresholdPx,
  };
}
