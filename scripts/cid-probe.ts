/**
 * cid-probe: bevisar varför FontFace.load() rejectar i file://-MHTML.
 *
 * Öppnar $BREADTH_ROOT/intercom/page.mhtml (default fixtures/breadth-corpus/) i pinnad Chromium och loggar:
 *   - document.fonts.size + descriptor-familjenamn
 *   - första cid:-URL ur @font-face src
 *   - fetch(cidUrl) status / error
 *   - new FontFace(name, src).load() resultat
 *   - performance resource entries för cid:
 */
import { chromium } from "playwright";
import { writeFileSync, existsSync } from "node:fs";

const MHTML = process.argv[2] || `${process.env.BREADTH_ROOT ?? "fixtures/breadth-corpus"}/intercom/page.mhtml`;
if (!existsSync(MHTML)) {
  console.error(`MHTML missing: ${MHTML}`);
  process.exit(1);
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => console.log(`[page:${m.type()}]`, m.text()));
  page.on("requestfailed", (r) =>
    console.log(`[reqfail] ${r.url()} :: ${r.failure()?.errorText}`),
  );
  await page.goto(`file://${MHTML}`, { waitUntil: "load" });
  await page.waitForTimeout(800);

  const probe = await page.evaluate(async () => {
    const stripQ = (s: string) => s.replace(/^['"]|['"]$/g, "").trim();
    const all = Array.from(document.fonts as unknown as Iterable<FontFace>);
    const descriptors = all.map((f) => ({
      family: stripQ(f.family),
      status: f.status,
      // FontFace.source isn't standard; cssText is via CSSFontFaceRule. Skip.
    }));

    // Walk all stylesheets to find @font-face src URLs.
    const faceRules: Array<{ family: string; srcSnippet: string; urls: string[] }> = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        // CSSRule.FONT_FACE_RULE = 5
        if (rule.type !== 5) continue;
        const r = rule as CSSFontFaceRule;
        const family = stripQ(r.style.getPropertyValue("font-family"));
        const src = r.style.getPropertyValue("src");
        const urls = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map(
          (m) => m[2],
        );
        faceRules.push({ family, srcSnippet: src.slice(0, 200), urls });
      }
    }

    const cidUrls = Array.from(
      new Set(faceRules.flatMap((r) => r.urls.filter((u) => u.startsWith("cid:")))),
    );

    const fetchProbes: Array<{ url: string; ok?: boolean; status?: number; err?: string; bytes?: number; type?: string }> = [];
    for (const u of cidUrls.slice(0, 3)) {
      try {
        const res = await fetch(u);
        const buf = await res.arrayBuffer();
        fetchProbes.push({
          url: u,
          ok: res.ok,
          status: res.status,
          bytes: buf.byteLength,
          type: res.headers.get("content-type") ?? undefined,
        });
      } catch (e) {
        fetchProbes.push({ url: u, err: e instanceof Error ? e.message : String(e) });
      }
    }

    const loadProbes: Array<{ family: string; url: string; ok?: boolean; err?: string }> = [];
    for (const r of faceRules.slice(0, 3)) {
      const cidUrl = r.urls.find((u) => u.startsWith("cid:"));
      if (!cidUrl) continue;
      try {
        const ff = new FontFace(`__probe_${r.family}`, `url("${cidUrl}")`);
        await ff.load();
        loadProbes.push({ family: r.family, url: cidUrl, ok: true });
      } catch (e) {
        loadProbes.push({
          family: r.family,
          url: cidUrl,
          ok: false,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const cidResources = performance
      .getEntriesByType("resource")
      .filter((e) => e.name.startsWith("cid:"))
      .map((e) => ({ name: e.name, duration: e.duration, transferSize: (e as PerformanceResourceTiming).transferSize }));

    return {
      url: location.href,
      documentFontsSize: document.fonts.size,
      descriptors: descriptors.slice(0, 40),
      faceRulesCount: faceRules.length,
      faceRulesSample: faceRules.slice(0, 5),
      cidUrls: cidUrls.slice(0, 10),
      fetchProbes,
      loadProbes,
      cidResources,
    };
  });

  writeFileSync("/tmp/cid-probe.json", JSON.stringify(probe, null, 2));
  console.log("\n=== cid-probe summary ===");
  console.log("URL:", probe.url);
  console.log("document.fonts.size:", probe.documentFontsSize);
  console.log("@font-face rules:", probe.faceRulesCount);
  console.log("cid: URLs (unique, first 10):", probe.cidUrls);
  console.log("\nfetch probes:");
  for (const p of probe.fetchProbes) console.log(" ", p);
  console.log("\nFontFace.load probes:");
  for (const p of probe.loadProbes) console.log(" ", p);
  console.log("\ncid: in performance resources:", probe.cidResources.length);
  console.log("\nFull JSON: /tmp/cid-probe.json");
} finally {
  await browser.close();
}
