# Fix: bara 1 av 3 testimonials markeras + stats/badges syns inte

## Rotorsak (DOM-verifierat på teamtailor.com/sv)

### Bug 1 — `buildSelector` är inte unik (huvudfelet)
Nuvarande implementation:
```js
function buildSelector(el) {
  if (el.id && …) return '#' + el.id;
  const parent = el.parentElement;
  if (parent) {
    const same = […].filter(c => c.tagName === el.tagName);
    return el.tagName.toLowerCase() + ':nth-of-type(' + (idx) + ')';
  }
}
```

Teamtailor har 3 `<figure>` med var sin `<blockquote>`. `nearestBlock(blockquote)` = blockquote. `buildSelector` returnerar `blockquote:nth-of-type(1)` för **alla tre** (varje blockquote är enda blockquote i sin figure). Alla 3 trust signals pushas korrekt i JSON, men overlay-funktionen kör `document.querySelector(sel)` som bara hittar **första** matchen i hela dokumentet → bara 1 box renderas.

Samma bug påverkar review_badges-blocket (`ul:nth-of-type(1)`-liknande selectors) — därför syns inga badges i overlayen.

**Fix:** bygg full path upp till `<body>` eller närmaste `id`, med `:nth-of-type(N)` på varje nivå där det finns syskon med samma tagg:

```js
function buildSelector(el) {
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
  const parts = [];
  let cur = el;
  while (cur && cur !== document.body && cur.nodeType === 1) {
    let part = cur.tagName.toLowerCase();
    if (cur.id && /^[A-Za-z][\w-]*$/.test(cur.id)) {
      parts.unshift('#' + cur.id);
      break;
    }
    const parent = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
    }
    parts.unshift(part);
    cur = cur.parentElement;
  }
  return parts.join('>');
}
```

Producerar `div:nth-of-type(7)>section>div>figure:nth-of-type(2)>blockquote` etc. Garanterat unik (eller åtminstone träffar rätt element vid querySelector).

### Bug 2 — Statistik 845 000 / 200 000 / 10 000 missas

DOM: `<dl>` med separata `<dt>Mer än</dt><dd>845 000</dd><dt>Rekryteringar</dt>` (uppdelat). Tre problem:

a) Regex kräver att tal + nyckelord (`customers|users|kunder|användare|...`) står i **samma textnod**. Här är de syskon.
b) Svenska affärsord saknas: `rekryteringar|rekryterare|företag|kunder|användare|medlemmar|projekt|ordrar|leveranser|jobb|tj[äa]nster`.
c) Inga `<dl>`/`<dt>`/`<dd>` i `blocks`-iterationen.

**Fix:** lägg till en separat scanner-pass efter text-loopen:

```js
// Big-number stat blocks (dl/dt/dd eller div-grupper med stort tal + label)
const STAT_KEYWORDS = /\b(customers|users|members|downloads|reviews|recensioner|kunder|användare|anvandare|medlemmar|nedladdningar|rekryteringar|rekryterare|företag|foretag|projekt|jobb|tjänster|tjanster)\b/i;
const NUM_RX = /^\s*\d{1,3}(?:[ ,.]\d{3})+\+?\s*$|^\s*\d{4,}\+?\s*$/;

document.querySelectorAll('dl, [class*="stat" i], [class*="metric" i], [class*="counter" i]').forEach((container) => {
  // Find children that are large numbers; check if a sibling/neighbor has stat keyword
  const numEls = Array.from(container.querySelectorAll('dd, span, strong, p, div, h1, h2, h3'))
    .filter(e => NUM_RX.test((e.innerText || '').trim()));
  for (const numEl of numEls) {
    const txt = (container.innerText || '').toLowerCase();
    if (!STAT_KEYWORDS.test(txt)) continue;
    const numText = (numEl.innerText || '').trim();
    push('social_proof_count', numText + ' (' + container.innerText.replace(/\s+/g,' ').slice(0,80) + ')',
         numEl, 'text', { reviewCount: safeInt(numText) });
  }
});
```

Anchor på själva nummer-elementet ger 1 box per nummer.

### Bug 3 — Testimonial-quote-detektorns selector
Inte ett detektionsfel — bara konsekvens av Bug 1. När buildSelector är fixad markeras alla 3 blockquote-element.

## Filer som ändras
- `src/lib/tests/scripts/trustSignals.ts`
  - Skriv om `buildSelector` (unik path)
  - Lägg till stat-scanner-pass efter text-loopen
  - Lägg till `safeInt`-användning i nya scannern (redan definierad)

## Verifiering
Köra audit mot teamtailor.com/sv. Förväntat efter fix:
- 3 testimonial-boxar (TE) över alla tre figure-kort
- 3 social_proof_count-boxar (SC) över 845 000 / 200 000 / 10 000
- 1 review_badges-box (RB) över G2-badge-raden

## Inte i scope
- Inga nya badge-mönster
- Inga ändringar av PATTERNS.social_proof_count (den får ligga kvar för fall där tal+label står i samma textnod)
- Ingen overlay-omskrivning på klienten — fixen är i `buildSelector`, overlay-funktionen behöver inte röras
