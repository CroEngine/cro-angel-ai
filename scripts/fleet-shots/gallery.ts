#!/usr/bin/env bun
// FLEET SHOTS GALLERY — full-page before/after of the real engine adapting each
// site's HOME and (where present) PRICING page. Each card pairs the two pages
// behind a tab toggle and shows before/after as SYNCED scrollable panes so you
// can compare the WHOLE page at any scroll position. Images are downscaled +
// re-encoded via local Chromium; the set is auto-split into parts so each HTML
// stays a loadable size.
//
//   bun run scripts/fleet-shots/gallery.ts   →  docs/fleet-shots-2026-07-21/gallery-part{N}.html

import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = process.env.GALLERY_DIR || "docs/fleet-shots-2026-07-21";
const IMG = `${DIR}/img`;
const MAX_W = 380; // downscale width for the embedded images
const PART_BUDGET = 4_500_000; // ~4.5 MB of image data per part file (safe to publish)

type Rec = {
  name: string;
  url: string;
  page: "home" | "pricing";
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

async function shrink(file?: string): Promise<string | undefined> {
  if (!file) return undefined;
  const path = `${IMG}/${file}`;
  if (!existsSync(path)) return undefined;
  const full = "data:image/jpeg;base64," + readFileSync(path).toString("base64");
  const out = await page.evaluate(
    ([src, maxW]) =>
      new Promise<string>((resolve) => {
        const im = new Image();
        im.onload = () => {
          const scale = Math.min(1, (maxW as number) / im.naturalWidth);
          const c = document.createElement("canvas");
          c.width = Math.round(im.naturalWidth * scale);
          c.height = Math.round(im.naturalHeight * scale);
          c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.5));
        };
        im.onerror = () => resolve("");
        im.src = src as string;
      }),
    [full, MAX_W] as const,
  );
  return out || undefined;
}

type Page1 = {
  ok: boolean;
  error?: string;
  applied: string[];
  segment: string;
  visualIssues: string[];
  restoredClean?: boolean;
  changed?: boolean;
  beforeUri?: string;
  afterUri?: string;
};
type Site = { name: string; url: string; home?: Page1; pricing?: Page1 };

// Group records by site (home + pricing), downscaling images.
const byName = new Map<string, Site>();
const order: string[] = [];
for (const r of recs) {
  if (!byName.has(r.name)) {
    byName.set(r.name, { name: r.name, url: r.name && recs.find((x) => x.name === r.name && x.page === "home")?.url || r.url });
    order.push(r.name);
  }
  const site = byName.get(r.name)!;
  const p1: Page1 = {
    ok: r.ok,
    error: r.error,
    applied: r.applied ?? [],
    segment: r.segment ?? "",
    visualIssues: r.visualIssues ?? [],
    restoredClean: r.restoredClean,
    changed: r.changed,
    beforeUri: r.ok ? await shrink(r.before) : undefined,
    afterUri: r.ok ? await shrink(r.after) : undefined,
  };
  if (r.page === "pricing") site.pricing = p1;
  else site.home = p1;
  process.stdout.write(".");
}
await browser.close();
console.log("");

const sites = order.map((n) => byName.get(n)!);

// Fleet stats (over pages, both home + pricing).
const pageRecs = recs;
const okN = pageRecs.filter((r) => r.ok).length;
const adaptedN = pageRecs.filter((r) => r.ok && r.changed).length;
const cleanN = pageRecs.filter((r) => r.ok && r.restoredClean).length;
const issuesN = pageRecs.filter((r) => r.ok && r.visualIssues && r.visualIssues.length).length;
const failN = pageRecs.filter((r) => !r.ok).length;
const pricingN = pageRecs.filter((r) => r.page === "pricing" && r.ok).length;

// Split sites into parts by embedded-image byte budget.
const bytesOf = (s: Site) =>
  [s.home?.beforeUri, s.home?.afterUri, s.pricing?.beforeUri, s.pricing?.afterUri]
    .filter(Boolean)
    .reduce((n, u) => n + (u as string).length, 0);
const parts: Site[][] = [[]];
let acc = 0;
for (const s of sites) {
  const b = bytesOf(s);
  if (acc + b > PART_BUDGET && parts[parts.length - 1].length > 0) {
    parts.push([]);
    acc = 0;
  }
  parts[parts.length - 1].push(s);
  acc += b;
}
// Fold a tiny trailing part into the previous one (avoid a 1-site orphan part).
if (parts.length > 1) {
  const last = parts[parts.length - 1];
  const lastBytes = last.reduce((n, s) => n + bytesOf(s), 0);
  if (lastBytes < 1_500_000) {
    parts[parts.length - 2].push(...last);
    parts.pop();
  }
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function shell(partSites: Site[], part: number, total: number): string {
  const payload = JSON.stringify(partSites);
  return `<title>Angel Adaptive — before/after (part ${part}/${total})</title>
<style>
  :root{--bg:#F6F7F9;--surface:#FFFFFF;--surface-2:#FBFBFC;--ink:#1A2230;--ink-2:#55606F;--ink-3:#8A94A3;--line:#E4E7EC;--line-2:#EEF0F3;--accent:#3F4CD6;--good:#0B8276;--good-bg:#E7F4F1;--warn:#B45309;--warn-bg:#FBF0E3;--crit:#C0342B;--crit-bg:#FBE9E7;}
  @media (prefers-color-scheme:dark){:root{--bg:#0C1116;--surface:#12171E;--surface-2:#161C24;--ink:#E7ECF2;--ink-2:#A3AEBC;--ink-3:#6B7686;--line:#232B35;--line-2:#1C232C;--accent:#8A93F0;--good:#2DBFAD;--good-bg:#0F2420;--warn:#E0A05A;--warn-bg:#2A2015;--crit:#EE7A6E;--crit-bg:#2A1614;}}
  :root[data-theme="dark"]{--bg:#0C1116;--surface:#12171E;--surface-2:#161C24;--ink:#E7ECF2;--ink-2:#A3AEBC;--ink-3:#6B7686;--line:#232B35;--line-2:#1C232C;--accent:#8A93F0;--good:#2DBFAD;--good-bg:#0F2420;--warn:#E0A05A;--warn-bg:#2A2015;--crit:#EE7A6E;--crit-bg:#2A1614;}
  :root[data-theme="light"]{--bg:#F6F7F9;--surface:#FFFFFF;--surface-2:#FBFBFC;--ink:#1A2230;--ink-2:#55606F;--ink-3:#8A94A3;--line:#E4E7EC;--line-2:#EEF0F3;--accent:#3F4CD6;--good:#0B8276;--good-bg:#E7F4F1;--warn:#B45309;--warn-bg:#FBF0E3;--crit:#C0342B;--crit-bg:#FBE9E7;}
  *{box-sizing:border-box;}
  body{background:var(--bg);color:var(--ink);font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:26px 20px 70px;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:18px;}
  .eyebrow{text-transform:uppercase;letter-spacing:.09em;font-size:11px;font-weight:650;color:var(--accent);}
  h1{font-size:23px;font-weight:660;letter-spacing:-.02em;margin:6px 0;text-wrap:balance;}
  header p{color:var(--ink-2);max-width:82ch;margin:0;}
  .stats{display:flex;flex-wrap:wrap;gap:9px;}
  .stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 15px;min-width:104px;}
  .stat b{font-size:20px;font-weight:680;display:block;}
  .stat span{font-size:11.5px;color:var(--ink-3);}
  .toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
  .toolbar .sp{flex:1;}
  .chip{font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:99px;padding:5px 12px;cursor:pointer;user-select:none;}
  .chip[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;}
  input.search{font:inherit;padding:6px 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);min-width:150px;}
  .partnav{font-size:12px;color:var(--ink-3);}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:16px;}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
  .chead{display:flex;align-items:center;gap:10px;padding:10px 13px;border-bottom:1px solid var(--line-2);}
  .chead .site{font-weight:660;font-size:14.5px;}
  .chead .site a{color:inherit;text-decoration:none;}
  .tabs{display:flex;gap:4px;margin-left:auto;}
  .tab{font-size:11.5px;font-weight:650;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:7px;padding:3px 10px;cursor:pointer;}
  .tab[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff;}
  .panes{display:grid;grid-template-columns:1fr 1fr;gap:0;}
  .pane{position:relative;height:460px;overflow-y:auto;overscroll-behavior:contain;background:var(--surface-2);}
  .pane+.pane{border-left:1px solid var(--line);}
  .pane img{display:block;width:100%;}
  .pane .lbl{position:sticky;top:0;z-index:2;font-size:10px;font-weight:700;letter-spacing:.08em;padding:4px 9px;color:#fff;}
  .pane.b .lbl{background:rgba(20,26,34,.82);} .pane.a .lbl{background:var(--accent);}
  .meta{padding:10px 13px;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line-2);}
  .meta .row{display:flex;align-items:center;justify-content:space-between;gap:8px;}
  .pill{font-size:10.5px;font-weight:650;padding:2px 8px;border-radius:99px;white-space:nowrap;}
  .pill.ok{background:var(--good-bg);color:var(--good);} .pill.none{background:var(--line-2);color:var(--ink-3);}
  .pill.warn{background:var(--warn-bg);color:var(--warn);} .pill.fail{background:var(--crit-bg);color:var(--crit);}
  .applied{display:flex;flex-wrap:wrap;gap:4px;}
  .applied span{font-size:11px;color:var(--ink-2);background:var(--surface-2);border:1px solid var(--line-2);border-radius:6px;padding:2px 7px;}
  .foot{font-size:11.5px;color:var(--ink-3);}
  .failbox{padding:24px 14px;color:var(--ink-3);font-size:12.5px;text-align:center;}
  footer{color:var(--ink-3);font-size:12px;max-width:84ch;line-height:1.6;}
  .themetog{position:fixed;top:14px;right:16px;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:8px;padding:5px 10px;cursor:pointer;z-index:5;}
  @media (max-width:620px){.grid{grid-template-columns:1fr;}}
</style>
<button class="themetog" onclick="var r=document.documentElement,d=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',d);this.textContent=d==='dark'?'☀︎ Light':'☾ Dark';">☾ Dark</button>
<div class="wrap">
  <header>
    <div class="eyebrow">Angel Adaptive · full-page before / after${total > 1 ? ` · part ${part} of ${total}` : ""}</div>
    <h1>The real engine adapting live pages — whole start page + pricing page, before &amp; after</h1>
    <p>Each site was re-crawled live, the engine (<code>adaptive-lab.js</code>, v0.13) injected, and the <b>whole page</b>
    photographed before → adapting → after, then reverted to confirm it comes back clean. HOME adapts for an engaged
    reader (trust bar of proof <b>not already shown</b>, CTA emphasis, reorder where eligible); PRICING adapts for a
    price-hesitant visitor (spotlight the plans, surface a refund/guarantee). Scroll a pane — before &amp; after scroll
    together. "After" is the engine's <b>safe primitives</b>, not the Claude cohort redesign (that needs the prod API).</p>
  </header>
  <div class="stats">
    <div class="stat"><b>${okN}</b><span>pages captured</span></div>
    <div class="stat"><b>${adaptedN}</b><span>visibly adapted</span></div>
    <div class="stat"><b>${pricingN}</b><span>pricing pages</span></div>
    <div class="stat"><b>${cleanN}/${okN}</b><span>reverted clean</span></div>
    <div class="stat"><b>${issuesN}</b><span>visual issues</span></div>
    <div class="stat"><b>${failN}</b><span>couldn’t capture</span></div>
  </div>
  <div class="toolbar" id="filters"></div>
  ${total > 1 ? `<div class="partnav">Part ${part} of ${total}. The full set is split across ${total} pages to stay loadable.</div>` : ""}
  <div class="grid" id="grid"></div>
  <footer>Live captures via Browserbase; the engine + its automated visual-acceptance are the shipping ones. "No change"
  = the engine found nothing safe to surface for that visitor (honest, not a failure). Full page height is capped at
  6000px. Regenerate: <code>bun run scripts/fleet-shots/gallery.ts</code>.</footer>
</div>
<script id="data" type="application/json">${payload}</script>
<script>
(function(){
  var sites = JSON.parse(document.getElementById('data').textContent);
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
  var state={f:'all',q:''};
  var F=document.getElementById('filters'),G=document.getElementById('grid');
  var opts=[['all','All'],['adapted','Adapted'],['pricing','Has pricing'],['nochange','No change'],['issues','Visual issues']];
  F.innerHTML=opts.map(function(o){return '<button class="chip" data-v="'+o[0]+'" aria-pressed="'+(state.f===o[0])+'" onclick="__f(this)">'+o[1]+'</button>';}).join('')
    +'<span class="sp"></span><input class="search" placeholder="Filter sites…" oninput="__s(this.value)">';
  window.__f=function(el){state.f=el.dataset.v;F.querySelectorAll('[data-v]').forEach(function(b){b.setAttribute('aria-pressed',b===el);});render();};
  window.__s=function(v){state.q=v.toLowerCase();render();};
  function anyAdapted(s){return (s.home&&s.home.changed)||(s.pricing&&s.pricing.changed);}
  function match(s){
    if(state.q&&s.name.toLowerCase().indexOf(state.q)<0)return false;
    if(state.f==='adapted')return anyAdapted(s);
    if(state.f==='pricing')return !!s.pricing;
    if(state.f==='nochange')return !anyAdapted(s);
    if(state.f==='issues')return (s.home&&s.home.visualIssues&&s.home.visualIssues.length)||(s.pricing&&s.pricing.visualIssues&&s.pricing.visualIssues.length);
    return true;
  }
  function panes(p){
    if(!p||!p.ok||!p.beforeUri){
      return '<div class="failbox">'+(p&&p.ok?'captured, image unavailable':'couldn’t capture'+(p&&p.error?' — '+esc(p.error.slice(0,70)):''))+'</div>';
    }
    return '<div class="panes">'+
      '<div class="pane b" onscroll="__sync(this)"><div class="lbl">BEFORE</div><img src="'+p.beforeUri+'" alt="before" loading="lazy"></div>'+
      '<div class="pane a" onscroll="__sync(this)"><div class="lbl">AFTER</div><img src="'+p.afterUri+'" alt="after" loading="lazy"></div></div>';
  }
  function metaFor(p){
    if(!p||!p.ok)return '';
    var status=p.visualIssues&&p.visualIssues.length?'<span class="pill warn">visual issue</span>':p.changed?'<span class="pill ok">adapted</span>':'<span class="pill none">no change</span>';
    var applied=(p.applied||[]).map(function(a){return '<span>'+esc(a.split(' — ')[0])+'</span>';}).join('');
    return '<div class="meta"><div class="row"><span class="foot">'+esc(p.segment||'')+' · '+(p.restoredClean?'reverted clean':'RESIDUE')+(p.visualIssues&&p.visualIssues.length?' · '+esc(p.visualIssues.join(', ')):'')+'</span>'+status+'</div>'+
      (applied?'<div class="applied">'+applied+'</div>':'<div class="foot">engine found nothing safe to surface</div>')+'</div>';
  }
  function card(s){
    var hasP=!!s.pricing, hasH=!!s.home;
    var tabs = (hasH&&hasP) ? '<div class="tabs"><button class="tab" data-p="home" aria-pressed="true" onclick="__tab(this)">Home</button><button class="tab" data-p="pricing" aria-pressed="false" onclick="__tab(this)">Pricing</button></div>' : (hasP?'<div class="tabs"><span class="tab" aria-pressed="true">Pricing</span></div>':'');
    var active = hasH ? s.home : s.pricing;
    var activeName = hasH ? 'home':'pricing';
    return '<div class="card" data-name="'+esc(s.name)+'">'+
      '<div class="chead"><span class="site"><a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.name)+'</a></span>'+tabs+'</div>'+
      '<div class="body" data-active="'+activeName+'">'+panes(active)+metaFor(active)+'</div></div>';
  }
  window.__tab=function(el){
    var card=el.closest('.card'), name=card.dataset.name, s=sites.find(function(x){return x.name===name;});
    card.querySelectorAll('.tab').forEach(function(t){t.setAttribute('aria-pressed', t===el);});
    var p = el.dataset.p==='pricing'?s.pricing:s.home;
    card.querySelector('.body').innerHTML = panes(p)+metaFor(p);
  };
  window.__sync=function(el){
    var panes=el.parentElement, other= el.classList.contains('b')?panes.querySelector('.pane.a'):panes.querySelector('.pane.b');
    if(other && Math.abs(other.scrollTop-el.scrollTop)>1) other.scrollTop=el.scrollTop;
  };
  function render(){
    var list=sites.filter(match);
    G.innerHTML=list.map(card).join('')||'<div style="color:var(--ink-3);padding:30px">No sites match.</div>';
  }
  render();
})();
</script>`;
}

const N = parts.length;
for (let i = 0; i < N; i++) {
  const html = shell(parts[i], i + 1, N);
  writeFileSync(`${DIR}/gallery-part${i + 1}.html`, html);
  console.log(`part ${i + 1}/${N} → ${DIR}/gallery-part${i + 1}.html (${Math.round(html.length / 1024)} KB, ${parts[i].length} sites)`);
}
