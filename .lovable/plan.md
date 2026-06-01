## Mål

Få overlays att sitta exakt på rätt plats i Frozen-vyn genom att använda screenshotens faktiska pixeldimensioner som referens — inte våra egna mätningar av `innerWidth` / `scrollHeight` som kan glida ifrån vad Playwright faktiskt renderar.

## Ändring (endast `src/lib/tests/engine.server.ts`)

### 1. Lägg till JPEG-dimensionsläsare

En liten hjälpare högst upp i filen (efter imports):

```ts
function readJpegDimensions(buf: Buffer): { w: number; h: number } | null {
  // JPEG börjar med FFD8. Scanna efter SOFn-markörer:
  // 0xFFC0–C3, C5–C7, C9–CB, CD–CF (alla utom DHT/JPG/DAC).
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // hoppa över padding-FF
    if (marker === 0xff) { i++; continue; }
    // SOFn-markörer
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    // hoppa över segment
    const segLen = buf.readUInt16BE(i + 2);
    i += 2 + segLen;
  }
  return null;
}
```

Ren JS, inga deps.

### 2. Skriv om screenshot-blocket (rad ~224–243)

```ts
let screenshot: { dataUrl: string; viewport: { w: number; h: number } } | undefined;
try {
  const buf = await page.screenshot({ type: "jpeg", quality: 50, fullPage: true });

  // Försök läsa faktiska bildmått ur JPEG-bufferten — autoritativ källa.
  const dims = readJpegDimensions(Buffer.from(buf));
  let vp: { w: number; h: number };
  if (dims) {
    vp = dims;
  } else {
    // Fallback: våra egna mätningar.
    const win = (await page.evaluate<{ w: number; h: number }>(
      "({ w: window.innerWidth, h: window.innerHeight })",
    )) ?? { w: 1280, h: 720 };
    const docH = (await page.evaluate<number>(
      "document.documentElement.scrollHeight",
    )) ?? win.h;
    vp = { w: win.w, h: Math.max(docH, win.h) };
  }

  const b64 = Buffer.from(buf).toString("base64");
  screenshot = {
    dataUrl: `data:image/jpeg;base64,${b64}`,
    viewport: vp,
  };

  const kb = Math.round(buf.length / 1024);
  onEvent({ type: "log", message: `screenshot captured (${kb}kb, ${vp.w}×${vp.h}${dims ? "" : " · fallback dims"})` });

  // Varning om payload blir orimligt stor — signal för framtida storage-upload.
  if (buf.length > 6 * 1024 * 1024 || vp.h > 10000) {
    onEvent({ type: "log", message: `warn: screenshot is large (${kb}kb, ${vp.h}px tall) — consider storage-upload soon` });
  }
} catch (e) {
  onEvent({ type: "log", message: `screenshot failed: ${e instanceof Error ? e.message : String(e)}` });
}
```

### 3. Det här tas bort

- 8000-clampen på höjden (Playwright tar ändå hela sidan — bättre att matcha verkligheten + varna).
- Egna `window.innerWidth` / `scrollHeight`-mätningarna som primär källa (degraderas till fallback).

## Inga andra filer

`Viewport.tsx`, `BrowserShell.tsx`, `UrlBar.tsx`, hooks, run.functions, collect-koden: orörda. Overlay-renderingen är redan korrekt så länge `viewport.w/h` matchar bilden.

## Trade-offs

- Tappar 8000-clamp som säkerhetsnät. Mycket långa sidor (10k+ px) ger stora SSE-payloads.
- Mitigeras av ny varningslogg → vi ser direkt när det är dags för storage-upload-patchen.

## Uppföljningar (inte här)

- Storage-upload av screenshots, skicka URL i SSE istället för data-URL.
- Klickbara overlays (CRO-inspector).
- Toggle "Fit översikt" / "100%".
