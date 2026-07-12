#!/usr/bin/env bun
// Plausible Lab — interaktiv FÖRE/EFTER-sandbox på den RIKTIGA sidan.
//
// Bygger en helt självbärande HTML (riktig markup + CSS + bilder inlinade) av
// plausible.io-fixturen och injicerar en kontrollpanel: välj segment → växla
// FÖRE/EFTER → sidan omordnas live med exakt samma reversibla ops som
// varianterna i angel_variants. Ingen nätverksåtkomst behövs; sidan är fryst.
//
// Output: public/lab/plausible/index.html → deployas på dashboardens origin,
// så "öppna i sandbox"-länken i variant-kortet bara fungerar.
//
//   bun run scripts/lab/build-lab-sandbox.ts

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const REPO = join(import.meta.dir, "../..");
const FIX = join(REPO, "fixtures/real-sites");
const ASSETS = join(FIX, "plausible-io.assets");
const OUT_DIR = join(REPO, "public/lab/plausible");

// Samma gate-verifierade varianter som i angel_variants. moves = rubrik-nyckel
// (matchas mot h1/h2-text) upprepad per lyft; text-ops är exakta ersättningar
// som passerat claims-grinden (inga nya siffror/superlativ/löften).
const VARIANTS = [
  {
    key: "instagram·mobile·se",
    label: "Instagram · mobil · SE",
    headline: "Varm men försiktig — socialt bevis direkt under hjältens CTA.",
    gates: "krock +0px · overflow +0px · hjälten först · reversibel",
    moves: ["People ❤️ Plausible", "People ❤️ Plausible"],
    texts: [],
    viewport: "mobil",
  },
  {
    key: "google·desktop·us",
    label: "Google · desktop · US",
    headline: "Jämför aktivt — 'ditch Google Analytics' direkt under hjälten.",
    gates: "krock +48px (ok) · overflow +0px · hjälten först · reversibel",
    moves: ["It's time to ditch Google Analytics", "It's time to ditch Google Analytics"],
    texts: [],
    viewport: "desktop",
  },
  {
    key: "okänd·desktop·se·återkommande",
    label: "Återkommande · desktop · SE",
    headline: "Kom tillbaka för priset — pris direkt under hjälten, stramare rubrik.",
    gates: "krock +48px (ok) · overflow +0px · hjälten först · reversibel",
    moves: ["Traffic based plans", "Traffic based plans", "Traffic based plans"],
    texts: [
      { find: "h1", set: "The easy, privacy-friendly Google Analytics alternative" },
    ],
    viewport: "desktop",
  },
  {
    key: "facebook·mobile·us",
    label: "Facebook · mobil · US",
    headline: "Kall trafik — förtroende i hjälten, bevis ovanför folden, kortare feature-text.",
    gates: "krock +0px (försök 1: +320px stoppad) · overflow +0px · reversibel",
    moves: ["People ❤️ Plausible", "People ❤️ Plausible"],
    texts: [
      {
        find: "h1",
        set: "Easy to use, privacy-friendly Google Analytics alternative — trusted by thousands of companies that have switched. Start free trial.",
      },
      {
        find: "h2:Why use Plausible",
        set: "Why Plausible? Easy to use, privacy-friendly, and a full alternative to Google Analytics.",
      },
    ],
    viewport: "mobil",
  },
];

// ── inlinea sidan ─────────────────────────────────────────────────────────────
const MEDIA: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};
const ASSET_PATHS: Record<string, string> = {
  "/assets/images/icon/plausible_logo.svg": "icon_plausible_logo.svg",
  "/assets/images/icon/plausible_logo_dark.svg": "icon_plausible_logo_dark.svg",
  "/assets/images/privacy-focused-web-analytics.jpg": "privacy-focused-web-analytics.jpg",
  "/assets/images/twitter/ClemDelangue.jpg": "twitter_ClemDelangue.jpg",
  "/assets/images/twitter/JohnONolan.jpg": "twitter_JohnONolan.jpg",
  "/assets/images/twitter/cyrusshepard.jpg": "twitter_cyrusshepard.jpg",
  "/assets/images/twitter/dhh.jpg": "twitter_dhh.jpg",
  "/assets/images/twitter/lkr.jpg": "twitter_lkr.jpg",
  "/assets/images/twitter/robhope.jpg": "twitter_robhope.jpg",
};

let html = readFileSync(join(FIX, "plausible-io.html"), "utf8");
const css =
  readFileSync(join(FIX, "plausible-io.style.css"), "utf8") +
  "\n" +
  readFileSync(join(FIX, "plausible-io.tooltip.css"), "utf8");
html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "");
html = html.replace(/<\/head>/i, `<style>${css}</style></head>`);
for (const [path, file] of Object.entries(ASSET_PATHS)) {
  const media = MEDIA[extname(file)];
  const data = readFileSync(join(ASSETS, file)).toString("base64");
  html = html.split(path).join(`data:${media};base64,${data}`);
}

// ── kontrollpanel + apply/reset ───────────────────────────────────────────────
const controls = `
<style>
#angel-lab-bar{position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#10151c;color:#e9edf3;
  font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:10px 14px;display:flex;flex-wrap:wrap;
  gap:8px;align-items:center;box-shadow:0 -4px 20px rgba(0,0,0,.35)}
#angel-lab-bar .brand{color:#2dd4bf;font-weight:700;letter-spacing:.08em;margin-right:4px}
#angel-lab-bar button{font:inherit;border:1px solid #2c3744;background:#111823;color:#8a94a3;
  border-radius:7px;padding:5px 10px;cursor:pointer}
#angel-lab-bar button.on{border-color:#2dd4bf;background:#2dd4bf22;color:#2dd4bf}
#angel-lab-bar .switch{margin-left:auto;display:flex;gap:6px;align-items:center}
#angel-lab-bar .switch button.efter.on{background:#2dd4bf;color:#04211d;font-weight:700}
#angel-lab-info{position:fixed;bottom:56px;left:14px;right:14px;z-index:99998;max-width:560px;
  background:#111823ee;color:#8a94a3;border:1px solid #2c3744;border-radius:10px;padding:8px 12px;
  font:11.5px/1.5 ui-monospace,Menlo,monospace;display:none}
#angel-lab-info b{color:#e9edf3}
#angel-lab-info .gates{color:#4ade80}
body{padding-bottom:64px !important}
[data-angel-moved]{outline:2px dashed #2dd4bf88;outline-offset:-2px}
</style>
<div id="angel-lab-info"></div>
<div id="angel-lab-bar">
  <span class="brand">ANGEL·LAB</span><span style="color:#59636f">plausible.io (fryst)</span>
  <span id="angel-segments"></span>
  <span class="switch">
    <button id="angel-fore" class="on">FÖRE</button>
    <button id="angel-efter" class="efter">EFTER</button>
  </span>
</div>
<script>
(function(){
  var VARIANTS = __VARIANTS__;
  var mainEl = document.querySelector("main") || document.body;
  var original = Array.prototype.slice.call(mainEl.children);
  var textSnapshots = [];
  var current = VARIANTS[0], applied = false;

  function heads(){ return Array.prototype.slice.call(document.querySelectorAll("h1,h2")); }
  function container(el){ var n=el; while(n.parentElement && n.parentElement!==mainEl && n.parentElement!==document.body) n=n.parentElement; return n; }
  function findHeading(key){
    var sel = key.split(":"); var tag = sel.length>1?sel[0]:null; var needle=(sel[1]||sel[0]).slice(0,18);
    var hs = heads();
    for (var i=0;i<hs.length;i++){
      var h=hs[i]; if(tag && h.tagName.toLowerCase()!==tag) continue;
      if((h.textContent||"").indexOf(needle)>=0) return h;
    }
    return null;
  }
  function reset(){
    for (var i=0;i<original.length;i++) mainEl.appendChild(original[i]);
    original.forEach(function(el){ el.removeAttribute("data-angel-moved"); });
    textSnapshots.forEach(function(s){ s.el.textContent = s.text; });
    textSnapshots = []; applied = false;
  }
  function apply(v){
    reset();
    v.moves.forEach(function(key){
      var h = findHeading(key); if(!h) return;
      var t = container(h); var p = t.previousElementSibling;
      if (p && t.parentElement===p.parentElement){ t.parentElement.insertBefore(t,p); t.setAttribute("data-angel-moved","1"); }
    });
    v.texts.forEach(function(op){
      var el = op.find==="h1" ? document.querySelector("main h1")||document.querySelector("h1") : findHeading(op.find);
      if(!el) return;
      textSnapshots.push({el:el, text:el.textContent});
      el.textContent = op.set;
    });
    applied = true;
    window.scrollTo({top:0});
  }
  function renderInfo(){
    var info = document.getElementById("angel-lab-info");
    info.style.display = "block";
    info.innerHTML = "<b>"+current.label+"</b> — "+current.headline+
      "<br><span class='gates'>grindar: "+current.gates+"</span>"+
      (applied ? "" : "<br><span style='color:#59636f'>FÖRE — originalsidan. Växla till EFTER för variantens ordning.</span>");
  }
  function sync(){
    document.getElementById("angel-fore").className = applied?"":"on";
    document.getElementById("angel-efter").className = "efter"+(applied?" on":"");
    var pills = document.querySelectorAll("#angel-segments button");
    pills.forEach(function(b){ b.className = b.dataset.key===current.key?"on":""; });
    renderInfo();
  }
  var seg = document.getElementById("angel-segments");
  VARIANTS.forEach(function(v){
    var b=document.createElement("button"); b.textContent=v.label; b.dataset.key=v.key;
    b.onclick=function(){ current=v; if(applied) apply(v); sync(); };
    seg.appendChild(b);
  });
  document.getElementById("angel-fore").onclick=function(){ reset(); sync(); };
  document.getElementById("angel-efter").onclick=function(){ apply(current); sync(); };
  var qs=new URLSearchParams(location.search); var want=qs.get("segment");
  if(want){ var m=VARIANTS.filter(function(v){return v.key===want;})[0]; if(m) current=m; }
  if(qs.get("state")==="efter") apply(current);
  sync();
})();
</script>`;

html = html.replace(/<\/body>/i, controls.replace("__VARIANTS__", JSON.stringify(VARIANTS)) + "</body>");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
console.log(`[lab-sandbox] wrote ${join(OUT_DIR, "index.html")} (${html.length} bytes, ${VARIANTS.length} varianter)`);
