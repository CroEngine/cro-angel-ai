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
    key: "instagram·mobile·SE",
    label: "Instagram · mobil · SE",
    headline: "Varm men försiktig — socialt bevis direkt under hjältens CTA.",
    gates: "krock +0px · overflow +0px · hjälten först · reversibel",
    moves: ["People ❤️ Plausible", "People ❤️ Plausible"],
    texts: [],
    viewport: "mobil",
  },
  {
    key: "google·desktop·US",
    label: "Google · desktop · US",
    headline: "Jämför aktivt — 'ditch Google Analytics' direkt under hjälten.",
    gates: "krock +48px (ok) · overflow +0px · hjälten först · reversibel",
    moves: ["It's time to ditch Google Analytics", "It's time to ditch Google Analytics"],
    texts: [],
    viewport: "desktop",
  },
  {
    key: "direct·desktop·SE·återkommande",
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
    key: "facebook·mobile·US",
    label: "Facebook · mobil · US",
    headline: "Kall trafik — förtroende i hjälten, bevis ovanför folden, kortare feature-text.",
    gates: "krock +0px (försök 1: +320px stoppad) · overflow +0px · reversibel",
    moves: ["People ❤️ Plausible", "People ❤️ Plausible"],
    texts: [
      {
        // v2 — ägaren dömde v1 ("Easy to use, … that have switched. Start free
        // trial.") som för lång på mobil (7 rader). Stramare, samma grundade
        // claim, ~4 rader på 390px. Claims-grind: PASS.
        find: "h1",
        set: "Privacy-friendly Google Analytics alternative — trusted by thousands of companies.",
      },
      {
        find: "h2:Why use Plausible",
        set: "Why Plausible? Easy to use, privacy-friendly, and a full alternative to Google Analytics.",
      },
    ],
    viewport: "mobil",
  },
  // ── auto-genererade (loopens första två — status verified, väntar på ägaren) ──
  {
    key: "google",
    label: "Google · täckning (mobil SE m.fl.)",
    headline:
      "Auto-genererad täcknings-variant: mobila Google-sökare möter 'ditch GA'-caset ett svep under en stramare hjälte.",
    gates: "krock +0px (försök 1: +320px stoppad av grinden) · overflow +0px · hjälten först · reversibel",
    moves: [
      "It's time to ditch Google Analytics",
      "It's time to ditch Google Analytics",
      "It's time to ditch Google Analytics",
      "It's time to ditch Google Analytics",
    ],
    texts: [{ find: "h1", set: "Easy, privacy-friendly Google Analytics alternative" }],
    viewport: "mobil",
  },
  {
    key: "direct·desktop·SE",
    label: "Direkt · desktop · SE (nya besökare)",
    headline:
      "Auto-genererad täcknings-variant: nya varumärkesmedvetna direkt-besökare får VAD → VARFÖR — priset ligger kvar sist.",
    gates: "krock +0px · overflow +0px · hjälten först · reversibel",
    moves: ["It's time to ditch Google Analytics"],
    texts: [],
    viewport: "desktop",
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

// ── kontrollpanel + apply/reset + DIFF-VY ─────────────────────────────────────
// Diffen är redan förstklassig data (ops-listan) — här visualiseras den direkt
// på sidan: märken vid varje ändring, numrerad ändringslista (klick → scrolla
// dit + blink), och auto-scroll till första ändringen när EFTER slås på.
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
#angel-lab-info{position:fixed;bottom:56px;left:14px;right:14px;z-index:99998;max-width:620px;
  background:#111823f2;color:#8a94a3;border:1px solid #2c3744;border-radius:10px;padding:10px 12px;
  font:11.5px/1.5 ui-monospace,Menlo,monospace;display:none;max-height:45vh;overflow-y:auto}
#angel-lab-info b{color:#e9edf3}
#angel-lab-info .gates{color:#4ade80}
#angel-lab-info ol{margin:8px 0 0;padding-left:20px}
#angel-lab-info li{margin:4px 0;cursor:pointer}
#angel-lab-info li:hover .difflabel{text-decoration:underline}
#angel-lab-info .difflabel{color:#2dd4bf;font-weight:600}
#angel-lab-info .old{color:#8a94a3;text-decoration:line-through}
#angel-lab-info .new{color:#e9edf3}
body{padding-bottom:64px !important}
.angel-badge{position:absolute;z-index:99997;left:8px;top:8px;background:#0d7d72;color:#fff;
  font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.05em;padding:5px 9px;border-radius:6px;
  box-shadow:0 2px 10px rgba(0,0,0,.3);pointer-events:none}
.angel-badge.text{background:#a8560a}
[data-angel-moved]{outline:3px solid #0d7d72aa;outline-offset:-3px;position:relative}
[data-angel-retext]{outline:3px solid #a8560aaa;outline-offset:2px;border-radius:4px}
@keyframes angelflash{0%{box-shadow:0 0 0 6px #2dd4bf88}100%{box-shadow:0 0 0 6px transparent}}
.angel-flash{animation:angelflash 1.1s ease-out 2}
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
  var textSnapshots = [], badges = [], diffs = [];
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
  // Position bland SYNLIGA sektioner (main-barn högre än 30px), 1-baserad.
  function sectionIndex(el){
    var kids = Array.prototype.filter.call(mainEl.children, function(c){ return c.clientHeight>30 || c===el; });
    return kids.indexOf(el)+1;
  }
  function sectionLabel(el){
    var hs=heads(); for(var i=0;i<hs.length;i++){ if(container(hs[i])===el) return (hs[i].textContent||"").replace(/\\s+/g," ").trim().slice(0,34); }
    return "(sektion)";
  }
  function addBadge(el, text, kind){
    var b=document.createElement("div"); b.className="angel-badge"+(kind==="text"?" text":""); b.textContent=text;
    if (getComputedStyle(el).position==="static") el.style.position="relative";
    el.insertBefore(b, el.firstChild); badges.push(b);
  }
  function reset(){
    badges.forEach(function(b){ if(b.parentElement) b.parentElement.removeChild(b); });
    for (var i=0;i<original.length;i++) mainEl.appendChild(original[i]);
    original.forEach(function(el){ el.removeAttribute("data-angel-moved"); });
    textSnapshots.forEach(function(s){ s.el.textContent = s.text; s.el.removeAttribute("data-angel-retext"); });
    textSnapshots = []; badges = []; diffs = []; applied = false;
  }
  function apply(v){
    reset();
    // 1) Flyttar — mät position före/efter per unikt mål, sätt märke + diffrad.
    var targets = {};
    v.moves.forEach(function(key){
      var h = findHeading(key); if(!h) return;
      var t = container(h);
      if (!(key in targets)) targets[key] = { el: t, from: sectionIndex(t) };
      var p = t.previousElementSibling;
      if (p && t.parentElement===p.parentElement){ t.parentElement.insertBefore(t,p); t.setAttribute("data-angel-moved","1"); }
    });
    Object.keys(targets).forEach(function(key){
      var o = targets[key]; var to = sectionIndex(o.el);
      addBadge(o.el, "↑ FLYTTAD HIT · plats "+o.from+" → "+to, "move");
      diffs.push({ el:o.el, kind:"move", label:sectionLabel(o.el), detail:"plats "+o.from+" → "+to });
    });
    // 2) Text-ändringar — spara gammal text, märk elementet, diffrad gammal→ny.
    v.texts.forEach(function(op){
      var el = op.find==="h1" ? document.querySelector("main h1")||document.querySelector("h1") : findHeading(op.find);
      if(!el) return;
      var old = el.textContent.replace(/\\s+/g," ").trim();
      textSnapshots.push({el:el, text:el.textContent});
      el.textContent = op.set;
      el.setAttribute("data-angel-retext","1");
      addBadge(container(el), "✎ NY TEXT", "text");
      diffs.push({ el:el, kind:"text", label:"Text ändrad", old:old, detail:op.set });
    });
    applied = true;
    // 3) Scrolla till FÖRSTA ändringen — inte toppen — så skillnaden syns direkt.
    if (diffs.length){
      var first = diffs[0].el;
      setTimeout(function(){ first.scrollIntoView({behavior:"smooth", block:"start"}); flash(first); }, 60);
    }
  }
  function flash(el){ el.classList.remove("angel-flash"); void el.offsetWidth; el.classList.add("angel-flash"); }
  function renderInfo(){
    var info = document.getElementById("angel-lab-info");
    info.style.display = "block";
    var html = "<b>"+current.label+"</b> — "+current.headline+
      "<br><span class='gates'>grindar: "+current.gates+"</span>";
    if (!applied){
      html += "<br><span style='color:#59636f'>FÖRE — originalsidan. Växla till EFTER så visas och märks varje ändring.</span>";
    } else if (diffs.length){
      html += "<br><b>"+diffs.length+" ändringar</b> — klicka för att hoppa till var och en:";
      html += "<ol>";
      diffs.forEach(function(d,i){
        html += "<li data-diff='"+i+"'>"+
          (d.kind==="move"
            ? "<span class='difflabel'>Flyttad:</span> "+d.label+" <span style='color:#59636f'>("+d.detail+")</span>"
            : "<span class='difflabel'>Ny text:</span> <span class='old'>"+d.old.slice(0,48)+"</span> → <span class='new'>"+d.detail.slice(0,60)+"</span>")+
          "</li>";
      });
      html += "</ol>";
    }
    info.innerHTML = html;
    Array.prototype.forEach.call(info.querySelectorAll("li[data-diff]"), function(li){
      li.onclick = function(){
        var d = diffs[Number(li.getAttribute("data-diff"))];
        if(d){ d.el.scrollIntoView({behavior:"smooth", block:"center"}); flash(d.el); }
      };
    });
  }
  function sync(){
    // Panelen ovanför baren oavsett hur många rader baren radbryts till (mobil).
    var bar=document.getElementById("angel-lab-bar");
    var info=document.getElementById("angel-lab-info");
    info.style.bottom=(bar.offsetHeight+8)+"px";
    document.body.style.paddingBottom=(bar.offsetHeight+16)+"px";
    document.getElementById("angel-fore").className = applied?"":"on";
    document.getElementById("angel-efter").className = "efter"+(applied?" on":"");
    document.getElementById("angel-efter").textContent = applied && diffs.length ? "EFTER · "+diffs.length+" ändringar" : "EFTER";
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
  window.addEventListener("resize", sync);
  sync();
})();
</script>`;

html = html.replace(/<\/body>/i, controls.replace("__VARIANTS__", JSON.stringify(VARIANTS)) + "</body>");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "index.html"), html);
console.log(`[lab-sandbox] wrote ${join(OUT_DIR, "index.html")} (${html.length} bytes, ${VARIANTS.length} varianter)`);
