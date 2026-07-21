#!/usr/bin/env bun
// FLEET SHOTS GALLERY — a self-contained, theme-aware before/after gallery from
// the live crawl (scripts/fleet-shots/run.ts). Each card is a drag-to-reveal
// before/after of the REAL engine adapting that site, with the applied
// primitives, the automated visual-acceptance result, and clean-restore proof.
// Images are downscaled + re-encoded via local Chromium so the whole gallery is
// one light, offline HTML.
//
//   bun run scripts/fleet-shots/gallery.ts   →  docs/fleet-shots-2026-07-21/gallery.html

import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = "docs/fleet-shots-2026-07-21";
const IMG = `${DIR}/img`;
const MAX_W = 640;

type Rec = {
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  applied?: string[];
  segment?: string;
  visualIssues?: string[];
  restoredClean?: boolean;
  changed?: boolean;
  before?: string;
  after?: string;
};

const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as { records: Rec[] };
const recs = manifest.records;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();

async function shrink(file: string): Promise<string | null> {
  const path = `${IMG}/${file}`;
  if (!existsSync(path)) return null;
  const full = "data:image/jpeg;base64," + readFileSync(path).toString("base64");
  return page.evaluate(
    ([src, maxW]) =>
      new Promise<string>((resolve) => {
        const im = new Image();
        im.onload = () => {
          const scale = Math.min(1, (maxW as number) / im.naturalWidth);
          const c = document.createElement("canvas");
          c.width = Math.round(im.naturalWidth * scale);
          c.height = Math.round(im.naturalHeight * scale);
          c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.55));
        };
        im.onerror = () => resolve("");
        im.src = src as string;
      }),
    [full, MAX_W] as const,
  );
}

// Build per-card payloads (downscaled images inline).
const cards: Array<Rec & { beforeUri?: string; afterUri?: string }> = [];
for (const r of recs) {
  const card: Rec & { beforeUri?: string; afterUri?: string } = { ...r };
  if (r.ok && r.before && r.after) {
    card.beforeUri = (await shrink(r.before)) ?? undefined;
    card.afterUri = (await shrink(r.after)) ?? undefined;
  }
  cards.push(card);
  process.stdout.write(".");
}
await browser.close();
console.log("");

const okN = recs.filter((r) => r.ok).length;
const changed = recs.filter((r) => r.changed).length;
const clean = recs.filter((r) => r.ok && r.restoredClean).length;
const issues = recs.filter((r) => r.ok && r.visualIssues && r.visualIssues.length).length;
const failed = recs.filter((r) => !r.ok).length;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const payload = JSON.stringify(cards);

const html = `<title>Angel Adaptive — before/after across ${recs.length} live sites</title>
<style>
  :root{--bg:#F6F7F9;--surface:#FFFFFF;--surface-2:#FBFBFC;--ink:#1A2230;--ink-2:#55606F;--ink-3:#8A94A3;--line:#E4E7EC;--line-2:#EEF0F3;--accent:#3F4CD6;--good:#0B8276;--good-bg:#E7F4F1;--warn:#B45309;--warn-bg:#FBF0E3;--crit:#C0342B;--crit-bg:#FBE9E7;}
  @media (prefers-color-scheme:dark){:root{--bg:#0C1116;--surface:#12171E;--surface-2:#161C24;--ink:#E7ECF2;--ink-2:#A3AEBC;--ink-3:#6B7686;--line:#232B35;--line-2:#1C232C;--accent:#8A93F0;--good:#2DBFAD;--good-bg:#0F2420;--warn:#E0A05A;--warn-bg:#2A2015;--crit:#EE7A6E;--crit-bg:#2A1614;}}
  :root[data-theme="dark"]{--bg:#0C1116;--surface:#12171E;--surface-2:#161C24;--ink:#E7ECF2;--ink-2:#A3AEBC;--ink-3:#6B7686;--line:#232B35;--line-2:#1C232C;--accent:#8A93F0;--good:#2DBFAD;--good-bg:#0F2420;--warn:#E0A05A;--warn-bg:#2A2015;--crit:#EE7A6E;--crit-bg:#2A1614;}
  :root[data-theme="light"]{--bg:#F6F7F9;--surface:#FFFFFF;--surface-2:#FBFBFC;--ink:#1A2230;--ink-2:#55606F;--ink-3:#8A94A3;--line:#E4E7EC;--line-2:#EEF0F3;--accent:#3F4CD6;--good:#0B8276;--good-bg:#E7F4F1;--warn:#B45309;--warn-bg:#FBF0E3;--crit:#C0342B;--crit-bg:#FBE9E7;}
  *{box-sizing:border-box;}
  body{background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:26px 20px 70px;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:20px;}
  .eyebrow{text-transform:uppercase;letter-spacing:.09em;font-size:11px;font-weight:650;color:var(--accent);}
  h1{font-size:24px;font-weight:660;letter-spacing:-.02em;margin:6px 0;text-wrap:balance;}
  header p{color:var(--ink-2);max-width:80ch;margin:0;}
  .stats{display:flex;flex-wrap:wrap;gap:10px;}
  .stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:120px;}
  .stat b{font-size:22px;font-weight:680;display:block;letter-spacing:-.01em;}
  .stat span{font-size:12px;color:var(--ink-3);}
  .toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
  .toolbar .sp{flex:1;}
  .chip{font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:99px;padding:5px 12px;cursor:pointer;user-select:none;}
  .chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;}
  input.search{font:inherit;padding:6px 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);min-width:150px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px;}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
  .ba{position:relative;width:100%;aspect-ratio:1200/840;background:var(--surface-2);overflow:hidden;cursor:ew-resize;touch-action:none;user-select:none;}
  .ba img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;display:block;}
  .ba img.after{clip-path:inset(0 0 0 50%);z-index:1;}
  .ba .tag{position:absolute;top:8px;font-size:10px;font-weight:700;letter-spacing:.08em;padding:2px 7px;border-radius:5px;color:#fff;background:rgba(20,26,34,.72);z-index:2;}
  .ba .tag.b{left:8px;} .ba .tag.a{right:8px;background:var(--accent);}
  .ba .handle{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);left:50%;pointer-events:none;z-index:2;}
  .ba .handle::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;background:var(--accent);box-shadow:0 1px 6px rgba(0,0,0,.3);}
  .meta{padding:11px 13px;display:flex;flex-direction:column;gap:7px;}
  .meta .row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
  .meta .site{font-weight:660;font-size:14px;}
  .meta .site a{color:inherit;text-decoration:none;}
  .pill{font-size:10.5px;font-weight:650;padding:2px 8px;border-radius:99px;white-space:nowrap;}
  .pill.ok{background:var(--good-bg);color:var(--good);} .pill.none{background:var(--line-2);color:var(--ink-3);}
  .pill.warn{background:var(--warn-bg);color:var(--warn);} .pill.fail{background:var(--crit-bg);color:var(--crit);}
  .applied{display:flex;flex-wrap:wrap;gap:4px;}
  .applied span{font-size:11px;color:var(--ink-2);background:var(--surface-2);border:1px solid var(--line-2);border-radius:6px;padding:2px 7px;}
  .foot{font-size:11.5px;color:var(--ink-3);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
  .failcard{padding:26px 16px;color:var(--ink-3);font-size:13px;text-align:center;}
  footer{color:var(--ink-3);font-size:12px;max-width:82ch;line-height:1.6;}
  .themetog{position:fixed;top:14px;right:16px;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:8px;padding:5px 10px;cursor:pointer;z-index:5;}
</style>
<button class="themetog" onclick="var r=document.documentElement,d=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',d);this.textContent=d==='dark'?'☀︎ Light':'☾ Dark';">☾ Dark</button>
<div class="wrap">
  <header>
    <div class="eyebrow">Angel Adaptive · live before / after</div>
    <h1>The real engine adapting ${recs.length} live sites — drag any image to reveal the change</h1>
    <p>Each site was re-crawled live, the engine (<code>adaptive-lab.js</code>) injected, and the page photographed
    <b>before</b> and <b>after</b> it adapted for an engaged reader — then reverted to confirm it comes back clean.
    "After" is the engine's <b>safe primitives</b> (trust bar, CTA emphasis, and reorder where eligible), the same
    reversible vocabulary the product serves — <b>not</b> the Claude-designed cohort redesign, which needs the
    production API. Drag the divider on any card to compare.</p>
  </header>
  <div class="stats">
    <div class="stat"><b>${okN}/${recs.length}</b><span>captured live</span></div>
    <div class="stat"><b>${changed}</b><span>visibly adapted</span></div>
    <div class="stat"><b>${clean}/${okN}</b><span>reverted clean</span></div>
    <div class="stat"><b>${issues}</b><span>visual issues</span></div>
    <div class="stat"><b>${failed}</b><span>couldn’t capture</span></div>
  </div>
  <div class="toolbar" id="filters"></div>
  <div class="grid" id="grid"></div>
  <footer>
    Live captures via Browserbase; the engine and its automated visual-acceptance are the shipping ones. A card with
    "no change" means the engine found nothing safe to surface for this visitor (honest, not a failure); "couldn’t
    capture" means the live load/consent failed this run. Full-resolution images: <code>${IMG}/</code>. Regenerate:
    <code>bun run scripts/fleet-shots/gallery.ts</code>.
  </footer>
</div>
<script id="data" type="application/json">${payload}</script>
<script>
(function(){
  var cards = JSON.parse(document.getElementById('data').textContent);
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
  var state = { f:'all', q:'' };
  var F = document.getElementById('filters'), G = document.getElementById('grid');
  var opts = [['all','All'],['adapted','Adapted'],['nochange','No change'],['issues','Visual issues'],['failed','Couldn’t capture']];
  F.innerHTML = opts.map(function(o){return '<button class="chip" data-v="'+o[0]+'" aria-pressed="'+(state.f===o[0])+'" onclick="__f(this)">'+o[1]+'</button>';}).join('')
    + '<span class="sp"></span><input class="search" placeholder="Filter sites…" oninput="__s(this.value)">';
  window.__f=function(el){state.f=el.dataset.v;F.querySelectorAll('[data-v]').forEach(function(b){b.setAttribute('aria-pressed',b===el);});render();};
  window.__s=function(v){state.q=v.toLowerCase();render();};
  function match(c){
    if(state.q && c.name.toLowerCase().indexOf(state.q)<0) return false;
    if(state.f==='adapted') return c.ok && c.changed;
    if(state.f==='nochange') return c.ok && !c.changed;
    if(state.f==='issues') return c.ok && c.visualIssues && c.visualIssues.length;
    if(state.f==='failed') return !c.ok;
    return true;
  }
  function card(c){
    if(!c.ok || !c.beforeUri){
      return '<div class="card"><div class="failcard"><b>'+esc(c.name)+'</b><br>'+(c.ok?'captured, image unavailable':'couldn’t capture — '+esc((c.error||'').slice(0,80)))+'</div></div>';
    }
    var status = c.visualIssues && c.visualIssues.length ? '<span class="pill warn">visual issue</span>'
      : c.changed ? '<span class="pill ok">adapted</span>' : '<span class="pill none">no change</span>';
    var applied = (c.applied||[]).map(function(a){return '<span>'+esc(a.split(' — ')[0])+'</span>';}).join('');
    var restore = c.restoredClean ? 'reverted clean' : 'RESIDUE ON REVERT';
    return '<div class="card">'+
      '<div class="ba" onpointerdown="__drag(event)" onpointermove="__drag(event)">'+
        '<img src="'+c.beforeUri+'" alt="before" draggable="false">'+
        '<img class="after" src="'+c.afterUri+'" alt="after" draggable="false">'+
        '<div class="handle"></div>'+
        '<span class="tag b">BEFORE</span><span class="tag a">AFTER</span>'+
      '</div>'+
      '<div class="meta"><div class="row"><span class="site"><a href="'+esc(c.url)+'" target="_blank" rel="noopener">'+esc(c.name)+'</a></span>'+status+'</div>'+
      (applied?'<div class="applied">'+applied+'</div>':'<div class="foot">engine found nothing safe to surface for this visitor</div>')+
      '<div class="foot">'+esc(c.segment||'')+' · '+restore+(c.visualIssues&&c.visualIssues.length?' · '+esc(c.visualIssues.join(', ')):'')+'</div></div></div>';
  }
  function render(){
    var list = cards.filter(match);
    G.innerHTML = list.map(card).join('') || '<div style="color:var(--ink-3);padding:30px">No sites match.</div>';
  }
  window.__drag=function(e){
    if(e.type==='pointermove' && e.buttons===0) return;
    var ba = e.currentTarget, r = ba.getBoundingClientRect();
    var x = Math.max(0, Math.min(1, (e.clientX - r.left)/r.width));
    var after = ba.querySelector('img.after'), h = ba.querySelector('.handle');
    after.style.clipPath = 'inset(0 0 0 '+(x*100)+'%)';
    h.style.left = (x*100)+'%';
    if(e.type==='pointerdown') ba.setPointerCapture(e.pointerId);
  };
  render();
})();
</script>`;

writeFileSync(`${DIR}/gallery.html`, html);
console.log(`gallery → ${DIR}/gallery.html (${Math.round(html.length / 1024)} KB, ${cards.filter((c) => c.beforeUri).length} before/after pairs)`);
