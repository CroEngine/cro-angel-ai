#!/usr/bin/env bun
// FLEET MAP GALLERY — the engine's detected SECTION MAP overlaid on each site's
// start page, plus a structured readout of how well it TYPED the sections.
// Answers "does the engine map the page correctly?" across the fleet, so we can
// see exactly where the map is right and where it just guesses `content`, before
// trusting any rearrangement.
//
//   bun run scripts/fleet-shots/map-gallery.ts → docs/fleet-map-2026-07-22/map-part{N}.html

import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const DIR = process.env.MAP_DIR || "docs/fleet-map-2026-07-22";
const IMG = `${DIR}/img`;
const MAX_W = 340;
const PART_BUDGET = 4_500_000;

type Sec = { i: number; type: string; heading: string; y: number; h: number; trust: boolean; pricing: boolean };
type Map1 = {
  url: string;
  hero: { headline: string; sub: string };
  sectionCount: number;
  typedShare: string;
  sections: Sec[];
  ctas: Array<{ text: string; section: string; intent: string; aboveFold: boolean }>;
  trustCount: Record<string, number>;
};
type Rec = { name: string; url: string; page: string; ok: boolean; error?: string; before?: string; map?: Map1 };

const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, "utf8")) as { records: Rec[] };
const recs = manifest.records.filter((r) => r.page === "home");

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

type Site = {
  name: string;
  url: string;
  ok: boolean;
  error?: string;
  img?: string;
  map?: Map1;
  typed: number;
  total: number;
  proofLinked: boolean; // any section flagged as containing trust signals
  hasProofType: boolean; // any section typed logos/testimonials/stats
};

const sites: Site[] = [];
for (const r of recs) {
  const m = r.map;
  const secs = m?.sections ?? [];
  const typed = secs.filter((s) => s.type !== "content").length;
  sites.push({
    name: r.name,
    url: r.url,
    ok: r.ok,
    error: r.error,
    img: r.ok ? await shrink(r.before) : undefined,
    map: m,
    typed,
    total: secs.length,
    proofLinked: secs.some((s) => s.trust),
    hasProofType: secs.some((s) => /testimonials|logos|stats/.test(s.type)),
  });
  process.stdout.write(".");
}
await browser.close();
console.log("");

// Fleet typing summary.
const ok = sites.filter((s) => s.ok && s.map);
const avgTyped = ok.length ? Math.round((100 * ok.reduce((n, s) => n + (s.total ? s.typed / s.total : 0), 0)) / ok.length) : 0;
const withProofLinked = ok.filter((s) => s.proofLinked).length;
const withProofType = ok.filter((s) => s.hasProofType).length;
const failN = sites.filter((s) => !s.ok).length;

// Split by embedded-image byte budget.
const bytesOf = (s: Site) => (s.img ? s.img.length : 0);
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
  return `<title>Angel Adaptive — page map audit (part ${part}/${total})</title>
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
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:16px;}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
  .chead{display:flex;align-items:center;gap:10px;padding:10px 13px;border-bottom:1px solid var(--line-2);}
  .chead .site{font-weight:660;font-size:14.5px;}
  .chead .site a{color:inherit;text-decoration:none;}
  .badge{margin-left:auto;font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;}
  .badge.good{background:var(--good-bg);color:var(--good);} .badge.warn{background:var(--warn-bg);color:var(--warn);} .badge.crit{background:var(--crit-bg);color:var(--crit);}
  .body{display:grid;grid-template-columns:1fr 1fr;gap:0;}
  .pane{position:relative;height:520px;overflow-y:auto;overscroll-behavior:contain;background:var(--surface-2);}
  .pane img{display:block;width:100%;}
  .side{padding:10px 12px;border-left:1px solid var(--line);overflow-y:auto;height:520px;}
  .kv{font-size:11.5px;color:var(--ink-3);margin-bottom:8px;}
  .kv b{color:var(--ink);font-size:13px;}
  .seclist{display:flex;flex-direction:column;gap:2px;}
  .sec{display:flex;gap:6px;align-items:baseline;font-size:11.5px;padding:2px 4px;border-radius:4px;}
  .sec .tag{font-weight:700;padding:0 6px;border-radius:4px;color:#fff;white-space:nowrap;font-size:10.5px;}
  .sec .hd{color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .sec.gen{background:rgba(100,116,139,.08);}
  .tc{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;}
  .tc span{font-size:10.5px;color:var(--ink-2);background:var(--surface-2);border:1px solid var(--line-2);border-radius:5px;padding:1px 6px;}
  .failbox{padding:24px 14px;color:var(--ink-3);font-size:12.5px;text-align:center;grid-column:1/3;}
  footer{color:var(--ink-3);font-size:12px;max-width:84ch;line-height:1.6;}
  .themetog{position:fixed;top:14px;right:16px;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:8px;padding:5px 10px;cursor:pointer;z-index:5;}
  @media (max-width:620px){.grid{grid-template-columns:1fr;}.body{grid-template-columns:1fr;}.side{border-left:none;border-top:1px solid var(--line);height:auto;}}
</style>
<button class="themetog" onclick="var r=document.documentElement,d=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',d);this.textContent=d==='dark'?'☀︎ Light':'☾ Dark';">☾ Dark</button>
<div class="wrap">
  <header>
    <div class="eyebrow">Angel Adaptive · page-map audit${total > 1 ? ` · part ${part} of ${total}` : ""}</div>
    <h1>Does the engine map the page correctly? Every section, typed &amp; boxed</h1>
    <p>The left pane is the real start page with every <b>detected section</b> boxed and labeled
    (<code>#index type · heading</code>). Sections the engine could only call generic <code>content</code>
    are shaded — that's the typing gap. The right pane lists the sections and the trust signals found.
    Good boxes + coarse types = boundaries work, typing doesn't (yet). This is the map we must sharpen
    before trusting any rearrangement.</p>
  </header>
  <div class="stats">
    <div class="stat"><b>${ok.length}</b><span>pages mapped</span></div>
    <div class="stat"><b>${avgTyped}%</b><span>avg sections typed</span></div>
    <div class="stat"><b>${withProofLinked}/${ok.length}</b><span>proof linked to a section</span></div>
    <div class="stat"><b>${withProofType}/${ok.length}</b><span>have a proof-typed section</span></div>
    <div class="stat"><b>${failN}</b><span>couldn’t map</span></div>
  </div>
  <div class="toolbar" id="filters"></div>
  ${total > 1 ? `<div class="kv">Part ${part} of ${total}. Split to stay loadable.</div>` : ""}
  <div class="grid" id="grid"></div>
  <footer>Live captures via Browserbase; boxes are the engine's own inventory (<code>adaptive-lab.js</code>).
  "proof linked to a section" = at least one section is flagged as containing a trust signal — today that's
  the gap that stops reorder from finding the proof strip. Regenerate: <code>bun run scripts/fleet-shots/map-gallery.ts</code>.</footer>
</div>
<script id="data" type="application/json">${payload}</script>
<script>
(function(){
  var sites = JSON.parse(document.getElementById('data').textContent);
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
  var COLORS={hero:'#2563eb',testimonials:'#0d9488',pricing:'#7c3aed',features:'#16a34a',benefits:'#16a34a',faq:'#d97706',cta:'#db2777',logos:'#0891b2',stats:'#ca8a04',content:'#64748b',header:'#334155',nav:'#334155',footer:'#334155'};
  var state={f:'all',q:''};
  var F=document.getElementById('filters'),G=document.getElementById('grid');
  var opts=[['all','All'],['lowtype','Poorly typed (<40%)'],['noproof','No proof section'],['fail','Failed']];
  F.innerHTML=opts.map(function(o){return '<button class="chip" data-v="'+o[0]+'" aria-pressed="'+(state.f===o[0])+'" onclick="__f(this)">'+o[1]+'</button>';}).join('')
    +'<span class="sp"></span><input class="search" placeholder="Filter sites…" oninput="__s(this.value)">';
  window.__f=function(el){state.f=el.dataset.v;F.querySelectorAll('[data-v]').forEach(function(b){b.setAttribute('aria-pressed',b===el);});render();};
  window.__s=function(v){state.q=v.toLowerCase();render();};
  function pct(s){return s.total?Math.round(100*s.typed/s.total):0;}
  function match(s){
    if(state.q&&s.name.toLowerCase().indexOf(state.q)<0)return false;
    if(state.f==='lowtype')return s.ok&&s.map&&pct(s)<40;
    if(state.f==='noproof')return s.ok&&s.map&&!s.proofLinked;
    if(state.f==='fail')return !s.ok;
    return true;
  }
  function badge(s){
    if(!s.ok)return '<span class="badge crit">no map</span>';
    var p=pct(s);
    var cls=p>=60?'good':p>=35?'warn':'crit';
    return '<span class="badge '+cls+'">'+s.typed+'/'+s.total+' typed'+(s.proofLinked?' · proof✓':' · proof✗')+'</span>';
  }
  function secRow(x){
    var c=COLORS[x.type]||'#64748b', gen=x.type==='content';
    return '<div class="sec'+(gen?' gen':'')+'"><span class="tag" style="background:'+c+'">#'+x.i+' '+esc(x.type)+'</span><span class="hd">'+esc(x.heading||'')+(x.trust?' ·TRUST':'')+(x.pricing?' ·PRICE':'')+'</span></div>';
  }
  function side(s){
    if(!s.map)return '';
    var m=s.map;
    var tc=Object.keys(m.trustCount||{}).filter(function(k){return m.trustCount[k]>0;}).map(function(k){return '<span>'+k+':'+m.trustCount[k]+'</span>';}).join('');
    return '<div class="side"><div class="kv"><b>'+m.sectionCount+' sections · '+m.typedShare+' typed</b></div>'+
      '<div class="seclist">'+(m.sections||[]).map(secRow).join('')+'</div>'+
      (tc?'<div class="tc">'+tc+'</div>':'')+'</div>';
  }
  function card(s){
    var left = (s.ok&&s.img) ? '<div class="pane"><img src="'+s.img+'" alt="map" loading="lazy"></div>'+side(s)
      : '<div class="failbox">couldn’t map'+(s.error?' — '+esc(s.error.slice(0,80)):'')+'</div>';
    return '<div class="card" data-name="'+esc(s.name)+'">'+
      '<div class="chead"><span class="site"><a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.name)+'</a></span>'+badge(s)+'</div>'+
      '<div class="body">'+left+'</div></div>';
  }
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
  writeFileSync(`${DIR}/map-part${i + 1}.html`, html);
  console.log(`part ${i + 1}/${N} → ${DIR}/map-part${i + 1}.html (${Math.round(html.length / 1024)} KB, ${parts[i].length} sites)`);
}
