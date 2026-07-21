#!/usr/bin/env bun
// FLEET LOOP REPORT — turns docs/fleet-loop-2026-07-21/{results,fleet-summary}
// into one self-contained, theme-aware HTML dashboard the owner can browse:
// the honest calibration headline, the three rates, fleet composition, and a
// filterable per-site table with per-site detail (real inventory, planted
// truth, chosen cohort, verdict, guardrails, arms).
//
//   bun run scripts/fleet-loop/report.ts   →  docs/fleet-loop-2026-07-21/report.html

import { readFileSync, writeFileSync } from "node:fs";

const DIR = "docs/fleet-loop-2026-07-21";
type Any = Record<string, unknown>;
const results = JSON.parse(readFileSync(`${DIR}/results.json`, "utf8")) as Any[];
const summary = JSON.parse(readFileSync(`${DIR}/fleet-summary.json`, "utf8")) as Any;

// Trim each site to what the UI shows — keeps the embedded payload lean.
const rows = results.map((r) => {
  const m = (r.measurement ?? {}) as Any;
  const prim = (m.primary ?? null) as Any | null;
  const cs = (r.chosenScope ?? null) as Any | null;
  return {
    name: r.name,
    url: r.url,
    outcome: r.outcome,
    profile: (r.planted as Any).profile,
    plantedRel: (r.planted as Any).primaryEffectRel,
    primary: r.primaryMetric ?? null,
    trust: (r.real as Any).trust,
    ctas: (r.real as Any).ctas,
    sections: (r.real as Any).sections,
    restoredClean: (r.real as Any).restoredClean,
    appliedPatterns: (r.real as Any).appliedPatterns,
    cohort: cs ? (cs.serveableAs as string) : null,
    cohortKeys: cs ? (cs.cohorts as string[]) : null,
    visitors: cs ? (cs.visitorsInWindow as number) : null,
    days: cs ? (cs.daysToVerdict as number) : null,
    brief: cs ? (cs.brief as string[]) : null,
    verdict: (m.verdict as string) ?? null,
    action: (m.action as string) ?? null,
    upliftRel: prim ? (prim.upliftRel as number | null) : null,
    upliftCi: prim ? (prim.upliftRelCi as [number, number] | null) : null,
    pValue: prim ? (prim.pValue as number) : null,
    served: prim ? (prim.served as Any) : null,
    holdout: prim ? (prim.holdout as Any) : null,
    guardrails: (m.guardrails as Any[]) ?? null,
    sweep: ((r.guardrailSweep as Any | undefined)?.action ?? "keep") as string,
    sweepReason: ((r.guardrailSweep as Any | undefined)?.reason ?? null) as string | null,
    pass: (r.verify as Any).pass,
    verifyReason: (r.verify as Any).reason,
  };
});

const cal = summary.calibration as Any;
const w = cal.winner as Any,
  nu = cal.null as Any,
  tr = cal.trap as Any;
const conv = rows.filter((r) => r.primary === "conversion" && r.outcome === "measured").length;
const eng = rows.filter((r) => r.primary === "engaged" && r.outcome === "measured").length;
const proxy = rows.filter((r) => r.primary === "cta_click" && r.outcome === "measured").length;

const payload = JSON.stringify({ rows, summary });

const html = `<title>Angel Adaptive — fleet loop across ${summary.sites} sites</title>
<style>
  :root {
    --bg:#F6F7F9; --surface:#FFFFFF; --surface-2:#FBFBFC; --ink:#1A2230; --ink-2:#55606F;
    --ink-3:#8A94A3; --line:#E4E7EC; --line-2:#EEF0F3; --accent:#3F4CD6;
    --good:#0B8276; --good-bg:#E7F4F1; --neutral:#64748B; --neutral-bg:#EFF1F4;
    --warn:#B45309; --warn-bg:#FBF0E3; --crit:#C0342B; --crit-bg:#FBE9E7;
    --winner:#0B8276; --nul:#64748B; --trap:#B45309;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0C1116; --surface:#12171E; --surface-2:#161C24; --ink:#E7ECF2; --ink-2:#A3AEBC;
      --ink-3:#6B7686; --line:#232B35; --line-2:#1C232C; --accent:#8A93F0;
      --good:#2DBFAD; --good-bg:#0F2420; --neutral:#8A97A8; --neutral-bg:#1A212A;
      --warn:#E0A05A; --warn-bg:#2A2015; --crit:#EE7A6E; --crit-bg:#2A1614;
      --winner:#2DBFAD; --nul:#8A97A8; --trap:#E0A05A;
    }
  }
  :root[data-theme="dark"]{--bg:#0C1116;--surface:#12171E;--surface-2:#161C24;--ink:#E7ECF2;--ink-2:#A3AEBC;--ink-3:#6B7686;--line:#232B35;--line-2:#1C232C;--accent:#8A93F0;--good:#2DBFAD;--good-bg:#0F2420;--neutral:#8A97A8;--neutral-bg:#1A212A;--warn:#E0A05A;--warn-bg:#2A2015;--crit:#EE7A6E;--crit-bg:#2A1614;--winner:#2DBFAD;--nul:#8A97A8;--trap:#E0A05A;}
  :root[data-theme="light"]{--bg:#F6F7F9;--surface:#FFFFFF;--surface-2:#FBFBFC;--ink:#1A2230;--ink-2:#55606F;--ink-3:#8A94A3;--line:#E4E7EC;--line-2:#EEF0F3;--accent:#3F4CD6;--good:#0B8276;--good-bg:#E7F4F1;--neutral:#64748B;--neutral-bg:#EFF1F4;--warn:#B45309;--warn-bg:#FBF0E3;--crit:#C0342B;--crit-bg:#FBE9E7;--winner:#0B8276;--nul:#64748B;--trap:#B45309;}
  * { box-sizing:border-box; }
  body { background:var(--bg); color:var(--ink); font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; margin:0; padding:28px 20px 72px; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1120px; margin:0 auto; display:flex; flex-direction:column; gap:22px; }
  .tnum { font-variant-numeric:tabular-nums; }
  header .eyebrow { text-transform:uppercase; letter-spacing:.09em; font-size:11px; font-weight:650; color:var(--accent); }
  header h1 { font-size:25px; font-weight:660; letter-spacing:-.02em; margin:6px 0 6px; text-wrap:balance; }
  header p { color:var(--ink-2); margin:0; max-width:76ch; }
  .banner { display:flex; align-items:center; gap:14px; background:var(--good-bg); border:1px solid color-mix(in srgb,var(--good) 30%,transparent); border-radius:12px; padding:16px 18px; }
  .banner .dot { width:10px; height:10px; border-radius:50%; background:var(--good); flex:none; box-shadow:0 0 0 4px color-mix(in srgb,var(--good) 22%,transparent); }
  .banner b { color:var(--ink); } .banner span { color:var(--ink-2); }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .card .lbl { font-size:12px; font-weight:600; color:var(--ink-2); display:flex; align-items:center; justify-content:space-between; }
  .card .big { font-size:30px; font-weight:680; letter-spacing:-.02em; margin:6px 0 2px; }
  .card .sub { font-size:12.5px; color:var(--ink-3); }
  .meter { height:7px; border-radius:99px; background:var(--line-2); margin:11px 0 3px; position:relative; overflow:hidden; }
  .meter > i { position:absolute; left:0; top:0; bottom:0; border-radius:99px; }
  .meter .tick { position:absolute; top:-3px; bottom:-3px; width:2px; background:var(--ink-3); border-radius:2px; }
  h2 { font-size:13px; font-weight:660; letter-spacing:.02em; text-transform:uppercase; color:var(--ink-2); margin:6px 0 0; }
  .compose { display:flex; flex-direction:column; gap:14px; }
  .sbar { display:flex; height:34px; border-radius:9px; overflow:hidden; border:1px solid var(--line); }
  .sbar > div { display:flex; align-items:center; justify-content:center; gap:6px; font-size:12px; font-weight:600; color:#fff; min-width:0; padding:0 8px; white-space:nowrap; }
  .sbar > div small { opacity:.85; font-weight:500; }
  .toolbar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
  .toolbar .sp { flex:1; }
  .chip { font-size:12px; font-weight:600; border:1px solid var(--line); background:var(--surface); color:var(--ink-2); border-radius:99px; padding:5px 12px; cursor:pointer; user-select:none; }
  .chip[aria-pressed="true"] { background:var(--accent); border-color:var(--accent); color:#fff; }
  input.search { font:inherit; padding:6px 11px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); min-width:160px; }
  table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  thead th { text-align:left; font-size:11px; font-weight:650; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-3); padding:11px 12px; border-bottom:1px solid var(--line); cursor:pointer; white-space:nowrap; }
  thead th.num, td.num { text-align:right; }
  tbody td { padding:10px 12px; border-bottom:1px solid var(--line-2); font-size:13px; }
  tbody tr.site { cursor:pointer; }
  tbody tr.site:hover { background:var(--surface-2); }
  .pill { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:650; padding:2px 9px; border-radius:99px; white-space:nowrap; }
  .pill.win { background:var(--good-bg); color:var(--good); } .pill.no_effect,.pill.inconclusive { background:var(--neutral-bg); color:var(--neutral); }
  .pill.loss { background:var(--crit-bg); color:var(--crit); } .pill.guardrail_breach { background:var(--warn-bg); color:var(--warn); }
  .pill.held { background:var(--warn-bg); color:var(--warn); } .pill.none { background:var(--neutral-bg); color:var(--ink-3); }
  .prof { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; }
  .prof::before { content:""; width:9px; height:9px; border-radius:2px; flex:none; }
  .prof.winner::before{background:var(--winner);} .prof.null::before{background:var(--nul);} .prof.trap::before{background:var(--trap);}
  .ok { color:var(--good); font-weight:700; } .att { color:var(--warn); font-weight:700; }
  .mono { font-family:ui-monospace,"SF Mono","Cascadia Code",monospace; font-size:12px; color:var(--ink-2); }
  tr.detail td { background:var(--surface-2); padding:0; }
  .dwrap { padding:16px 18px; display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .dwrap h4 { margin:0 0 8px; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-3); }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:3px 14px; font-size:12.5px; }
  .kv dt { color:var(--ink-3); } .kv dd { margin:0; text-align:right; }
  .arms { width:100%; border:1px solid var(--line); border-radius:8px; overflow:hidden; margin-top:4px; }
  .arms div { display:flex; font-size:12px; padding:5px 10px; border-top:1px solid var(--line-2); }
  .arms div:first-child { border-top:0; color:var(--ink-3); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
  .arms span { flex:1; } .arms span+span { text-align:right; }
  .brief { grid-column:1/-1; border-top:1px solid var(--line); padding-top:12px; }
  .brief p { margin:0 0 6px; font-size:12.5px; color:var(--ink-2); }
  .brief p:last-child { color:var(--ink-3); font-style:italic; }
  footer { color:var(--ink-3); font-size:12px; max-width:80ch; line-height:1.6; }
  .themetog { position:fixed; top:14px; right:16px; font-size:12px; font-weight:600; border:1px solid var(--line); background:var(--surface); color:var(--ink-2); border-radius:8px; padding:5px 10px; cursor:pointer; }
  @media (max-width:760px){ .grid3{grid-template-columns:1fr;} .dwrap{grid-template-columns:1fr;} .hide-sm{display:none;} }
</style>

<button class="themetog" onclick="var r=document.documentElement,d=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',d);this.textContent=d==='dark'?'☀︎ Light':'☾ Dark';">☾ Dark</button>

<div class="wrap">
  <header>
    <div class="eyebrow">Angel Adaptive · overnight fleet run</div>
    <h1>The whole loop across ${summary.sites} real sites — on fabricated traffic, with a planted truth</h1>
    <p>Each site's <b>real</b> layer (inventory + what the engine actually derived and applied per persona) comes
    from the live crawls. The <b>traffic is fabricated</b> — a seeded population per site — and each site is secretly
    a <b>winner</b>, a <b>null (A/A)</b>, or a <b>trap</b>. The loop runs the real functions end to end
    (measurable-cohort planning → cohort-gated serving → calibrated measurement → the nightly guardrail sweep),
    and the measurement must recover exactly what was planted. Reproducible: seeded from each site's name.</p>
  </header>

  <div class="banner">
    <span class="dot"></span>
    <div><b>Calibration ${summary.calibrationHealthy ? "healthy" : "VIOLATED"} — ${summary.calibrationViolations} violations.</b>
    <span>A calibration violation is the math misbehaving: a true winner falsely harmed, a trap that escaped, or a
    null false-positive rate above alpha. Null A/As tripping at ~alpha are expected and confirm the test is calibrated,
    not too conservative — and the sweep pauses them (safe, self-healing).</span></div>
  </div>

  <div class="grid3" id="cal"></div>

  <h2>Fleet composition</h2>
  <div class="compose" id="compose"></div>

  <h2>Per-site results</h2>
  <div class="toolbar" id="filters"></div>
  <table id="tbl">
    <thead><tr>
      <th data-k="name">Site</th>
      <th data-k="profile" class="hide-sm">Planted</th>
      <th data-k="primary" class="hide-sm">Primary</th>
      <th data-k="cohort">Cohort</th>
      <th data-k="visitors" class="num hide-sm">Visitors/30d</th>
      <th data-k="days" class="num hide-sm">Days</th>
      <th data-k="verdict">Verdict</th>
      <th data-k="sweep" class="hide-sm">Sweep</th>
      <th data-k="pass">Check</th>
    </tr></thead>
    <tbody id="tbody"></tbody>
  </table>

  <footer>
    Fabricated traffic, real site layer, planted ground truth — the pre-flight the whole measurement spine runs before a
    single real visitor is on the line. The one question this can't answer, by construction, is whether a real design
    change moves real visitors; the planted effect stands in for that. Data: <span class="mono">docs/fleet-loop-2026-07-21/</span>
    (results.json + fleet-summary.json). Regenerate: <span class="mono">bun run scripts/fleet-loop/run.ts</span>.
  </footer>
</div>

<script id="data" type="application/json">${payload}</script>
<script>
(function(){
  var D = JSON.parse(document.getElementById('data').textContent);
  var rows = D.rows, S = D.summary, cal = S.calibration;
  var pct = function(x){ return (x*100).toFixed(x*100>=99.5?0:1)+'%'; };
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };

  // ── Calibration tiles ──
  var powerP = cal.winner.recoveryPower||0, fpr = cal.null.fpRate||0, alpha = 0.05, catch_ = cal.trap.catchRate||0;
  document.getElementById('cal').innerHTML = [
    tile('Winner recovery power', pct(powerP), cal.winner.recoveredWin+'/'+cal.winner.measurable+' planted winners called \\u2018win\\u2019 \\u00b7 '+cal.winner.falseHarm+' false-harm',
         meter(powerP,'var(--good)', 0.80)),
    tile('Null false-positive rate', pct(fpr), cal.null.falsePositives+'/'+cal.null.measurable+' A/As tripped \\u00b7 target \\u2248 alpha '+pct(alpha),
         meter(Math.min(1,fpr/0.15),'var(--neutral)', alpha/0.15)),
    tile('Trap catch rate', pct(catch_), cal.trap.caughtAndHeld+'/'+cal.trap.measurable+' gamed proxies auto-paused \\u00b7 '+cal.trap.escaped+' escaped',
         meter(catch_,'var(--warn)', null))
  ].join('');
  function tile(l,big,sub,m){ return '<div class="card"><div class="lbl">'+l+'</div><div class="big tnum">'+big+'</div>'+m+'<div class="sub">'+sub+'</div></div>'; }
  function meter(frac,color,tick){ var t = tick!=null ? '<span class="tick" style="left:'+(tick*100)+'%"></span>' : ''; return '<div class="meter"><i style="width:'+(Math.max(2,frac*100))+'%;background:'+color+'"></i>'+t+'</div>'; }

  // ── Composition bars ──
  var meas = S.outcomes.measured, notm = S.outcomes.noMeasurableCohort, tot = S.sites;
  var pl = S.planted;
  var convN = rows.filter(function(r){return r.primary==='conversion'&&r.outcome==='measured';}).length;
  var engN = rows.filter(function(r){return r.primary==='engaged'&&r.outcome==='measured';}).length;
  var proxN = rows.filter(function(r){return r.primary==='cta_click'&&r.outcome==='measured';}).length;
  document.getElementById('compose').innerHTML =
    seg('Outcome', [['#3F4CD6',meas,'measured'],['var(--ink-3)',notm,'no measurable cohort']], tot) +
    seg('Primary metric (of measured)', [['var(--good)',convN,'conversion'],['var(--accent)',engN,'engagement'],['var(--trap)',proxN,'proxy (trap)']], meas) +
    seg('Planted profile', [['var(--winner)',pl.winner,'winner'],['var(--nul)',pl['null'],'null (A/A)'],['var(--trap)',pl.trap,'trap']], tot);
  function seg(title, parts, total){
    var bars = parts.filter(function(p){return p[1]>0;}).map(function(p){
      return '<div style="flex:'+p[1]+';background:'+p[0]+'"><b>'+p[1]+'</b> <small>'+p[2]+'</small></div>';
    }).join('');
    return '<div><div class="sub" style="margin-bottom:5px;color:var(--ink-2);font-weight:600">'+title+'</div><div class="sbar">'+bars+'</div></div>';
  }

  // ── Filters + table ──
  var state = { outcome:'all', profile:'all', check:'all', q:'', sort:'name', dir:1 };
  var F = document.getElementById('filters');
  F.innerHTML =
    grp('outcome',[['all','All'],['measured','Measured'],['no_measurable_cohort','Not measurable']]) +
    grp('profile',[['all','All'],['winner','Winner'],['null','Null'],['trap','Trap']]) +
    grp('check',[['all','All'],['attention','Needs a look']]) +
    '<span class="sp"></span><input class="search" placeholder="Filter sites\\u2026" oninput="__s(this.value)">';
  function grp(key, opts){ return opts.map(function(o){ return '<button class="chip" data-g="'+key+'" data-v="'+o[0]+'" aria-pressed="'+(state[key]===o[0])+'" onclick="__f(this)">'+o[1]+'</button>'; }).join(''); }
  window.__f = function(el){ state[el.dataset.g]=el.dataset.v; F.querySelectorAll('[data-g="'+el.dataset.g+'"]').forEach(function(b){b.setAttribute('aria-pressed', b===el);}); render(); };
  window.__s = function(v){ state.q=v.toLowerCase(); render(); };
  document.querySelectorAll('#tbl thead th').forEach(function(th){ th.onclick=function(){ var k=th.dataset.k; if(state.sort===k)state.dir*=-1; else {state.sort=k;state.dir=1;} render(); }; });

  var tb = document.getElementById('tbody');
  function verdictPill(r){
    if(r.outcome!=='measured') return '<span class="pill none">no variant</span>';
    var v=r.verdict, held=r.sweep==='hold';
    var cls = held ? 'held' : v;
    var label = held ? 'held' : v.replace('_',' ');
    return '<span class="pill '+cls+'">'+label+'</span>';
  }
  function attention(r){ // "needs a look" = a real failure OR a null that tripped (expected but worth seeing)
    return !r.pass || (r.outcome==='measured' && r.sweep==='hold' && r.profile==='null');
  }
  function render(){
    var list = rows.filter(function(r){
      if(state.outcome!=='all' && r.outcome!==state.outcome) return false;
      if(state.profile!=='all' && r.profile!==state.profile) return false;
      if(state.check==='attention' && !attention(r)) return false;
      if(state.q && r.name.toLowerCase().indexOf(state.q)<0) return false;
      return true;
    });
    list.sort(function(a,b){ var x=a[state.sort], y=b[state.sort];
      if(x==null)x=-Infinity; if(y==null)y=-Infinity;
      if(typeof x==='string') return state.dir*x.localeCompare(y);
      return state.dir*(x-y);
    });
    tb.innerHTML = list.map(rowHtml).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--ink-3);padding:26px">No sites match.</td></tr>';
  }
  function rowHtml(r){
    var chk = r.pass ? '<span class="ok">\\u2713</span>' : '<span class="att">\\u26A0</span>';
    return '<tr class="site" onclick="__d(this)" data-name="'+esc(r.name)+'">'+
      '<td><b>'+esc(r.name)+'</b></td>'+
      '<td class="hide-sm"><span class="prof '+r.profile+'">'+r.profile+'</span></td>'+
      '<td class="hide-sm mono">'+esc(r.primary||'\\u2014')+'</td>'+
      '<td class="mono">'+esc(r.cohort? 'src:'+r.cohort : '\\u2014')+'</td>'+
      '<td class="num tnum hide-sm">'+(r.visitors!=null?r.visitors.toLocaleString('en-US'):'\\u2014')+'</td>'+
      '<td class="num tnum hide-sm">'+(r.days!=null?r.days:'\\u2014')+'</td>'+
      '<td>'+verdictPill(r)+'</td>'+
      '<td class="hide-sm mono">'+esc(r.sweep==='hold'?'hold':'keep')+'</td>'+
      '<td>'+chk+'</td></tr>';
  }
  window.__d = function(tr){
    var next = tr.nextElementSibling;
    if(next && next.classList.contains('detail')){ next.remove(); return; }
    document.querySelectorAll('tr.detail').forEach(function(e){e.remove();});
    var r = rows.find(function(x){return x.name===tr.dataset.name;});
    var td = document.createElement('tr'); td.className='detail';
    td.innerHTML = '<td colspan="9">'+detail(r)+'</td>';
    tr.after(td);
  };
  function detail(r){
    var real = '<div><h4>Real site layer (from the live crawls)</h4><dl class="kv">'+
      kv('Trust signals', r.trust)+kv('CTAs', r.ctas)+kv('Sections', r.sections)+
      kv('Restored clean', r.restoredClean===true?'yes':r.restoredClean===false?'no':'\\u2014')+
      kv('Patterns applied', (r.appliedPatterns||[]).join(', ')||'\\u2014')+'</dl></div>';
    var plan = '<div><h4>Planted vs measured</h4><dl class="kv">'+
      kv('Profile', r.profile)+
      kv('Planted effect', r.plantedRel? '+'+(r.plantedRel*100).toFixed(0)+'% rel on '+esc(r.primary) : (r.profile==='null'?'zero (A/A)':'\\u2014'))+
      (r.outcome==='measured'? (
        kv('Measured uplift', r.upliftRel!=null? (r.upliftRel>=0?'+':'')+(r.upliftRel*100).toFixed(1)+'% rel' : '\\u2014')+
        kv('95% CI', r.upliftCi? Math.round(r.upliftCi[0]*100)+'%\\u2026'+Math.round(r.upliftCi[1]*100)+'%' : '\\u2014')+
        kv('p-value', r.pValue!=null? r.pValue.toFixed(4):'\\u2014')+
        kv('Verdict', r.verdict+(r.sweep==='hold'?' \\u2192 held':''))
      ) : kv('Outcome','no measurable cohort'))+
      '</dl>'+
      '<div style="margin-top:8px;font-size:12px;color:'+(r.pass?'var(--good)':'var(--warn)')+';font-weight:600">'+
      (r.pass?'\\u2713 ':'\\u26A0 ')+esc(r.verifyReason)+'</div></div>';
    var armsHtml='';
    if(r.served){
      armsHtml = '<div class="arms"><div><span>Arm</span><span>Visitors</span><span>'+esc(r.primary)+'</span></div>'+
        '<div><span>Served</span><span class="tnum">'+r.served.n.toLocaleString('en-US')+'</span><span class="tnum">'+r.served.conversions.toLocaleString('en-US')+'</span></div>'+
        '<div><span>Holdout</span><span class="tnum">'+r.holdout.n.toLocaleString('en-US')+'</span><span class="tnum">'+r.holdout.conversions.toLocaleString('en-US')+'</span></div></div>';
    }
    var guards='';
    if(r.guardrails && r.guardrails.length){
      guards = '<div style="margin-top:8px"><h4>Guardrails</h4>'+r.guardrails.map(function(g){
        return '<div style="font-size:12px;color:'+(g.breached?'var(--warn)':'var(--ink-2)')+'">'+(g.breached?'\\u26A0 ':'\\u00b7 ')+esc(g.metric)+' \\u2014 served '+(g.servedRate*100).toFixed(1)+'% vs holdout '+(g.holdoutRate*100).toFixed(1)+'%'+(g.breached?' (harmed \\u2192 pause)':'')+'</div>';
      }).join('')+'</div>';
    }
    var mid = '<div><h4>Chosen cohort A/B</h4>'+(r.cohortKeys? '<div class="mono" style="margin-bottom:6px">'+r.cohortKeys.join(' + ')+' \\u00b7 '+(r.visitors||0).toLocaleString('en-US')+' /30d \\u00b7 verdict ~'+r.days+'d</div>':'<div class="sub">Not enough per-cohort traffic to A/B within the window \\u2014 the honest outcome.</div>')+armsHtml+guards+'</div>';
    var brief = r.brief? '<div class="brief"><h4>Designer brief for this cohort</h4>'+r.brief.map(function(b){return '<p>'+esc(b)+'</p>';}).join('')+'</div>':'';
    return '<div class="dwrap">'+real+plan+mid+brief+'</div>';
  }
  function kv(k,v){ return '<dt>'+k+'</dt><dd>'+esc(v)+'</dd>'; }
  render();
})();
</script>`;

writeFileSync(`${DIR}/report.html`, html);
console.log(`report → ${DIR}/report.html (${Math.round(html.length / 1024)} KB)`);
