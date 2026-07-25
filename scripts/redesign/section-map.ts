#!/usr/bin/env bun
// Sektions-VISUALISERARE (ägarfråga 2026-07-24: "kan vi visuellt analysera
// uppdelningen innan vi litar på kod-splitten?"). Genererar en fristående HTML-
// artefakt: per sajt en "sid-skelett"-vy där varje detekterad sektion är ett
// band vars HÖJD kodar kroppsstorlek och FÄRG kodar typ — så över-/under-
// segmentering syns direkt. Golvet (extractContentModel) driver uppdelningen;
// LLM-takets domar från den senaste körningen läggs på som badge (bäst-möjliga
// matchning på rubrik). Ingen nyckel behövs — läser frusna korpus-sidor.
//
//   bun run scripts/redesign/section-map.ts --out=<fil.html> [--report=<report.txt>]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const OUT = arg("out") ?? "section-map.html";
const REPORT = arg("report");

// Kurerad, mångsidig delmängd som visar segmenteringens spännvidd: nyheter
// (extrem över-splittring), kort-band (whoop/hellofresh), rena SaaS, DTC.
const SITES: { slug: string; dir: string; host: string; label: string; cat: string }[] = [
  { slug: "whoop", dir: "capture-corpus/whoop", host: "whoop.com", label: "WHOOP", cat: "DTC" },
  { slug: "hellofresh", dir: "capture-corpus/hellofresh", host: "hellofresh.com", label: "HelloFresh", cat: "DTC" },
  { slug: "brooklinen", dir: "capture-corpus/brooklinen", host: "brooklinen.com", label: "Brooklinen", cat: "DTC" },
  { slug: "liquiddeath", dir: "capture-corpus/liquiddeath", host: "liquiddeath.com", label: "Liquid Death", cat: "DTC" },
  { slug: "docker", dir: "capture-corpus/docker", host: "docker.com", label: "Docker", cat: "Dev" },
  { slug: "digitalocean", dir: "capture-corpus/digitalocean", host: "digitalocean.com", label: "DigitalOcean", cat: "Dev" },
  { slug: "mongodb", dir: "capture-corpus/mongodb", host: "mongodb.com", label: "MongoDB", cat: "Dev" },
  { slug: "coursera", dir: "capture-corpus/coursera", host: "coursera.org", label: "Coursera", cat: "Edu" },
  { slug: "gumroad", dir: "capture-corpus/gumroad", host: "gumroad.com", label: "Gumroad", cat: "Creator" },
  { slug: "wise", dir: "capture-corpus/wise", host: "wise.com", label: "Wise", cat: "Fintech" },
  { slug: "monday", dir: "fleet-e2e/monday", host: "monday.com", label: "monday.com", cat: "SaaS" },
  { slug: "pipedrive", dir: "fleet-e2e/pipedrive", host: "pipedrive.com", label: "Pipedrive", cat: "SaaS" },
  { slug: "mailchimp", dir: "fleet-e2e/mailchimp", host: "mailchimp.com", label: "Mailchimp", cat: "SaaS" },
  { slug: "calendly", dir: "fleet-e2e/calendly", host: "calendly.com", label: "Calendly", cat: "SaaS" },
  { slug: "bbc", dir: "capture-corpus/bbc", host: "bbc.com", label: "BBC", cat: "News" },
  { slug: "wired", dir: "capture-corpus/wired", host: "wired.com", label: "WIRED", cat: "News" },
];

const EVIDENCE = new Set(["testimonials", "pricing", "logos", "stats", "comparison", "faq"]);
const GENERIC = new Set(["section", "content", "features"]);

// ── kroppsstorlek per sektion (speglar extractSections slice + dedup) ────────────
const stripTags = (s: string) =>
  s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function bodyLens(html: string): Map<string, number> {
  const m = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  const main = m ? m[1] : html;
  const heads: { text: string; hs: number; bs: number }[] = [];
  const re = /<(h[12])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(main))) {
    const text = stripTags(mm[2]);
    if (text) heads.push({ text, hs: mm.index, bs: re.lastIndex });
  }
  const fi = main.search(/<footer\b/i);
  const end = fi >= 0 ? fi : main.length;
  const out = new Map<string, number>();
  heads.forEach((h, i) => {
    const body = main.slice(h.bs, i + 1 < heads.length ? heads[i + 1].hs : Math.max(h.bs, end));
    const key = h.text.slice(0, 120).trim().toLowerCase();
    if (!out.has(key)) out.set(key, stripTags(body.replace(/data:[^"')\s]+/gi, " ")).length);
  });
  return out;
}

// ── LLM-takets domar från förra körningens report.txt (bäst-matchning) ──────────
type Verdict = { to: string; conf: number };
function loadVerdicts(): Map<string, Verdict> {
  const map = new Map<string, Verdict>(); // key: host::headingprefix(lower)
  if (!REPORT || !existsSync(REPORT)) return map;
  const txt = readFileSync(REPORT, "utf8").replace(/\\n/g, "\n");
  let host = "";
  for (const line of txt.split("\n")) {
    const h = /^###\s+https?:\/\/([^\s/]+)/.exec(line);
    if (h) {
      host = h[1].replace(/^www\./, "");
      continue;
    }
    const p = /^\s+\w+→(\w+)\s+([\d.]+)\s+\\?"(.+?)\\?"\s*$/.exec(line);
    if (p && host) map.set(`${host}::${p[3].slice(0, 40).trim().toLowerCase()}`, { to: p[1], conf: Number(p[2]) });
  }
  return map;
}

// ── färg per typ (stripe + svag ton; text står alltid på panel-bg) ──────────────
const COLOR: Record<string, string> = {
  hero: "#7c5cff",
  testimonials: "#10b981",
  pricing: "#3b82f6",
  stats: "#14b8a6",
  logos: "#06b6d4",
  comparison: "#f97316",
  faq: "#eab308",
  cta: "#ec4899",
  integrations: "#6366f1",
  video: "#ef4444",
  features: "#64748b",
  section: "#94a3b8",
  content: "#94a3b8",
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Sec { pos: number; type: string; heading: string; proof: boolean; len: number; llm?: Verdict }
interface Site { slug: string; label: string; host: string; cat: string; ok: boolean; secs: Sec[] }

const verdicts = loadVerdicts();
const sites: Site[] = [];
for (const s of SITES) {
  const f = join(s.dir, "frozen.html");
  if (!existsSync(f)) { sites.push({ ...s, ok: false, secs: [] }); continue; }
  const html = readFileSync(f, "utf8");
  const model = extractContentModel(html);
  const lens = bodyLens(html);
  const secs: Sec[] = model.sections.map((sec) => {
    const key = sec.heading.slice(0, 120).trim().toLowerCase();
    const llm = GENERIC.has(sec.type)
      ? verdicts.get(`${s.host.replace(/^www\./, "")}::${sec.heading.slice(0, 40).trim().toLowerCase()}`)
      : undefined;
    return {
      pos: sec.position,
      type: sec.type,
      heading: sec.heading,
      proof: !!sec.containsTrustSignals,
      len: lens.get(key) ?? 0,
      llm: llm && llm.conf >= 0.7 && llm.to !== sec.type ? llm : undefined,
    };
  });
  sites.push({ ...s, ok: true, secs });
}

// ── per-sajt-diagnos (summering före detalj) ────────────────────────────────────
function diagnose(secs: Sec[]): { verdict: string; tone: "over" | "under" | "ok" } {
  const n = secs.length;
  const total = secs.reduce((a, x) => a + x.len, 0) || 1;
  const biggest = Math.max(0, ...secs.map((x) => x.len));
  const tiny = secs.filter((x) => x.len < 160).length;
  const bigShare = Math.round((biggest / total) * 100);
  if (n >= 25 && tiny / n > 0.5) return { verdict: `över-splittrad — ${tiny} små block av ${n}`, tone: "over" };
  if (bigShare >= 55 && n >= 3) return { verdict: `under-splittrad — ett block är ${bigShare}% av sidan`, tone: "under" };
  if (n >= 25) return { verdict: `mycket många sektioner (${n})`, tone: "over" };
  return { verdict: `ser sammanhängande ut (${n} sektioner)`, tone: "ok" };
}

const height = (len: number) => Math.round(Math.min(300, Math.max(20, 20 + 42 * Math.log10(len + 10))));

// ── rendera ─────────────────────────────────────────────────────────────────────
const okSites = sites.filter((s) => s.ok);
const tabs = okSites
  .map((s, i) => {
    const ev = s.secs.filter((x) => EVIDENCE.has(x.type)).length;
    const d = diagnose(s.secs);
    const dot = d.tone === "over" ? "#f97316" : d.tone === "under" ? "#eab308" : "#10b981";
    return `<button class="tab${i === 0 ? " on" : ""}" data-i="${i}">
      <span class="tdot" style="background:${dot}"></span>
      <span class="tname">${esc(s.label)}</span>
      <span class="tmeta">${s.secs.length} sek · ${ev} bevis</span></button>`;
  })
  .join("");

const panels = okSites
  .map((s, i) => {
    const d = diagnose(s.secs);
    const total = s.secs.reduce((a, x) => a + x.len, 0) || 1;
    const generic = s.secs.filter((x) => GENERIC.has(x.type)).length;
    const evidence = s.secs.filter((x) => EVIDENCE.has(x.type)).length;
    const promoted = s.secs.filter((x) => x.llm).length;
    const toneClass = d.tone === "ok" ? "ok" : d.tone === "over" ? "warn" : "under";
    const bands = s.secs
      .map((x) => {
        const c = COLOR[x.type] ?? "#94a3b8";
        const gen = GENERIC.has(x.type);
        const share = Math.round((x.len / total) * 100);
        const llm = x.llm
          ? `<span class="llm" style="--c:${COLOR[x.llm.to] ?? "#5566f0"}">LLM→ ${x.llm.to} ${x.llm.conf.toFixed(2)}</span>`
          : "";
        const proof = x.proof ? `<span class="proof">proof</span>` : "";
        const evc = EVIDENCE.has(x.type) ? " ev" : "";
        return `<div class="band${gen ? " gen" : ""}${evc}" style="height:${height(x.len)}px;--c:${c}">
          <div class="bl">
            <span class="pos">${x.pos}</span>
            <span class="chip" style="background:${c}">${x.type}</span>
            ${proof}${llm}
            <span class="hd">${esc(x.heading) || "<span class=nohd>(ingen rubrik)</span>"}</span>
          </div>
          <span class="sz" title="kroppsstorlek">${x.len >= 1000 ? (x.len / 1000).toFixed(1) + "k" : x.len} · ${share}%</span>
        </div>`;
      })
      .join("");
    return `<section class="panel${i === 0 ? " on" : ""}" data-i="${i}">
      <div class="phead">
        <div><h2>${esc(s.label)} <span class="host">${esc(s.host)}</span></h2>
          <p class="diag ${toneClass}">${d.verdict}</p></div>
        <div class="stats">
          <span><b>${s.secs.length}</b> sektioner</span>
          <span><b>${generic}</b> generiska</span>
          <span><b>${evidence}</b> bevis</span>
          <span><b>${promoted}</b> LLM-lyft</span>
        </div>
      </div>
      <div class="strip">${bands}</div>
    </section>`;
  })
  .join("");

const missing = sites.filter((s) => !s.ok).map((s) => s.label);
const typesInUse = [...new Set(okSites.flatMap((s) => s.secs.map((x) => x.type)))];
const legend = typesInUse
  .sort((a, b) => (EVIDENCE.has(b) ? 1 : 0) - (EVIDENCE.has(a) ? 1 : 0))
  .map((t) => `<span class="lg"><span class="sw" style="background:${COLOR[t] ?? "#94a3b8"}"></span>${t}${EVIDENCE.has(t) ? " ●" : ""}</span>`)
  .join("");

const html = `<div class="wrap">
  <header class="top">
    <h1>Section map</h1>
    <p class="sub">Hur Angel delar en sida i sektioner — <b>bandets höjd</b> = kroppsstorlek, <b>färg</b> = typ.
    Läs formen: många små band i rad = <span class="k over">över-splittrad</span>;
    ett jättehögt band = <span class="k under">under-splittrad</span>;
    streckad kant = generisk (skickas till LLM-taket); <span class="k llm">LLM→</span> = takets dom från senaste körningen.
    Bevistyper (●) är det motorn lyfter.</p>
    <div class="legend">${legend}</div>
  </header>
  <div class="tabs">${tabs}</div>
  <main class="stage">${panels}</main>
  ${missing.length ? `<p class="miss">Ej infrusna lokalt: ${missing.join(", ")}</p>` : ""}
  <footer class="foot">Golv: <code>extractContentModel</code> över frusna korpus-sidor · LLM-lager: senaste rapportkörningen (matchad på rubrik). Genererad av <code>scripts/redesign/section-map.ts</code>.</footer>
</div>
<style>
  :root{
    --bg:#f5f6f8; --panel:#ffffff; --panel2:#fbfcfd; --ink:#171a21; --muted:#5c6675; --line:#e4e8ef;
    --accent:#4f5fe6; --over:#e8720c; --under:#c99a06; --ok:#0f9d6b;
    color-scheme:light dark;
  }
  @media (prefers-color-scheme:dark){:root{
    --bg:#0d1016; --panel:#151a22; --panel2:#111621; --ink:#e7eaf0; --muted:#8b95a6; --line:#232b38;
    --accent:#8592ff; --over:#f7943a; --under:#e6bb3a; --ok:#25c088;
  }}
  :root[data-theme="light"]{--bg:#f5f6f8;--panel:#ffffff;--panel2:#fbfcfd;--ink:#171a21;--muted:#5c6675;--line:#e4e8ef;--accent:#4f5fe6;--over:#e8720c;--under:#c99a06;--ok:#0f9d6b;}
  :root[data-theme="dark"]{--bg:#0d1016;--panel:#151a22;--panel2:#111621;--ink:#e7eaf0;--muted:#8b95a6;--line:#232b38;--accent:#8592ff;--over:#f7943a;--under:#e6bb3a;--ok:#25c088;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
  .top h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
  .sub{margin:0 0 14px;color:var(--muted);max-width:70ch;font-size:13.5px}
  .sub b{color:var(--ink);font-weight:600}
  .k{padding:0 5px;border-radius:5px;font-weight:600;font-size:12px;white-space:nowrap}
  .k.over{background:color-mix(in srgb,var(--over) 20%,transparent);color:var(--over)}
  .k.under{background:color-mix(in srgb,var(--under) 22%,transparent);color:var(--under)}
  .k.llm{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0 4px}
  .lg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block}
  .tabs{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0 16px;position:sticky;top:0;background:var(--bg);
    padding:10px 0;z-index:5;border-bottom:1px solid var(--line)}
  .tab{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel);
    color:var(--ink);border-radius:9px;padding:7px 11px;cursor:pointer;font-size:13px;transition:.12s}
  .tab:hover{border-color:var(--accent)}
  .tab.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:var(--panel2)}
  .tab .tdot{width:8px;height:8px;border-radius:50%}
  .tab .tname{font-weight:600}
  .tab .tmeta{color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums}
  .tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .panel{display:none}
  .panel.on{display:block;animation:fade .2s ease}
  @keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.panel.on{animation:none}}
  .phead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:12px}
  .phead h2{margin:0;font-size:19px;letter-spacing:-.01em}
  .phead .host{color:var(--muted);font-weight:400;font-size:13px}
  .diag{margin:4px 0 0;font-size:13px;font-weight:600}
  .diag.ok{color:var(--ok)} .diag.warn{color:var(--over)} .diag.under{color:var(--under)}
  .stats{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
  .stats b{color:var(--ink);font-size:15px}
  .strip{display:flex;flex-direction:column;gap:3px;border:1px solid var(--line);border-radius:12px;
    padding:8px;background:var(--panel2);max-height:78vh;overflow-y:auto}
  .band{position:relative;display:flex;justify-content:space-between;align-items:flex-start;gap:10px;
    border-left:4px solid var(--c);border-radius:0 7px 7px 0;padding:7px 10px;overflow:hidden;
    background:color-mix(in srgb,var(--c) 9%,var(--panel))}
  .band.ev{background:color-mix(in srgb,var(--c) 15%,var(--panel))}
  .band.gen{border-left-style:dashed;border-left-color:color-mix(in srgb,var(--c) 70%,var(--panel))}
  .bl{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
  .pos{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:16px}
  .chip{color:#fff;font-size:10.5px;font-weight:700;letter-spacing:.02em;padding:1px 6px;border-radius:5px;text-transform:lowercase;white-space:nowrap}
  .hd{font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52ch}
  .nohd{color:var(--muted);font-style:italic}
  .proof{font-size:10px;font-weight:700;color:var(--ok);border:1px solid color-mix(in srgb,var(--ok) 45%,transparent);border-radius:4px;padding:0 4px}
  .llm{font-size:10.5px;font-weight:700;color:var(--c);border:1px solid color-mix(in srgb,var(--c) 50%,transparent);
    background:color-mix(in srgb,var(--c) 12%,transparent);border-radius:4px;padding:0 5px;white-space:nowrap}
  .sz{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;flex-shrink:0}
  .miss{color:var(--muted);font-size:12.5px;margin-top:16px}
  .foot{margin-top:24px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
  code{background:color-mix(in srgb,var(--ink) 8%,transparent);padding:1px 5px;border-radius:4px;font-size:12px}
</style>
<script>
  const tabs=[...document.querySelectorAll('.tab')],panels=[...document.querySelectorAll('.panel')];
  tabs.forEach(t=>t.addEventListener('click',()=>{
    const i=t.dataset.i;
    tabs.forEach(x=>x.classList.toggle('on',x===t));
    panels.forEach(p=>p.classList.toggle('on',p.dataset.i===i));
    document.querySelector('.stage').scrollIntoView({behavior:'smooth',block:'start'});
  }));
</script>`;

writeFileSync(OUT, html);
console.log(`[section-map] wrote ${OUT} — ${okSites.length}/${sites.length} sites, ${okSites.reduce((a, s) => a + s.secs.length, 0)} sections`);
