/*!
 * Angel Adaptive — site snippet.
 *
 * The single line a customer installs:
 *   <script src="https://app.angel.example/adaptive.js" data-site="acme"></script>
 *
 * Observe-first (docs/croengine-vision.md): by default the snippet makes NO
 * visible change — it reads the visitor's context and reports the anonymous
 * journey / structure / performance only. It applies adaptations solely once the
 * site opts in (angel_sites.adaptations_enabled), and then only the safe patterns
 * the Decision Engine returns, as pure reversible DOM ops
 * (window.AngelAdaptive.reset()). The original page is never mutated on the
 * server and nothing is persisted into the DOM.
 *
 * Dependency-free, framework-free. Targets evergreen browsers.
 *
 * GO-FORWARD CUSTOMER RUNTIME (docs/adr-001-go-forward-engine.md): the server
 * Decision Engine decides, this snippet applies. The research lab engine
 * (src/adaptive-lab -> artifacts/lab/adaptive-lab.js) is a sandbox, NOT this one.
 */
(function () {
  "use strict";

  var VERSION = "0.1.2";
  // document.currentScript is null when the tag is injected asynchronously
  // (tag managers, SPA route changes), so fall back to locating it by src.
  function findScript() {
    if (document.currentScript) return document.currentScript;
    var byData = document.querySelector('script[data-site][src*="adaptive.js"]');
    if (byData) return byData;
    var ss = document.getElementsByTagName("script");
    for (var i = ss.length - 1; i >= 0; i--) {
      if (/adaptive\.js(\?|$)/.test(ss[i].src || "")) return ss[i];
    }
    return null;
  }
  var script = findScript();
  if (!script) return;

  // ---- bot gate -------------------------------------------------------------
  // Botar/automation ska aldrig in i datan eller se adaptationer: Googlebot
  // RENDERAR JS, och monitorer/headless-verktyg kör sidan som en webbläsare.
  // navigator.webdriver sätts av Selenium/Puppeteer/Playwright. Vårt eget
  // test-harness sätter __ANGEL_HARNESS__ uttryckligen före boot och släpps
  // förbi. CUBOT är ett telefonmärke — inte en bot. Serversidan filtrerar
  // dessutom auktoritativt på User-Agent (src/adaptive/bot.ts).
  var UA_STR = navigator.userAgent || "";
  var LOOKS_BOT =
    navigator.webdriver === true ||
    (/bot|crawl|spider|slurp|headless|lighthouse|prerender|phantomjs|puppeteer|playwright|selenium/i.test(
      UA_STR,
    ) &&
      !/cubot/i.test(UA_STR));
  if (LOOKS_BOT && !window.__ANGEL_HARNESS__) return;

  var site = script.getAttribute("data-site") || "demo";
  // Sandbox-speglar (site "sandbox--…") är förhandsvisningar utan riktiga
  // besökare. CWV-vakterna (touchesLcp) skyddar riktiga sidladdningar — i
  // spegeln stängs de av, annars kan en variant som rör sidans LCP-element
  // (t.ex. hero-rubriken) aldrig förhandsgranskas i Compare.
  var IS_SANDBOX = site.indexOf("sandbox--") === 0;
  // Per-site write key. Public (it ships in this tag), but it binds this install
  // to its slug so the ingest endpoints reject writes for a keyed site that
  // don't present it. Unkeyed (legacy) sites simply omit it.
  var KEY = script.getAttribute("data-key") || "";
  var base = script.getAttribute("data-endpoint") || new URL(script.src).origin;
  // data-url: vad sidan HETER för motorn, när adressfältet inte är sanningen.
  // Sandbox-spegeln serverar kundens sida från vår origin (/api/sandbox/…) —
  // utan overriden klassas varje spegel som "other" och inventory slås upp på
  // spegel-sökvägen i stället för kundens riktiga path.
  var URL_ATTR = script.getAttribute("data-url");
  var PAGE_URL = URL_ATTR || location.href;
  var DECIDE_URL = base + "/api/adaptive/decide";
  var EVENTS_URL = base + "/api/adaptive/events";
  var CONFIG_URL = base + "/api/adaptive/consent-config";

  // ---- measurement config (opt-in) -----------------------------------------
  // data-holdout: % of visitors held out as control (0 = off).
  // data-conversion-url / data-conversion-selector: how conversions fire.
  // These are per-install OVERRIDES: normally the owner sets holdout and the
  // conversion goal in the dashboard and the values arrive via the site-config
  // fetch (applySiteConfig) — the tag never needs editing after install.
  var HOLDOUT_ATTR = script.getAttribute("data-holdout");
  var HOLDOUT_PCT = parseInt(HOLDOUT_ATTR || "0", 10) || 0;
  var CONVERSION_URL = script.getAttribute("data-conversion-url") || "";
  var CONVERSION_SELECTOR = script.getAttribute("data-conversion-selector") || "";
  // The goal's visible label — resilience for click detection when the CSS
  // selector doesn't resolve on a page (structures differ across pages).
  var CONVERSION_TEXT = script.getAttribute("data-conversion-text") || "";
  // Per-sektion-synlighet (steg 9): av (default) = exakt dagens snippet, inte
  // en rad extra kod körs. Två opt-in-vägar, samma kontrakt som hold-out och
  // konverteringsmålet: TAGGEN vinner som explicit per-install-override, annars
  // gäller sajtens dashboard-konfig (applySiteConfig nedan). Sajtkonfigen finns
  // för att påslag OCH avstängning inte ska kräva en release på kundens sajt
  // (konfigsvaret cachas 5 min, så en ändring slår igenom inom det fönstret).
  var OBSERVE_SECTIONS_ATTR = script.getAttribute("data-observe-sections") || "";
  var OBSERVE_SECTIONS_SET_BY_TAG = OBSERVE_SECTIONS_ATTR !== "";
  var OBSERVE_SECTIONS = OBSERVE_SECTIONS_ATTR === "1" || OBSERVE_SECTIONS_ATTR === "true";

  var qp = new URLSearchParams(location.search);

  // ---- ägar-/admin-exkludering (revisionen 2026-07-20) ---------------------
  // ?angel_ignore=1 sätter en PERMANENT flagga i webbläsaren: därefter är
  // Angel helt av här — ingen decide, inga events, inget besök. Ägaren öppnar
  // länken en gång per webbläsare. Flaggan är en opt-OUT (som GPC) och lagras
  // därför medvetet utan consent-grind. Admin-ytor trackas aldrig alls —
  // /admin-trafik är ägaren per definition (revisionsfynd: inloggningar och
  // adminklick låg som vanliga besök i pilotdatan).
  try {
    if (qp.get("angel_ignore") === "1") localStorage.setItem("angel_ignore", "1");
    if (localStorage.getItem("angel_ignore") === "1") return;
  } catch (e) {
    /* private mode: flaggan kan inte läsas — kör vidare */
  }
  if (/^\/admin(\/|$)/.test(location.pathname)) return;

  // Demo-simulatorns overrides (?angel_source= osv) märker ALLT som skickas
  // med simulated:true — läslagret exkluderar; inget syntetiskt smyger in som
  // riktig besökardata (revisionsfynd: twitter/bing-källorna var 100 % demo).
  var SIMULATED = !!(
    qp.get("angel_source") ||
    qp.get("angel_device") ||
    qp.get("angel_returning") ||
    qp.get("angel_debug")
  );

  // ---- consent gate (anonymous-default) ------------------------------------
  // We never render our own banner. We read the site's EXISTING consent; until
  // we see a positive signal we run in ANONYMOUS mode: we still apply whatever
  // the Decision Engine returns (pure, reversible DOM — no storage; that is
  // nothing at all under observe-first until the site enables adaptations), but
  // store no persistent id, run no holdout bucketing, and send no behavioural
  // events. A later grant (TCF / Cookiebot) upgrades live. GPC/DNT are hard
  // opt-outs. Config via data-consent="granted"|"denied" overrides detection.
  var CONSENT_OVERRIDE = script.getAttribute("data-consent") || "";
  var consented = false;
  var consentBasis = "anonymous_default";

  function gpcOrDnt() {
    try {
      if (navigator.globalPrivacyControl === true) return true;
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      if (dnt === "1" || dnt === "yes") return true;
    } catch (e) {}
    return false;
  }
  function cmpGrantedSync() {
    try {
      if (
        window.Cookiebot &&
        window.Cookiebot.consent &&
        (window.Cookiebot.consent.statistics || window.Cookiebot.consent.marketing)
      )
        return "cookiebot";
    } catch (e) {}
    return null;
  }
  function resolveConsentSync() {
    if (CONSENT_OVERRIDE === "granted") {
      consentBasis = "site_signal";
      return true;
    }
    if (CONSENT_OVERRIDE === "denied") {
      consentBasis = "site_denied";
      return false;
    }
    if (gpcOrDnt()) {
      consentBasis = "gpc_dnt";
      return false;
    }
    var cmp = cmpGrantedSync();
    if (cmp) {
      consentBasis = cmp;
      return true;
    }
    return false; // no signal → anonymous
  }
  consented = resolveConsentSync();

  // Upgrade to consented mode when the site's CMP later reports a grant. We only
  // start persisting an id + sending events from that point on (no back-fill of
  // pre-consent activity). Downgrade isn't handled in this increment.
  function upgradeConsent(basis) {
    if (consented) return;
    consented = true;
    consentBasis = basis || "granted";
    try {
      vid = visitorId();
    } catch (e) {}
    // Session-id:t beräknades vid load när consent saknades (→ null). Efter en
    // LIVE consent-grant måste det sättas nu — annars bär alla journey-events
    // som skickas efter grantet sessionId:undefined och kan inte stitchas ihop
    // till en resa (granskningsfynd).
    try {
      sid = sessionId();
    } catch (e) {}
    // Refresh the consent-dependent signal fields so any decision computed
    // after this upgrade gets holdout bucketing + attribution. A no-op for the
    // fields the server ignores when anonymous.
    signals.visitorHash = vid || undefined;
    signals.holdoutPct = HOLDOUT_PCT;
    signals.consent = consentBasis;
    // isReturning-lagningen (revisionsfynd 2026-07-20: ALLA pageviews sa "ny
    // besökare"): prevVisits lästes vid boot INNAN async-consenten gav
    // lagringsrätt (readStore → {} → 0) och uppdaterades aldrig efter
    // uppgraderingen. Läs om räknaren nu — FÖRE recordVisit nedan, annars
    // räknar besöket sig självt och första besöket blir "återkommande".
    try {
      var upgraded = readStore();
      signals.isReturning = qp.get("angel_returning") === "1" || (upgraded.visits || 0) > 0;
      signals.visitCount =
        qp.get("angel_returning") === "1"
          ? Math.max(1, upgraded.visits || 0)
          : upgraded.visits || 0;
      signals.viewedPricing = signals.viewedPricing || !!upgraded.viewedPricing;
      signals.lastPath = upgraded.lastPath || signals.lastPath;
    } catch (e) {}
    try {
      recordVisit();
    } catch (e) {}
  }
  function watchConsent() {
    try {
      window.addEventListener("CookiebotOnAccept", function () {
        if (cmpGrantedSync()) upgradeConsent("cookiebot");
      });
    } catch (e) {}
    // The CMP may inject __tcfapi after us — poll briefly, then register.
    var tries = 0;
    (function pollTcf() {
      if (consented) return;
      try {
        if (window.__tcfapi) {
          window.__tcfapi("addEventListener", 2, function (tcData, ok) {
            if (!ok || !tcData) return;
            var granted =
              tcData.gdprApplies === false ||
              (tcData.purpose && tcData.purpose.consents && tcData.purpose.consents[1]);
            if (granted) upgradeConsent("tcf");
          });
          return;
        }
      } catch (e) {}
      if (tries++ < 10) setTimeout(pollTcf, 500);
    })();
  }

  // ---- visitor identity + history (localStorage — CONSENTED ONLY) ----------
  var STORE_KEY = "angel:" + site;
  function readStore() {
    if (!consented) return {}; // anonymous: never read the device
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function writeStore(s) {
    if (!consented) return; // anonymous: never write to the device
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) {
      /* private mode — non-fatal */
    }
  }
  function visitorId() {
    var s = readStore();
    if (!s.vid) {
      s.vid =
        (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
        "v" + Date.now() + Math.random().toString(16).slice(2);
      writeStore(s);
    }
    return s.vid;
  }

  var store = readStore();
  var prevVisits = store.visits || 0;
  // No persistent id in anonymous mode → server runs no holdout / attribution.
  var vid = consented ? visitorId() : null;

  // ---- anonymous SESSION id (journey backbone) -----------------------------
  // Per-flik, i sessionStorage → rensas när fliken stängs (mest integritets-
  // vänligt). Binder ihop en besökares resa (sidordning, klickordning) UTAN
  // en långlivad identifierare. Slumpat UUID, aldrig person-id. Förnyas efter
  // 30 min inaktivitet så en glömd öppen flik inte blir en oändlig "session".
  var SID_KEY = "angel_sid:" + site;
  var SID_IDLE_MS = 30 * 60 * 1000;
  function sessionId() {
    if (!consented) return null;
    try {
      var now = Date.now();
      var raw = sessionStorage.getItem(SID_KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (!s || !s.id || typeof s.t !== "number" || now - s.t > SID_IDLE_MS) {
        s = {
          id:
            (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
            "s" + now + Math.random().toString(16).slice(2),
          t: now,
        };
      } else {
        s.t = now; // touch — sliding idle window
      }
      sessionStorage.setItem(SID_KEY, JSON.stringify(s));
      return s.id;
    } catch (e) {
      return null; // sessionStorage blocked (private mode / iframe) — no journey id
    }
  }
  var sid = sessionId();

  // ---- URL-minimering (privacy) --------------------------------------------
  // Känsliga query-parametrar (email, token, order_id …) får aldrig lämna
  // klienten. En allowlist släpper igenom bara marknadsförings-/Angel-parametrar;
  // allt annat strippas FÖRE sändning. Servern skrubbar dessutom (dubbelt skydd).
  // angel_-params rapporteras ALDRIG i url/path (revisionsfynd: simulator-
  // params låg kvar i pilotens sidvägar) — de läses ur qp vid boot och ska
  // inte synas i datan. utm/klick-id:n behålls för källattribution.
  var URL_PARAM_ALLOW = /^(utm_|gclid$|fbclid$|msclkid$|ref$)/i;
  function safeUrl(raw) {
    try {
      var u = new URL(raw, location.href);
      var kept = [];
      u.searchParams.forEach(function (v, k) {
        if (URL_PARAM_ALLOW.test(k)) kept.push([k, v]);
      });
      u.search = "";
      for (var i = 0; i < kept.length; i++) u.searchParams.append(kept[i][0], kept[i][1]);
      u.hash = "";
      return u.origin + u.pathname + (u.search || "");
    } catch (e) {
      return String(raw || "")
        .split("?")[0]
        .split("#")[0];
    }
  }
  function safePath() {
    try {
      return safeUrl(location.href).replace(/^https?:\/\/[^/]+/i, "") || "/";
    } catch (e) {
      return location.pathname || "/";
    }
  }

  // ---- demo simulator overrides (?angel_source=, angel_device=, ...) --------
  function deviceWidth(d) {
    return d === "mobile" ? 375 : d === "tablet" ? 800 : 1440;
  }
  var deviceOverride = qp.get("angel_device");

  // ---- client signals ------------------------------------------------------
  var signals = {
    site: site,
    url: safeUrl(PAGE_URL),
    key: KEY || undefined,
    referrer: document.referrer ? safeUrl(document.referrer) : "",
    utmSource: qp.get("utm_source") || qp.get("angel_source") || undefined,
    utmMedium: qp.get("utm_medium") || undefined,
    utmCampaign: qp.get("utm_campaign") || undefined,
    screenWidth: deviceOverride ? deviceWidth(deviceOverride) : window.innerWidth || 0,
    language: (navigator.language || "en").split("-")[0],
    hourOfDay: new Date().getHours(),
    isReturning: qp.get("angel_returning") === "1" || prevVisits > 0,
    visitCount: qp.get("angel_returning") === "1" ? Math.max(1, prevVisits) : prevVisits,
    viewedPricing: !!store.viewedPricing,
    lastPath: store.lastPath || null,
    // Omitted (undefined) in anonymous mode so the server withholds holdout
    // bucketing + attribution. holdoutPct is 0 unless consented.
    visitorHash: vid || undefined,
    holdoutPct: consented ? HOLDOUT_PCT : 0,
    // Skiljer den EXPLICITA per-install-overriden (data-holdout, inkl. "0" som
    // avstängning) från default-0/config-timeout — servern bucketar annars
    // från dashboard-värdet (se decide-routens kommentar).
    holdoutOverride: HOLDOUT_ATTR !== null ? true : undefined,
    consent: consentBasis,
    // Sandbox-spegelns "se live" (?angel_variant=<id>): servern honorerar
    // fältet bara för sandbox-slugs — på riktiga sajter är det inert.
    forceVariant: qp.get("angel_variant") || undefined,
  };

  // ---- analytics -----------------------------------------------------------
  function send(events) {
    // Anonymous mode sends no behavioural data (no visitorHash to attribute it
    // to anyway). A later consent grant enables sending from that point on.
    if (!consented) return;
    var body = JSON.stringify({
      site: site,
      key: KEY || undefined,
      visitorHash: vid,
      sessionId: sid || undefined,
      events: events,
    });
    // Send as text/plain (a CORS-safelisted content type) so cross-origin
    // beacons need NO preflight — navigator.sendBeacon cannot perform one, and
    // application/json would force one and silently drop the beacon. The server
    // parses the JSON body regardless of the declared content type.
    try {
      // sendBeacon returns false when the UA refuses to queue (quota full) —
      // fall through to fetch instead of silently dropping the batch.
      if (
        navigator.sendBeacon &&
        navigator.sendBeacon(EVENTS_URL, new Blob([body], { type: "text/plain;charset=UTF-8" }))
      ) {
        return;
      }
    } catch (e) {
      /* fall through to fetch */
    }
    fetch(EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: body,
      keepalive: true,
    }).catch(function () {});
  }
  function track(type, payload, decisionId) {
    payload = payload || {};
    if (SIMULATED) payload.simulated = true;
    send([{ type: type, decisionId: decisionId, payload: payload, ts: Date.now() }]);
  }

  // ---- conversions ---------------------------------------------------------
  var lastDecisionId = null;
  // Skörde-spärrens tillstånd: satt av decide-flödet. adaptedThisLoad=true →
  // laddningen får aldrig skördas (se loadHarvest + kommentaren vid apply).
  var decideSettled = false;
  var adaptedThisLoad = false;
  // Public trigger: the customer calls window.AngelAdaptive.convert(value?, meta?)
  // (or configures a URL / selector). Carries visitorHash (via send) + the last
  // decisionId so the conversion can be attributed to what was shown.
  // EN conversion per sidladdning (revisionsfynd EI-1: ett klick gav två
  // rader när både klickmåls-lyssnaren och URL-målet träffade). Sessionens
  // konverteringsmått är booleskt, så vakten kostar ingen sanning.
  var convertedThisLoad = false;
  function convert(value, meta) {
    if (convertedThisLoad) return;
    convertedThisLoad = true;
    var payload = meta && typeof meta === "object" ? meta : {};
    if (value !== undefined) payload.value = value;
    track("conversion", payload, lastDecisionId);
  }
  // Success metric (v1-testdefinitionen): klick på målet eller den förstärkta
  // vägen. Fires for BOTH arms (control visitors click the real goal too), at
  // most once per pageload — the proof view counts visitors, not clicks.
  // "path" says which route was taken: the goal itself, or an Angel shortcut.
  var ctaClickSent = false;
  function trackCtaClick(path) {
    if (ctaClickSent) return;
    // Konsumera vakten bara när eventet faktiskt går iväg OCH kan attribueras:
    // utan consent släpper send() eventet, och utan decisionId hamnar klicket
    // utanför bevisets attributionsfönster ändå. Bägge kan läka senare under
    // samma sidladdning (CMP-grant, decide-svar) — då ska nästa klick räknas.
    if (!consented || lastDecisionId === null) return;
    ctaClickSent = true;
    track("cta_click", { path: path }, lastDecisionId);
  }
  // Idempotent: called after decide AND when late-arriving site config fills in
  // a conversion goal — it must only ever register listeners once. A call with
  // nothing configured is a no-op that does NOT consume the guard.
  var conversionWired = false;
  function wireConversion() {
    if (conversionWired || (!CONVERSION_URL && !CONVERSION_SELECTOR && !CONVERSION_TEXT)) return;
    conversionWired = true;
    try {
      // URL-mål läses LEVANDE (location.href) om ingen data-url-override
      // finns: en SPA kan klientnavigera till tacksidan mellan skript-parse
      // och wireConversion (decide-fönstret är sekunder) — en frusen URL
      // tappade den konverteringen (granskningsfynd). data-url (sandbox-
      // spegeln) fryser medvetet: där ÄR adressfältet fel.
      var urlNow = URL_ATTR ? PAGE_URL : location.href;
      if (CONVERSION_URL && urlNow.indexOf(CONVERSION_URL) !== -1) convert();
      if (CONVERSION_SELECTOR || CONVERSION_TEXT) {
        document.addEventListener(
          "click",
          function (e) {
            var t = e.target;
            while (t && t.nodeType === 1) {
              // Angel's injected secondary link is the "förstärkta vägen": it
              // counts as a cta_click but NEVER as a conversion — it only
              // leads toward the goal page. This check runs FIRST so a loose
              // goal selector (e.g. ".cta-row a" that also matches our
              // injected sibling) can't turn Angel's own element into a false
              // conversion. Interactive elements only, so the decorative
              // badge <span> never counts.
              if (
                (t.tagName === "A" || t.tagName === "BUTTON") &&
                t.hasAttribute("data-angel-injected")
              ) {
                trackCtaClick("assist");
                return;
              }
              // Primary: the configured CSS selector. Fallback: the goal's
              // visible label on a link/button — selectors like
              // "a:nth-of-type(2) > button" are structure-dependent and miss on
              // pages whose markup differs; the label survives that.
              // The owner types the selector freehand in the dashboard, so it
              // is hostile input: without the try/catch a malformed selector
              // would throw on EVERY click, page-wide (same reason
              // resolveNodes guards its querySelectorAll).
              var selectorHit = false;
              try {
                selectorHit = !!(
                  CONVERSION_SELECTOR &&
                  t.matches &&
                  t.matches(CONVERSION_SELECTOR)
                );
              } catch (err) {
                selectorHit = false;
              }
              if (selectorHit) {
                trackCtaClick("goal");
                convert();
                return;
              }
              if (
                CONVERSION_TEXT &&
                (t.tagName === "A" || t.tagName === "BUTTON") &&
                (t.textContent || "").trim() === CONVERSION_TEXT
              ) {
                trackCtaClick("goal");
                convert();
                return;
              }
              t = t.parentElement;
            }
          },
          true,
        );
      }
    } catch (e) {
      /* non-fatal */
    }
  }

  // ---- reversible DOM ops --------------------------------------------------
  var undoStack = [];
  function record(fn) {
    undoStack.push(fn);
  }

  // Skönhetsgrindar (steg 2-analysen): respektera besökarens OS-preferenser så
  // Angel ALDRIG försämrar upplevelsen. Läses för loggning; själva stylingen
  // sker via @media-block i ensureStyles så webbläsaren applicerar per besökare
  // utan JS.
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }
  function prefersDark() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch (e) {
      return false;
    }
  }

  function ensureStyles() {
    if (document.getElementById("angel-style")) return;
    var css =
      "[data-angel-hidden]{display:none!important}" +
      ".angel-revealed{display:revert!important}" +
      ".angel-condensed [data-angel-secondary]{display:none!important}" +
      ".angel-badge{display:inline-flex;align-items:center;gap:6px;margin:8px 8px 0 0;padding:4px 10px;font-size:12px;font-weight:600;line-height:1;border-radius:999px;background:#f3f0ff;color:#5b21b6;border:1px solid #ddd6fe}" +
      ".angel-badge::before{content:'\\2713';font-weight:700}" +
      // Secondary lower-commitment link beside the goal — inherits the site's type.
      ".angel-secondary-cta{display:inline-block;margin-left:12px;font:inherit;font-size:14px;color:inherit;opacity:.85;text-decoration:underline;text-underline-offset:3px}" +
      // Skönhetsgrind — mörkt läge: en ljuslila badge på en mörk sajt läser
      // som trasig tredjeparts-chrome. Temaanpassa injektionerna. Browsern
      // applicerar per besökare; noll JS, noll extra data.
      "@media (prefers-color-scheme:dark){" +
      ".angel-badge{background:#2e1065;color:#ddd6fe;border-color:#5b21b6}" +
      "}" +
      // Skönhetsgrind — reduced-motion: ingen puls för besökare som bett om
      // mindre rörelse.
      "@media (prefers-reduced-motion:reduce){" +
      ".angel-debug-touched{animation:none}" +
      "}" +
      // Debug-only (?angel_debug=1): make what Angel touched IMPOSSIBLE to miss —
      // a pulsing ring plus a floating label chip per touched element.
      ".angel-debug-touched{outline:3px solid #10b981!important;outline-offset:3px!important;animation:angelDebugPulse 1.6s ease-out 4}" +
      "@keyframes angelDebugPulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.55)}100%{box-shadow:0 0 0 18px rgba(16,185,129,0)}}" +
      ".angel-debug-tag{position:absolute;z-index:2147483646;pointer-events:none;padding:3px 8px;font:700 11px/1.2 -apple-system,system-ui,sans-serif;color:#fff;background:#059669;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap}";
    var el = document.createElement("style");
    el.id = "angel-style";
    el.textContent = css;
    document.head.appendChild(el);
  }

  function byText(text, tag) {
    if (!text) return [];
    var t = String(text).trim().toLowerCase();
    if (!t) return [];
    var want = tag ? String(tag).toLowerCase() : "";
    var cands = document.querySelectorAll('a,button,[role="button"],[data-angel-slot]');
    var all = [];
    var tagged = [];
    for (var i = 0; i < cands.length; i++) {
      if ((cands[i].textContent || "").trim().toLowerCase() === t) {
        all.push(cands[i]);
        if (want && cands[i].tagName.toLowerCase() === want) tagged.push(cands[i]);
      }
    }
    // Prefer matches of the expected element type; fall back to any text match.
    return tagged.length ? tagged : all;
  }

  // Resolve an adaptation's target with graceful fallbacks so a drifted
  // selector never silently no-ops: primary selector -> [data-angel-slot]
  // -> published-text match. Only the fallbacks are new; when the primary
  // selector matches, behavior is exactly as before.
  function resolveNodes(a) {
    var nodes = [];
    try {
      if (a.target) nodes = document.querySelectorAll(a.target);
    } catch (e) {}
    if (nodes.length) return nodes;
    if (a.slot) {
      try {
        var s = document.querySelectorAll('[data-angel-slot="' + a.slot + '"]');
        if (s.length) return s;
      } catch (e) {}
    }
    if (a.anchorText) return byText(a.anchorText, a.tag);
    return [];
  }

  // ---- good-tenant no-touch zones -------------------------------------------
  // Angel lives on someone else's page, next to things it does not own: the
  // site's cookie/consent banner, recommendation widgets, other tools' UI. We
  // never adapt anything inside those. Two mechanisms:
  //   * [data-angel-ignore] — the owner marks any subtree off-limits.
  //   * known CMP roots — the major consent managers' containers, so a consent
  //     banner can never be moved/hidden/emphasized (or harvested as a "CTA").
  var NO_TOUCH =
    "[data-angel-ignore]," +
    "#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay," + // Cookiebot
    "#onetrust-consent-sdk,#onetrust-banner-sdk," + // OneTrust
    "#usercentrics-root,#uc-center-container," + // Usercentrics
    ".osano-cm-window,.osano-cm-dialog," + // Osano
    "#didomi-host,#didomi-notice," + // Didomi
    ".cc-window,.cc-banner," + // cookieconsent
    "#cookiescript_injected," + // CookieScript
    "[data-lovable-cookie-root]," + // Lovable-marked custom banners
    // Generiska consent-rötter (SPEGELVÄND lista mot measure.ts CMP_ROOTS —
    // håll i synk): banners utan leverantörs-id men med ärliga namn.
    "[id*='cookie-consent' i],[class*='cookie-banner' i],[id*='consent-banner' i]," +
    ".angel-badge"; // our own injections are never re-targeted
  // Samtyckes-KNAPPTEXTER (pilotfynd 2026-07-19): Lovable bygger custom
  // banners utan igenkännbara id:n/klasser alls — men knapptexten är
  // omisskännlig. EXAKTA fraser, aldrig delsträngar: "Kakor" är en recept-
  // kategori på pilotsajten och får ALDRIG träffas. Spegelvänd lista i
  // aggregatets isConsentRef (retro-filtret) — håll i synk.
  var CONSENT_TEXT =
    /^(acceptera alla|godkänn alla|tillåt alla|endast nödvändiga|neka alla|avvisa alla|accept all( cookies)?|allow all( cookies)?|reject all( cookies)?|only necessary|necessary only|accept cookies|acceptera cookies|cookie settings|cookieinställningar|hantera cookies|manage cookies|jag förstår|got it)$/;
  function isConsentText(el) {
    try {
      var t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return t.length <= 40 && CONSENT_TEXT.test(t);
    } catch (e) {
      return false;
    }
  }
  function isNoTouch(el) {
    try {
      return !!(el && el.closest && el.closest(NO_TOUCH));
    } catch (e) {
      return false;
    }
  }

  // Elements the current apply() run actually modified, with the pattern that
  // touched them — feeds the debug outline so "what changed" is visible on-page.
  var touchedEls = [];
  // Kontraktet: varje OPS-funktion returnerar sant bara när den FAKTISKT
  // ändrade DOM:en. Callbacks här returnerar `false` för "hoppade över noden"
  // (LCP-vakt, samma-text, redan synlig …). Signalen bär skörde-spärren:
  // "applied" utan verklig ändring låste skörden på sidor där selectorerna
  // driftat — precis de sidor som behöver skördas om.
  function each(a, fn) {
    var nodes = resolveNodes(a);
    var changed = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (isNoTouch(nodes[i])) continue; // never adapt inside a no-touch zone
      if (fn(nodes[i]) === false) continue; // op declined this node — no change
      touchedEls.push({ el: nodes[i], pattern: a.pattern });
      changed++;
    }
    return changed > 0;
  }

  // ---- Core Web Vitals guardrails ------------------------------------------
  // An adaptation must never make the page it's meant to improve worse. We
  // watch the real Largest Contentful Paint element and refuse layout-affecting
  // ops on it (moving/hiding/retexting the largest paint regresses LCP and
  // shifts layout), and we never stack more than one injected badge per anchor.
  var lcpEl = null;
  // Fältmätta Core Web Vitals för RIKTIGA besökare (inte labb-PageSpeed): LCP-
  // tiden och kumulativ layout-shift ackumuleras här och skickas i page_perf
  // (se wirePerf). Samma observer som redan bevakar LCP-elementet för
  // skyddsvakten — vi läser bara ut tiden också.
  var lcpMs = null;
  var clsValue = 0;
  try {
    if (window.PerformanceObserver) {
      var lcpObserver = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        var last = entries[entries.length - 1];
        if (last) {
          if (last.element) lcpEl = last.element;
          if (typeof last.startTime === "number") lcpMs = Math.round(last.startTime);
        }
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      try {
        var clsObserver = new PerformanceObserver(function (list) {
          list.getEntries().forEach(function (e) {
            // Bara shifts utan nyligt inmatning räknas som CWV-CLS.
            if (!e.hadRecentInput && typeof e.value === "number") clsValue += e.value;
          });
        });
        clsObserver.observe({ type: "layout-shift", buffered: true });
      } catch (e2) {
        /* layout-shift entry type unsupported (Safari/Firefox) — omit CLS */
      }
    }
  } catch (e) {
    /* no LCP observer — guards below simply no-op */
  }
  // True when an op on `el` would move/hide/retext the LCP element (it IS the
  // LCP element, or wraps it, or sits inside it).
  function touchesLcp(el) {
    if (IS_SANDBOX) return false; // förhandsvisning — ingen riktig besökare att skydda
    if (!lcpEl || !el) return false;
    try {
      return el === lcpEl || el.contains(lcpEl) || lcpEl.contains(el);
    } catch (e) {
      return false;
    }
  }

  var OPS = {
    reveal: function (a) {
      return each(a, function (el) {
        var hadHidden = el.hasAttribute("data-angel-hidden");
        // Revealing something already visible is a no-op — skip the fake change.
        if (!hadHidden && el.style.display !== "none") return false;
        var prevDisplay = el.style.display;
        el.removeAttribute("data-angel-hidden");
        el.classList.add("angel-revealed");
        if (el.style.display === "none") el.style.display = "";
        record(function () {
          el.classList.remove("angel-revealed");
          if (hadHidden) el.setAttribute("data-angel-hidden", "");
          el.style.display = prevDisplay;
        });
      });
    },
    move_up: function (a) {
      return each(a, function (el) {
        if (touchesLcp(el)) return false; // reordering the LCP element shifts layout
        var parent = el.parentElement;
        if (!parent) return false;
        var nextSibling = el.nextSibling;
        parent.insertBefore(el, parent.firstChild);
        // Markören gör flytten SYNLIG för resten av systemet: utan den var
        // både hydrerings-överlevnadskollen och skörde-spärren blinda för
        // flytt-enbart-beslut (glutenforum-loopen: skördaren mätte en sida
        // där FAQ:n redan flyttats och skrev över inventoriet utan FAQ-post).
        el.setAttribute("data-angel-moved", "");
        record(function () {
          el.removeAttribute("data-angel-moved");
          parent.insertBefore(el, nextSibling);
        });
      });
    },
    // BORTTAGET (ägarregeln 2026-07-20): "emphasize" (ringen runt målet) och
    // "inject_sticky" (flytande målgenväg) — Angel flyttar aldrig målknappen
    // och ändrar aldrig dess utseende. Okända ops ignoreras tyst nedströms,
    // så ev. cachad gammal decide-respons är ofarlig.
    condense: function (a) {
      return each(a, function (el) {
        if (touchesLcp(el)) return false; // collapsing around the LCP element shifts it
        // The class only hides [data-angel-secondary] children — without any,
        // "condensing" changes nothing. Skip the fake change.
        try {
          if (!el.querySelector("[data-angel-secondary]")) return false;
        } catch (e) {}
        el.classList.add("angel-condensed");
        record(function () {
          el.classList.remove("angel-condensed");
        });
      });
    },
    set_text: function (a) {
      if (!a.value) return false;
      return each(a, function (el) {
        if (touchesLcp(el)) return false; // retexting the LCP element can regress LCP + shift
        // Prefer an inner text host so we don't clobber icons/children.
        var host = el.querySelector("[data-angel-text]") || el;
        var prev = host.textContent;
        // Same text = no change: skip the pointless write (and the false
        // "renamed X → X" it would report).
        if ((prev || "").trim() === String(a.value).trim()) return false;
        host.textContent = a.value;
        record(function () {
          host.textContent = prev;
        });
      });
    },
    inject_secondary: function (a) {
      if (!a.value || !a.href) return;
      if (/^javascript:/i.test(a.href)) return; // belt: server already refuses
      if (document.querySelector(".angel-secondary-cta")) return; // one per page
      // Första noden UTANFÖR no-touch-zonerna — text-fallbacken får aldrig
      // placera vår länk inne i ägarens [data-angel-ignore] eller en CMP.
      var nodes = resolveNodes({ target: a.target, anchorText: a.anchorText });
      var goalEl = null;
      for (var i = 0; i < nodes.length; i++) {
        if (!isNoTouch(nodes[i])) {
          goalEl = nodes[i];
          break;
        }
      }
      if (!goalEl) return;
      var parent = goalEl.parentElement;
      if (!parent) return;
      if (touchesLcp(parent)) return; // a new sibling next to the LCP shifts it
      var link = document.createElement("a");
      link.className = "angel-secondary-cta";
      link.setAttribute("data-angel-injected", "");
      link.href = a.href;
      link.textContent = a.value;
      parent.insertBefore(link, goalEl.nextSibling);
      touchedEls.push({ el: link, pattern: a.pattern });
      record(function () {
        if (link.parentElement) link.parentElement.removeChild(link);
      });
      return true;
    },
    inject_badge: function (a) {
      if (!a.value) return;
      // EN badge per sida — samma singleton-semantik som inject_sticky/
      // inject_secondary (nodes[0] + sidoguard). Tidigare applicerade each()
      // på ALLA resolvade noder: med målankrade badges (W8-E1) vars
      // anchorText text-matchar föll selector-missar tillbaka på byText, och
      // en lista med 16 identiska "Boka"-radknappar fick 16 badges
      // (granskningsfynd, våg 8). Beslutets injektionsbudget är en badge —
      // DOM-appliceringen ska vara det också.
      if (document.querySelector(".angel-badge")) return; // one per page
      var nodes = resolveNodes({ target: a.target, anchorText: a.anchorText });
      var el = null;
      for (var i = 0; i < nodes.length; i++) {
        if (!isNoTouch(nodes[i])) {
          el = nodes[i];
          break;
        }
      }
      if (!el) return;
      var anchor = el.parentElement || el;
      // Never stack a second badge on the same anchor, and never insert next
      // to the LCP element (a new sibling shifts it). The DOM check keeps a
      // hydration re-apply from duplicating a badge that survived.
      if (touchesLcp(anchor)) return;
      try {
        if (anchor.querySelector("[data-angel-injected]")) return;
      } catch (e) {}
      var badge = document.createElement("span");
      badge.className = "angel-badge";
      badge.setAttribute("data-angel-injected", "");
      badge.textContent = a.value;
      anchor.appendChild(badge);
      touchedEls.push({ el: el, pattern: a.pattern });
      record(function () {
        if (badge.parentElement) badge.parentElement.removeChild(badge);
      });
      return true;
    },
  };

  // ---- Fas 4: variant-applicering (v3, tvåfas) -------------------------------
  // KÄLLAN till appliceraren är src/adaptive/runtime/applier.ts (ADR-001 steg 4):
  // tvåfas-kontraktet, sektionsupplösningen (v3), reorder-självkollen och alla
  // designbeslut är dokumenterade och enhetstestade DÄR — inte här. Blocket
  // mellan markörerna är GENERERAT (typ-strippat, target es2017, kommentar-
  // fritt); regenerera efter varje ändring i källan:  bun run gen:applier
  // CI pinnar paret (gen:applier:check), samma disciplin som harvest-kodgen.
  // >>> GENERATED APPLIER BEGIN (scripts/build/gen-applier.ts) — DO NOT EDIT
  function retextPreserve(el, value) {
    var texts = [];
    try {
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var t;
      while (t = w.nextNode()) {
        if ((t.data || "").trim()) texts.push(t);
      }
    } catch (e) {
    }
    if (texts.length <= 1) {
      if (texts.length === 1) texts[0].data = String(value);
      else el.textContent = value;
      return;
    }
    var total = 0;
    for (var i = 0; i < texts.length; i++) total += texts[i].data.trim().length;
    var words = String(value).split(/\s+/).filter(Boolean);
    var cum = 0;
    var wi = 0;
    for (var j = 0; j < texts.length; j++) {
      var isLast = j === texts.length - 1;
      cum += texts[j].data.trim().length;
      var upto = isLast ? words.length : Math.round(cum / total * words.length);
      var frag = words.slice(wi, Math.max(wi, upto));
      wi = Math.max(wi, upto);
      texts[j].data = frag.length ? frag.join(" ") + (isLast ? "" : " ") : "";
    }
  }
  function createApplyVariant(deps) {
    return function applyVariant(v, guard) {
      if (!v || !v.ops || !v.ops.length) return false;
      try {
        if (document.querySelector("[data-angel-moved],[data-angel-retext],[data-angel-inserted]"))
          return true;
      } catch (e) {
      }
      var mainEl = document.querySelector("main") || document.body;
      function findByLocator(loc) {
        if (!loc || !loc.text) return null;
        var full = String(loc.text).replace(/\s+/g, " ").trim().toLowerCase();
        if (!full) return null;
        var els = mainEl.querySelectorAll(loc.tag || "h1,h2,h3");
        for (var i2 = 0; i2 < els.length; i2++) {
          var t = (els[i2].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (t === full) return els[i2];
        }
        var needle = full.slice(0, 24);
        for (var j = 0; j < els.length; j++) {
          var t2 = (els[j].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (t2.indexOf(needle) >= 0) return els[j];
        }
        return null;
      }
      var census = [];
      var allH2 = mainEl.querySelectorAll("h2");
      for (var c = 0; c < allH2.length; c++) {
        if (!allH2[c].closest("header,nav,footer,aside")) census.push(allH2[c]);
      }
      var censusCount = /* @__PURE__ */ new Map();
      for (var h = 0; h < census.length; h++) {
        var walk = census[h];
        while (walk && walk !== document.body.parentElement) {
          censusCount.set(walk, (censusCount.get(walk) || 0) + 1);
          walk = walk.parentElement;
        }
      }
      function bearsCensus(el2) {
        return censusCount.has(el2);
      }
      function sectionOf(headEl) {
        var n = headEl.parentElement;
        while (n && n !== document.body && n !== mainEl.parentElement) {
          if ((censusCount.get(n) || 0) === 1) {
            var p = n.parentElement;
            if (p) {
              for (var i2 = 0; i2 < p.children.length; i2++) {
                if (p.children[i2] !== n && bearsCensus(p.children[i2])) return n;
              }
            }
          }
          n = n.parentElement;
        }
        return null;
      }
      var resolved = [];
      for (var i = 0; i < v.ops.length; i++) {
        var op = v.ops[i];
        var el = findByLocator(op.locator);
        if (!el || deps.isNoTouch(el)) return false;
        if (op.op === "move_up") {
          var sec = sectionOf(el);
          if (!sec || deps.touchesLcp(sec)) return false;
          resolved.push({ op: "move_up", sec });
        } else if (op.op === "set_text") {
          if (!op.value || deps.touchesLcp(el)) return false;
          resolved.push({ op: "set_text", el, value: op.value });
        } else if (op.op === "insert_snippet") {
          if (!op.value) return false;
          var anchor = el;
          if (op.placement !== "after_h1") {
            while (anchor.parentElement && anchor.parentElement !== mainEl && anchor.parentElement !== document.body && !bearsCensus(anchor.parentElement)) {
              anchor = anchor.parentElement;
            }
          }
          if (!anchor.parentElement || deps.isNoTouch(anchor)) return false;
          var lcp0 = deps.lcpEl();
          if (op.placement !== "after_h1" && lcp0 && !anchor.contains(lcp0)) {
            try {
              if (anchor.compareDocumentPosition(lcp0) & Node.DOCUMENT_POSITION_FOLLOWING) {
                var re = lcp0;
                while (re.parentElement && re.parentElement !== mainEl && re.parentElement !== document.body && !bearsCensus(re.parentElement)) {
                  re = re.parentElement;
                }
                if (re.parentElement) anchor = re;
              }
            } catch (e) {
            }
          }
          var lcp1 = deps.lcpEl();
          if (!deps.isSandbox && lcp1 && !anchor.contains(lcp1)) {
            try {
              if (anchor.compareDocumentPosition(lcp1) & Node.DOCUMENT_POSITION_FOLLOWING)
                return false;
            } catch (e) {
            }
          }
          var insHref = typeof op.href === "string" && op.href.charAt(0) === "/" && op.href.indexOf("//") !== 0 && op.href.indexOf(":") < 0 && !/\s/.test(op.href) ? op.href : null;
          var insClass = typeof op.styleClass === "string" && /^[\w -]{1,120}$/.test(op.styleClass) ? op.styleClass : null;
          resolved.push({
            op: "insert_snippet",
            anchor,
            value: op.value,
            href: insHref,
            styleClass: insClass
          });
        } else {
          return false;
        }
      }
      var heroHead = mainEl.querySelector("h1");
      if (heroHead && heroHead.closest("header,nav,footer,aside")) heroHead = null;
      var heroClamp = null;
      if (heroHead) {
        heroClamp = heroHead;
        while (heroClamp.parentElement && heroClamp.parentElement !== mainEl && heroClamp.parentElement !== document.body && !bearsCensus(heroClamp.parentElement)) {
          heroClamp = heroClamp.parentElement;
        }
      }
      var guardOn = !!guard && !deps.isSandbox;
      try {
        if (guardOn && document.visibilityState === "hidden") guardOn = false;
      } catch (e) {
      }
      var viewH = 0;
      if (guardOn) {
        viewH = window.innerHeight || document.documentElement && document.documentElement.clientHeight || 0;
        try {
          var vv = window.visualViewport;
          if (vv && typeof vv.height === "number") {
            var vvBottom = (vv.offsetTop || 0) + vv.height;
            if (vvBottom > viewH) viewH = vvBottom;
          }
        } catch (e) {
        }
        if (!viewH) guardOn = false;
      }
      var guardBlocked = false;
      var undos = [];
      var ok = true;
      for (var a = 0; a < resolved.length && ok; a++) {
        var r0 = resolved[a];
        if (r0.op === "move_up") {
          var prev = r0.sec.previousElementSibling;
          while (prev && !bearsCensus(prev) && prev.getBoundingClientRect().height < 8) {
            prev = prev.previousElementSibling;
          }
          if (!prev || prev.parentElement !== r0.sec.parentElement) {
            ok = false;
            break;
          }
          if (heroClamp && r0.sec !== heroClamp) {
            try {
              var secBelowHero = !!(heroClamp.compareDocumentPosition(r0.sec) & Node.DOCUMENT_POSITION_FOLLOWING);
              var landsAboveHero = prev === heroClamp || !!(prev.compareDocumentPosition(heroClamp) & Node.DOCUMENT_POSITION_FOLLOWING);
              if (secBelowHero && landsAboveHero) {
                ok = false;
                break;
              }
            } catch (e) {
            }
          }
          if (guardOn) {
            var gPrev = prev.getBoundingClientRect();
            var gSec = r0.sec.getBoundingClientRect();
            if (Math.min(gPrev.top, gSec.top) < viewH) {
              guardBlocked = true;
              ok = false;
              break;
            }
          }
          var next = r0.sec.nextSibling;
          var _doc = document.documentElement;
          var _befTop = r0.sec.getBoundingClientRect().top;
          var _befH = _doc.scrollHeight, _befW = _doc.scrollWidth;
          r0.sec.parentElement.insertBefore(r0.sec, prev);
          var _rect = r0.sec.getBoundingClientRect();
          var _tol = Math.max(48, _befH * 0.03);
          if (_befTop - _rect.top < 1 || // never rose ⇒ no benefit (or DOM≠visual order)
          Math.abs(_doc.scrollHeight - _befH) > _tol || // grew/shrank the page
          _doc.scrollWidth > _befW + 2 || // new horizontal overflow
          _rect.width < 1 || _rect.height < 1) {
            if (r0.sec.parentElement) r0.sec.parentElement.insertBefore(r0.sec, next);
            ok = false;
            break;
          }
          r0.sec.setAttribute("data-angel-moved", "");
          undos.push(
            /* @__PURE__ */ (function(s, n) {
              return function() {
                s.removeAttribute("data-angel-moved");
                s.parentElement.insertBefore(s, n);
              };
            })(r0.sec, next)
          );
          deps.touched(r0.sec, "variant_moved");
        } else if (r0.op === "insert_snippet") {
          if (!document.querySelector("[data-angel-inserted]")) {
            if (guardOn) {
              var gAnchor = r0.anchor.getBoundingClientRect();
              if (gAnchor.bottom < viewH) {
                guardBlocked = true;
                ok = false;
                break;
              }
            }
            var insNode = document.createElement("p");
            if (r0.href) {
              var insLink = document.createElement("a");
              insLink.href = r0.href;
              insLink.textContent = String(r0.value);
              if (r0.styleClass) insLink.className = r0.styleClass;
              insNode.appendChild(insLink);
              insNode.style.textAlign = "center";
            } else {
              insNode.textContent = String(r0.value);
            }
            insNode.setAttribute("data-angel-inserted", "");
            r0.anchor.parentElement.insertBefore(insNode, r0.anchor.nextSibling);
            undos.push(
              /* @__PURE__ */ (function(n) {
                return function() {
                  if (n.parentElement) n.parentElement.removeChild(n);
                };
              })(insNode)
            );
            deps.touched(insNode, "variant_inserted");
          }
        } else {
          if (guardOn) {
            var gEl = r0.el.getBoundingClientRect();
            if ((gEl.width > 0 || gEl.height > 0) && gEl.top < viewH) {
              guardBlocked = true;
              ok = false;
              break;
            }
          }
          var prevHtml = r0.el.innerHTML;
          var normA = (r0.el.textContent || "").replace(/\s+/g, " ").trim();
          var normB = String(r0.value).replace(/\s+/g, " ").trim();
          if (normA !== normB) retextPreserve(r0.el, r0.value);
          r0.el.setAttribute("data-angel-retext", "");
          undos.push(
            /* @__PURE__ */ (function(e, hh) {
              return function() {
                e.removeAttribute("data-angel-retext");
                e.innerHTML = hh;
              };
            })(r0.el, prevHtml)
          );
          deps.touched(r0.el, "variant_retext");
        }
      }
      if (!ok) {
        for (var u = undos.length - 1; u >= 0; u--) {
          try {
            undos[u]();
          } catch (e) {
          }
        }
        if (guardBlocked && deps.blocked) {
          try {
            deps.blocked("viewport");
          } catch (e) {
          }
        }
        return false;
      }
      for (var rr = 0; rr < undos.length; rr++) deps.record(undos[rr]);
      return true;
    };
  }
  // <<< GENERATED APPLIER END
  // Enda handskrivna kopplingen: appliceraren får sina snippet-samarbetare
  // INJICERADE (LCP-vakt, no-touch-zoner, ångra-stacken, debug-flödet) i
  // stället för att nå snippet-globaler. lcpEl läses via getter (muterbart
  // state); touchedEls via closure över VARIABELN — apply() binder om arrayen
  // per körning, en direkt referens hade pushat till en förbrukad array.
  // Flimmervaktens ärlighetskanal: sätts av appliceraren när vakten (inte
  // upplösningen) sa nej — skiljer "besökaren står i regionen" från "målen
  // finns inte" när utebliven applicering loggas. Nollas per apply()-körning.
  var lastApplyBlocked = null;
  var applyVariant = createApplyVariant({
    isNoTouch: isNoTouch,
    touchesLcp: touchesLcp,
    lcpEl: function () {
      return lcpEl;
    },
    isSandbox: IS_SANDBOX,
    record: record,
    touched: function (el, pattern) {
      touchedEls.push({ el: el, pattern: pattern });
    },
    blocked: function (reason) {
      lastApplyBlocked = reason;
    },
  });

  // NÅDFÖNSTRET (flimmermätningen 2026-08-09): inom 500 ms efter första
  // målningen är sidan fortfarande i uppbyggnad — en applicering där mättes
  // till CLS 0,06 (under "bra"-gränsen 0,1) och släpps ovaktad, exakt dagens
  // beteende. EFTER fönstret aktiveras flimmervakten i appliceraren: en sen
  // applicering (långsam decide, hydrerings-omförsöket, överlevnadsvakten)
  // får då bara röra regioner helt nedanför viewporten — den uppmätta
  // 0,34-klassen var precis en sen flytt i besökarens synfält. Före första
  // målningen kan inget flimra (inget är ritat) ⇒ ovaktat. Saknar webbläsaren
  // paint-timing faller vi öppet till dagens beteende — hellre dagens kända
  // läge än en vakt som dömer utan mätpunkt.
  function applyGuardActive() {
    try {
      var fcp = 0;
      var paints = performance.getEntriesByType("paint");
      for (var i = 0; i < paints.length; i++) {
        if (paints[i].name === "first-contentful-paint") fcp = paints[i].startTime;
      }
      if (!fcp) return false;
      return performance.now() > fcp + 500;
    } catch (e) {
      return false;
    }
  }

  function apply(decision) {
    ensureStyles();
    touchedEls = [];
    lastApplyBlocked = null;
    var applied = [];
    if (decision.variant) {
      try {
        if (applyVariant(decision.variant, applyGuardActive()))
          applied.push("variant:" + decision.variant.id);
      } catch (e) {
        /* variant must never break the host page */
      }
    }
    (decision.adaptations || []).forEach(function (a) {
      var op = OPS[a.op];
      if (!op) return;
      try {
        // "applied" betyder ÄNDRADE — ops returnerar sant bara vid verklig
        // DOM-förändring. Ett beslut vars selektorer driftat bort ur sidan är
        // ingen adaptation: sidan är orörd, skörden ska förbli öppen och
        // debug-läget ska inte peka på element ingen rört.
        if (op(a)) applied.push(a.pattern);
      } catch (e) {
        /* one bad selector must not break the rest */
      }
    });
    // Debug mode: pulsing ring + floating label on every element that was
    // actually modified, and scroll the first one into view — "what changed"
    // must be impossible to miss. The dashboard's "see it as this visitor"
    // previews open with ?angel_debug=1.
    if (isDebug()) markTouched();
    return applied;
  }

  var DEBUG_LABEL = {
    // emphasize_goal/sticky_goal_cta borttagna (ägarregeln 2026-07-20) —
    // opsen har inga hanterare och kan aldrig appliceras, så etiketterna
    // var döda; kvarlämnade fick de koden att se ut att kunna serva en
    // sticky-knapp (ägarfråga 2026-07-28).
    show_secondary_cta: "added a softer path",
    clarify_cta: "rewrote the button text",
    shorten_hero: "tightened the hero",
    show_trust_badge: "surfaced a trust badge",
    // Variant-ops (Compare-vyn): taggen ska säga VAD som hände per element.
    variant_moved: "moved up",
    variant_retext: "rewrote this text",
    variant_inserted: "surfaced info from another page",
  };
  function markTouched() {
    // Old tags from a previous apply (hydration re-run) are stale — clear them.
    try {
      var old = document.querySelectorAll(".angel-debug-tag");
      for (var j = 0; j < old.length; j++) old[j].parentNode.removeChild(old[j]);
    } catch (e) {}
    var first = null;
    for (var i = 0; i < touchedEls.length; i++) {
      try {
        var el = touchedEls[i].el;
        el.classList.add("angel-debug-touched");
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        var tag = document.createElement("div");
        tag.className = "angel-debug-tag";
        tag.textContent =
          "✳ Angel " + (DEBUG_LABEL[touchedEls[i].pattern] || touchedEls[i].pattern);
        tag.style.left = Math.max(4, rect.left + (window.scrollX || 0)) + "px";
        tag.style.top = Math.max(4, rect.top + (window.scrollY || 0) - 26) + "px";
        document.body.appendChild(tag);
        if (!first) first = el;
      } catch (e) {
        /* decorative only */
      }
    }
    if (first) {
      var target = first;
      setTimeout(function () {
        try {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (e) {}
      }, 600);
    }
  }

  // ---- test seam (inert in production) -------------------------------------
  // An automated robustness harness can set window.__ANGEL_HARNESS__ = true
  // before this script runs to drive the REAL apply/reset/target-resolution
  // against a page with a provided decision — no network round-trip. Never set
  // in production, so this block is dead code for real visitors.
  if (typeof window !== "undefined" && window.__ANGEL_HARNESS__) {
    window.__angel = {
      apply: function (decision) {
        return apply(decision || { adaptations: [] });
      },
      // Report the currently-observed LCP element (id/tag) so a test can wait
      // for LCP capture before asserting the CWV guards. Null until observed.
      lcp: function () {
        return lcpEl ? lcpEl.id || lcpEl.tagName.toLowerCase() : null;
      },
      reset: function () {
        while (undoStack.length) {
          try {
            undoStack.pop()();
          } catch (e) {
            /* keep unwinding */
          }
        }
      },
      // Mirror resolveNodes() but report which locator matched, for hit-rate.
      probe: function (a) {
        var via = "none";
        var count = 0;
        try {
          if (a.target) {
            var n = document.querySelectorAll(a.target);
            if (n.length) {
              via = "selector";
              count = n.length;
            }
          }
        } catch (e) {
          /* invalid selector — fall through */
        }
        if (!count && a.slot) {
          try {
            var s = document.querySelectorAll('[data-angel-slot="' + a.slot + '"]');
            if (s.length) {
              via = "slot";
              count = s.length;
            }
          } catch (e) {
            /* ignore */
          }
        }
        if (!count && a.anchorText) {
          var t = byText(a.anchorText, a.tag);
          if (t.length) {
            via = "text";
            count = t.length;
          }
        }
        return { via: via, count: count };
      },
      // Count of Angel-applied residue still present (0 == fully reversed).
      residue: function () {
        try {
          return document.querySelectorAll(
            ".angel-revealed,.angel-emphasized,.angel-condensed,[data-angel-injected],[data-angel-moved],[data-angel-retext],[data-angel-inserted]",
          ).length;
        } catch (e) {
          return -1;
        }
      },
    };
  }

  // ---- engagement tracking -------------------------------------------------
  var engagementWired = false;
  function wireEngagement(decisionId) {
    // Idempotent (samma skäl som wireJourney): decides .then→.catch-fall får
    // inte dubbelregistrera scroll-lyssnaren och dubbla scroll_depth.
    if (engagementWired) return;
    engagementWired = true;
    // (cta_click lives in wireConversion's click listener — goal clicks and
    // Angel-shortcut clicks share the same capture-phase walk. The old
    // [data-angel-slot]-based cta_click that used to live here was a demo
    // leftover that never fired on real sites.)

    // Scroll depth — fire each 25% bucket once PER SIDVÄG. Path i payloaden
    // gör per-sida attention map möjlig (ägarbeslut 2026-07-19), och SPA-
    // ruttbyten upptäcks lat vid nästa scroll: nytt path ⇒ nollställ buckets,
    // annars smetas ett djup från förra sidan över på nästa.
    var buckets = { 25: false, 50: false, 75: false, 100: false };
    var scrollPath = safePath();
    window.addEventListener(
      "scroll",
      function () {
        var p = safePath();
        if (p !== scrollPath) {
          scrollPath = p;
          buckets = { 25: false, 50: false, 75: false, 100: false };
        }
        var doc = document.documentElement;
        var max = doc.scrollHeight - doc.clientHeight;
        if (max <= 0) return;
        var pct = Math.round((doc.scrollTop / max) * 100);
        [25, 50, 75, 100].forEach(function (b) {
          if (pct >= b && !buckets[b]) {
            buckets[b] = true;
            track("scroll_depth", { depth: b, path: scrollPath }, decisionId);
          }
        });
      },
      { passive: true },
    );
  }

  // ---- observe-only: real-visitor performance + device depth ---------------
  // EN page_perf-händelse per sidladdning: fältmätta CWV (LCP/CLS) + navigation-
  // timing (TTFB, DOMContentLoaded, load) + enhetsdjup (uppkoppling, minne,
  // kärnor, viewport, preferenser, tidszon). Ren observation — påverkar aldrig
  // sidan, consent-gatas som allt annat (send() släpper utan samtycke). Skickas
  // efter load så navigation-timing hunnit bli komplett; LCP/CLS läses vid den
  // punkten (rimligt fältvärde utan att vänta på hela sidans livstid).
  var perfSent = false;
  var perfWired = false;
  function wirePerf(decisionId) {
    // Idempotent registrering (perfSent gatar bara själva utskicket; utan den
    // här vakten skulle en dubbelkallning lämna en andra load-lyssnare kvar).
    if (perfWired) return;
    perfWired = true;
    function emit() {
      if (perfSent) return;
      perfSent = true;
      var p = {};
      try {
        var nav =
          (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || null;
        if (nav) {
          p.ttfb = Math.round(nav.responseStart || 0);
          p.domContentLoaded = Math.round(nav.domContentLoadedEventEnd || 0);
          p.load = Math.round(nav.loadEventEnd || 0);
        } else if (performance.timing) {
          var t = performance.timing;
          var base = t.navigationStart || 0;
          p.ttfb = Math.max(0, (t.responseStart || 0) - base);
          p.domContentLoaded = Math.max(0, (t.domContentLoadedEventEnd || 0) - base);
          p.load = Math.max(0, (t.loadEventEnd || 0) - base);
        }
      } catch (e) {
        /* timing best-effort */
      }
      if (lcpMs !== null) p.lcp = lcpMs;
      p.cls = Math.round(clsValue * 1000) / 1000; // 3 decimaler räcker
      // Preferenser (INTE fingeravtryck): dessa två styr faktiska
      // skönhetsgrindar — reduced-motion stänger av emfas-pulsen, dark mode
      // temaanpassar injektionerna (se ensureStyles/prefsClass). Vi loggar
      // dem också så andelen syns i diagnosen. Enhets-fingeravtryck (minne,
      // kärnor, uppkoppling, tidszon) samlas MEDVETET INTE — de är
      // oanvändbara vid SMB-trafik och ren integritetsyta (steg 2-analysen).
      try {
        p.reducedMotion = prefersReducedMotion();
        p.darkMode = prefersDark();
      } catch (e) {}
      track("page_perf", p, decisionId);
    }
    // Efter load; om load redan skett, skjut till nästa tick så LCP/CLS-
    // observers hunnit rapportera buffrade poster.
    if (document.readyState === "complete") setTimeout(emit, 1200);
    else
      window.addEventListener(
        "load",
        function () {
          setTimeout(emit, 1200);
        },
        { once: true },
      );
  }

  // ---- journey intelligence (klickordning, form-lifecycle, tid + exit) -----
  // Anonym beteenderesa (docs/journey-intelligence.md). session_id binder ihop
  // sidorna; klickordningen är intent-signalen. Allt consent-gatat via send().
  // Aldrig fältinnehåll, aldrig sidans fulltext — bara elementets referens.
  function hrefPath(href) {
    try {
      var u = new URL(href, location.href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.pathname || "/";
    } catch (e) {
      return "";
    }
  }
  function elementRef(el) {
    try {
      // Stabil identifierare först — ALDRIG sidans fulltext (personaliserad
      // knapptext kan bära namn: "Fortsätt som John Andersson").
      var explicit =
        el.getAttribute("data-angel-ref") ||
        (el.id && /^[A-Za-z][\w-]{0,60}$/.test(el.id) ? "#" + el.id : "") ||
        el.getAttribute("aria-label");
      if (explicit) return String(explicit).slice(0, 60);
      // Länkar: href-PATHEN är renare än ev. personaliserad synlig text.
      if (el.tagName === "A") {
        var hp = hrefPath(el.getAttribute("href") || "");
        if (hp) return hp.slice(0, 60);
      }
      // Sista utväg: kort synlig etikett (oftast sajtens egen UI-copy), en rad,
      // hårt cappad. Servern PII-skrubbar dessutom (scrubPath i buildEventRows).
      // Kedjan vässad för IKONKNAPPAR (berättelse-tidslinjen 2026-07-19:
      // "klickade på BUTTON" är en dålig mening): title → bild-alt →
      // svg-title innan taggnamnet får bli namnet.
      var txt = (el.textContent || "").trim().split("\n")[0];
      if (txt) return String(txt).slice(0, 40);
      var ttl = el.getAttribute("title");
      if (ttl) return String(ttl).slice(0, 40);
      var img = el.querySelector ? el.querySelector("img[alt]") : null;
      if (img && img.getAttribute("alt")) return String(img.getAttribute("alt")).slice(0, 40);
      var svgT = el.querySelector ? el.querySelector("svg title") : null;
      if (svgT && svgT.textContent) return String(svgT.textContent).trim().slice(0, 40);
      return String(el.tagName || "").slice(0, 40);
    } catch (e) {
      return "";
    }
  }
  // Formulär bär mest PII i sin fulltext (förifyllda fält, leveransadress) —
  // ref hämtas ENBART ur strukturella identifierare, aldrig text.
  function formRef(form) {
    try {
      var r =
        form.getAttribute("data-angel-ref") ||
        (form.id && /^[A-Za-z][\w-]{0,60}$/.test(form.id) ? "#" + form.id : "") ||
        form.getAttribute("name") ||
        form.getAttribute("aria-label");
      if (r) return String(r).slice(0, 60);
      var action = form.getAttribute("action");
      if (action) {
        var p = hrefPath(action);
        if (p) return ("form:" + p).slice(0, 60);
      }
      return "form";
    } catch (e) {
      return "form";
    }
  }
  function formKind(form) {
    try {
      if (form.getAttribute("role") === "search" || form.querySelector('input[type="search"]'))
        return "search";
      var inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"])');
      if (inputs.length === 1) {
        var h = (
          (inputs[0].getAttribute("type") || "") +
          " " +
          (inputs[0].getAttribute("name") || "") +
          " " +
          (inputs[0].getAttribute("autocomplete") || "")
        ).toLowerCase();
        if (/email|e-?post|newsletter|nyhetsbrev/.test(h)) return "newsletter";
      }
      return "other";
    } catch (e) {
      return "other";
    }
  }
  var journeyWired = false;
  function wireJourney(decisionId) {
    // Idempotent: decides .then kan köra hit och sedan kasta → .catch kör
    // wireJourney igen. Utan vakten dubbelregistreras alla lyssnare och varje
    // journey-event skickas två gånger (granskningsfynd).
    if (journeyWired) return;
    journeyWired = true;
    var clickSeq = 0;
    var CLICK_CAP = 50; // bounded payload — a human can't out-click this per load
    var INTERACTIVE = 'a[href],button,[role="button"],input[type="submit"],[data-angel-ref]';
    // Rage-click-detektor (croengine-vision.md): ≥RAGE_MIN snabba klick på SAMMA
    // ref inom RAGE_WINDOW ms = en äkta frustrationssignal ("ser klickbart ut,
    // händer inget"). En emit per burst, taket RAGE_CAP mot brus. Ingen ny
    // PII-yta (samma ref vi redan fångar); driver ALDRIG en ändring — bara
    // diagnostik för ägaren/AI:n.
    var RAGE_MIN = 3,
      RAGE_WINDOW = 1000,
      RAGE_CAP = 20;
    var rageRef = null,
      rageStart = 0,
      rageCount = 0,
      rageFired = false,
      rageEmitted = 0;
    // Klickordning: capture-fas så vi ser klicket även om sidan stoppar det.
    document.addEventListener(
      "click",
      function (e) {
        try {
          // Ruttbyte-katch-up: ramverk som HÅRT ersätter history.pushState
          // efter boot (utan att delegera) tappar vår hook — men en människa
          // interagerar EFTER navigeringen. Första klicket på en ny path
          // skickar då SPA-pageviewen först, så resan förblir följbar.
          // No-op när hooken lever (pathen är redan bokförd).
          onRouteChange();
          var t = e.target;
          var el = t && t.closest ? t.closest(INTERACTIVE) : null;
          if (!el || isNoTouch(el)) return; // aldrig CMP-/no-touch-klick
          // Custom consent-banners utan igenkännbart id (pilotfyndet):
          // samtyckes-klick är bannerns UX, inte sajtens — och bannern är
          // fast-positionerad så punkten kan aldrig ritas rätt på kartan.
          if (isConsentText(el)) return;
          // Angels egna injicerade element hör inte till sajtens EGNA resa —
          // de fångas redan som "assist" i cta_click. Håll journey ren.
          if (el.hasAttribute && el.hasAttribute("data-angel-injected")) return;
          var ref = elementRef(el);
          // Klickposition som heltals-% av sidan (x av viewportbredd, y av
          // dokumenthöjd inkl. scroll) — driver ägarens klick-heatmap. Ingen
          // ny PII-yta: två avrundade procenttal, inga pixlar, inga fält.
          var xPct = 0,
            yPct = 0;
          try {
            var docH = Math.max(
              1,
              (document.documentElement && document.documentElement.scrollHeight) || 1,
            );
            xPct = Math.max(
              0,
              Math.min(
                100,
                Math.round(((e.clientX || 0) / Math.max(1, window.innerWidth || 1)) * 100),
              ),
            );
            yPct = Math.max(
              0,
              Math.min(100, Math.round((((e.clientY || 0) + (window.scrollY || 0)) / docH) * 100)),
            );
          } catch (posErr) {
            /* position är bäst-effort */
          }
          // Rage-click FÖRE klick-taket: en burst ska räknas även när element_click
          // nått CLICK_CAP (rage är per definition många snabba klick).
          var now = Date.now();
          if (ref === rageRef && now - rageStart <= RAGE_WINDOW) {
            rageCount++;
            if (rageCount >= RAGE_MIN && !rageFired && rageEmitted < RAGE_CAP) {
              rageFired = true;
              rageEmitted++;
              track(
                "rage_click",
                { ref: ref, count: rageCount, path: safePath(), x: xPct, y: yPct },
                decisionId,
              );
            }
          } else {
            rageRef = ref;
            rageStart = now;
            rageCount = 1;
            rageFired = false;
          }
          if (clickSeq >= CLICK_CAP) return;
          clickSeq++;
          track(
            "element_click",
            {
              seq: clickSeq,
              ref: ref,
              tag: (el.tagName || "").toLowerCase(),
              path: safePath(),
              x: xPct,
              y: yPct,
            },
            decisionId,
          );
        } catch (err) {
          /* aldrig bryta sidan */
        }
      },
      true,
    );
    // Form-lifecycle: start (första fokus), submit, abandon (startad utan submit
    // vid sidbyte). ALDRIG fältvärden — bara formulärets art + referens.
    var started = {};
    var submitted = {};
    document.addEventListener(
      "focusin",
      function (e) {
        try {
          var form = e.target && e.target.closest ? e.target.closest("form") : null;
          if (!form || isNoTouch(form)) return;
          var ref = formRef(form);
          if (started[ref]) return;
          started[ref] = formKind(form);
          track("form_start", { ref: ref, kind: started[ref], path: safePath() }, decisionId);
        } catch (err) {}
      },
      true,
    );
    document.addEventListener(
      "submit",
      function (e) {
        try {
          var form = e.target;
          if (!form || isNoTouch(form)) return;
          var ref = formRef(form);
          submitted[ref] = true;
          track(
            "form_submit",
            { ref: ref, kind: started[ref] || formKind(form), path: safePath() },
            decisionId,
          );
        } catch (err) {}
      },
      true,
    );
    // Sajtsök (ägarbeslut 2026-07-19, dokumenterat undantag på integritets-
    // sidan): enbart SKICKADE söktermer från DEDIKERADE sökfält — aldrig
    // tangent för tangent, aldrig andra formulärfält. Vakterna i ordning:
    // fältet måste kvala som sökfält, termen läses bara vid submit/Enter/
    // change (blur), mejl-/nummerliknande termer hoppas, dubblett-skydd,
    // hårt tak per sidladdning. Servern cleanText-skrubbar dessutom termen.
    var searchesSent = 0;
    var SEARCH_CAP = 20;
    var lastSearchTerm = "";
    function isSearchField(el) {
      if (!el || el.tagName !== "INPUT" || isNoTouch(el)) return false;
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "search") return true;
      if (type !== "text") return false;
      var name = (
        (el.getAttribute("name") || "") +
        " " +
        (el.getAttribute("id") || "") +
        " " +
        (el.getAttribute("placeholder") || "")
      ).toLowerCase();
      if (/(^|[^a-z])(q|s|query|search|sok|sök)([^a-z]|$)/.test(name)) return true;
      var form = el.form;
      return !!(
        form &&
        (form.getAttribute("role") === "search" ||
          /search|sok/i.test(form.getAttribute("action") || ""))
      );
    }
    function emitSearch(el) {
      try {
        if (searchesSent >= SEARCH_CAP || !isSearchField(el)) return;
        var term = String(el.value || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        if (term.length < 2 || term === lastSearchTerm) return;
        // Aldrig personuppgifter: termer som ser ut som mejl eller långa tal
        // skickas inte alls (servern skrubbar dessutom en gång till).
        if (term.indexOf("@") !== -1 || /\d{6,}/.test(term)) return;
        lastSearchTerm = term;
        searchesSent++;
        track("site_search", { term: term, path: safePath() }, decisionId);
      } catch (err) {
        /* aldrig bryta sidan */
      }
    }
    document.addEventListener(
      "submit",
      function (e) {
        try {
          var f = e.target;
          if (!f || !f.querySelector) return;
          emitSearch(
            f.querySelector('input[type="search"]') || f.querySelector('input[type="text"]'),
          );
        } catch (err) {}
      },
      true,
    );
    document.addEventListener(
      "keydown",
      function (e) {
        // Läser ALDRIG tangenten i sig — Enter är bara "skicka"-signalen för
        // sökfält utan form (vanligt i klientsidiga SPA-sök).
        if (e.key === "Enter") emitSearch(e.target);
      },
      true,
    );
    document.addEventListener(
      "change",
      function (e) {
        // change fyrar vid blur när värdet ändrats — fångar type-to-filter-sök
        // utan submit/Enter. Fortfarande bara kvalade sökfält, aldrig annat.
        emitSearch(e.target);
      },
      true,
    );
    // Videosignalen (ägarbeslut 2026-07-19, berättelse-tidslinjen): EN
    // summerad video_watch per video och sidväg — aldrig innehåll, aldrig
    // positioner, bara "tittade N sekunder". Flushas vid ruttbyte + pagehide.
    var videoWatch = [];
    var VIDEO_CAP = 10;
    function videoEntry(el) {
      for (var i = 0; i < videoWatch.length; i++) {
        if (videoWatch[i].el === el) return videoWatch[i];
      }
      if (videoWatch.length >= VIDEO_CAP) return null;
      var e = { el: el, ref: elementRef(el), path: safePath(), ms: 0, startedAt: 0 };
      videoWatch.push(e);
      return e;
    }
    function pauseVideo(t) {
      try {
        if (!t || t.tagName !== "VIDEO") return;
        for (var i = 0; i < videoWatch.length; i++) {
          var e = videoWatch[i];
          if (e.el === t && e.startedAt) {
            e.ms += Date.now() - e.startedAt;
            e.startedAt = 0;
          }
        }
      } catch (err) {}
    }
    function flushVideos() {
      try {
        var now = Date.now();
        for (var i = 0; i < videoWatch.length; i++) {
          var e = videoWatch[i];
          var playing = !!e.startedAt;
          if (playing) e.ms += now - e.startedAt;
          e.startedAt = 0;
          if (e.ms >= 1000) {
            track("video_watch", { ref: e.ref, path: e.path, watchedMs: e.ms }, decisionId);
            e.ms = 0;
          }
          // En video som fortfarande spelar (t.ex. över ett SPA-ruttbyte)
          // fortsätter klockas — annars tappas allt efter första flushen.
          if (playing) e.startedAt = now;
        }
      } catch (err) {}
    }
    document.addEventListener(
      "play",
      function (ev) {
        try {
          var t = ev.target;
          if (!t || t.tagName !== "VIDEO" || isNoTouch(t)) return;
          var e = videoEntry(t);
          if (e && !e.startedAt) e.startedAt = Date.now();
        } catch (err) {}
      },
      true,
    );
    document.addEventListener(
      "pause",
      function (ev) {
        pauseVideo(ev.target);
      },
      true,
    );
    document.addEventListener(
      "ended",
      function (ev) {
        pauseVideo(ev.target);
      },
      true,
    );
    // ---- per-sektion-synlighet (steg 9, opt-in: data-observe-sections) ----
    // Observera-bara: VILKA sektioner besökaren faktiskt såg och hur länge —
    // datat beteende-rankningen (steg 7-8) står på. Censusen SPEGLAR applierns
    // v3-census (main-h2:or utan header/nav/footer/aside — genererade blocket,
    // håll i synk): samma sektionsbegrepp i mätning som i servering.
    // Rubriknyckel + instansantal är exakt rollupens kontrakt
    // (SectionObservation, engagement-rollup.ts): dubblettrubriker rapporteras
    // med n>1 så de ALDRIG krediteras (rollupens FLERTYDIG-dom), och rubriken
    // observeras i stället för sektions-wrappern — kort element ⇒ tröskeln
    // fungerar även för sektioner högre än viewporten, samma proxy för alla
    // sektioner (rättvist för rankningen). Ingen DOM rörs någonsin.
    var sectionEntries = null;
    var sectionFlushes = null;
    var sectionIos = [];
    // Sektionernas HEMVIST-rutt låses vid uppkopplingen (granskningsfynd
    // 2026-08-08: leave() stämplade annars SPA-lämningens NYA rutt på GAMLA
    // sidans sektioner — kontaminerad attribution).
    var sectionsPath = safePath();
    if (OBSERVE_SECTIONS && typeof IntersectionObserver !== "undefined") {
      try {
        var wireSectionCensus = function () {
        var secMain = document.querySelector("main") || document.body;
        var secAllH2 = secMain.querySelectorAll("h2");
        var secFiltered = [];
        for (var sc = 0; sc < secAllH2.length; sc++) {
          if (!secAllH2[sc].closest("header,nav,footer,aside")) secFiltered.push(secAllH2[sc]);
        }
        // Instansräkningen görs över HELA filtrerade censusen med EXAKT samma
        // nyckelhärledning som uppslaget (slice 120 FÖRE gemener) — cap-först
        // räknade en dubblett bortom taket som 1, och osliceade nycklar
        // missade uppslag för rubriker > 120 tecken (granskningsfynd
        // 2026-08-08): bägge fick rollupen att kreditera det den ska vägra.
        var secCounts = {};
        for (var sk = 0; sk < secFiltered.length; sk++) {
          var skKey = (secFiltered[sk].textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120)
            .toLowerCase();
          if (skKey) secCounts[skKey] = (secCounts[skKey] || 0) + 1;
        }
        var SECTION_CAP = 24; // payload-budget: ~3,5 KB värsta fall, långt under beacon-taket
        var secCensus = secFiltered.slice(0, SECTION_CAP);
        sectionEntries = [];
        sectionFlushes = [];
        var wireSectionObserve = function (h2el) {
          var htext = (h2el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
          if (!htext) return;
          var entry = { h: htext, n: secCounts[htext.toLowerCase()] || 1, d: 0 };
          sectionEntries.push(entry);
          var visSince = 0;
          var isIn = false;
          var io = new IntersectionObserver(
            function (entries) {
              for (var k = 0; k < entries.length; k++) {
                isIn = entries[k].isIntersecting;
                if (isIn) {
                  if (!visSince && document.visibilityState === "visible") visSince = Date.now();
                } else if (visSince) {
                  entry.d += Date.now() - visSince;
                  visSince = 0;
                }
              }
            },
            { threshold: 0.5 },
          );
          io.observe(h2el);
          sectionIos.push(io);
          // Flikväxlingar: IO reagerar inte på visibilitychange, så bakgrunds-
          // tid hade annars räknats som tittande. Flusha vid hidden, åter-arma
          // vid visible om rubriken alltjämt är i viewporten.
          sectionFlushes.push(function (becameVisible) {
            if (becameVisible) {
              if (isIn && !visSince) visSince = Date.now();
            } else if (visSince) {
              entry.d += Date.now() - visSince;
              visSince = 0;
            }
          });
        };
        for (var sw = 0; sw < secCensus.length; sw++) wireSectionObserve(secCensus[sw]);
        if (sectionEntries.length) sectionsPath = safePath();
        return sectionEntries.length;
        };
        // Sen-hydrerings-slingan (granskningsfynd 2026-08-08): censusen körs
        // vid wireJourney — på SPA-/hydreringstunga sidor finns h2:orna inte
        // ännu och observatören blev tyst för hela laddningen. Appliern löser
        // SAMMA race med sin 400 ms-omkörning (glutenforum-fyndet) — samma
        // budget här: prova om var 400:e ms tills censusen bär, max 30 försök.
        // Flushad (sectionEntries=null) eller lyckad wiring stoppar slingan.
        if (wireSectionCensus() === 0) {
          var secRetries = 0;
          var secTimer = setInterval(function () {
            secRetries++;
            try {
              if (
                sectionEntries === null ||
                sectionEntries.length > 0 ||
                secRetries >= 30 ||
                wireSectionCensus() > 0
              ) {
                clearInterval(secTimer);
              }
            } catch (e) {
              clearInterval(secTimer);
            }
          }, 400);
        }
      } catch (e) {
        sectionEntries = null;
        sectionFlushes = null;
      }
    }
    // EN section_engagement per SIDA (inte per laddning-slut): flushas vid
    // FÖRSTA av hidden (flikbyte/bakgrundning — det tillfälle som faktiskt
    // inträffar på mobil), pagehide, eller SPA-ruttbyte — alltid stämplad med
    // hemvist-rutten. Efter flushen slutar observationen (senare tid och senare
    // SPA-rutters sektioner mäts inte denna laddning — ärlig under-insamling
    // hellre än fel attribution, och aldrig två payloads för en laddning:
    // aggregeringen räknar en payload = en laddning).
    function emitSectionsOnce() {
      if (!sectionEntries || !sectionEntries.length) return;
      for (var sf2 = 0; sf2 < sectionFlushes.length; sf2++) sectionFlushes[sf2](false);
      var secsOut = [];
      for (var so = 0; so < sectionEntries.length; so++) {
        secsOut.push({
          h: sectionEntries[so].h,
          n: sectionEntries[so].n,
          d: Math.min(600000, Math.round(sectionEntries[so].d)),
        });
      }
      sectionEntries = null;
      for (var di = 0; di < sectionIos.length; di++) {
        try {
          sectionIos[di].disconnect();
        } catch (e) {
          /* aldrig bryta sidan */
        }
      }
      // ARM-MARKÖREN (2026-08-08): bar laddningen en TILLÄMPAD variant? Utan
      // den kan läsvägen bara stängsla på decisionId, som är en KONTEXT-hash
      // delad av båda armarna och av alla laddningar i samma kontext — då
      // faller kontrollarmens rena mätningar med, och en SPA-rutt vars census
      // bär en annan path än exponeringsraden stängslas inte alls. Samma
      // sanning som skörde-spärren använder (adaptedThisLoad): pessimistisk —
      // en beslutad variant räknas som visad även om appliceringen kom sent.
      track(
        "section_engagement",
        { sections: secsOut, path: sectionsPath, adapted: adaptedThisLoad ? 1 : 0 },
        decisionId,
      );
    }

    // Aktiv tid + exit: räkna bara SYNLIG tid (visibilitychange), skicka vid
    // pagehide tillsammans med ev. form-abandon. sendBeacon överlever unload.
    var engagedMs = 0;
    var lastVisible = document.visibilityState === "visible" ? Date.now() : 0;
    function accrue() {
      if (lastVisible) {
        engagedMs += Date.now() - lastVisible;
        lastVisible = 0;
      }
    }
    document.addEventListener("visibilitychange", function () {
      // Endast tidsackumulering — INTE exit: en flikväxling (hidden→visible)
      // får aldrig felaktigt trigga form_abandon/page_leave.
      var vis = document.visibilityState === "visible";
      if (vis) lastVisible = Date.now();
      else accrue();
      if (sectionFlushes) {
        for (var sf = 0; sf < sectionFlushes.length; sf++) sectionFlushes[sf](vis);
      }
      // SEKTIONS-CENSUSEN FLUSHAS REDAN VID HIDDEN (mätt 2026-08-09):
      // bara 27,2 % av sidvisningarna på pilotsajten producerade ett
      // pagehide-flush — mobil som bakgrundas, bfcache och dödade flikar äter
      // resten. Tre av fyra laddningar föll alltså bort ur beteendemätningen,
      // och de som blev kvar är inte nödvändigtvis representativa (längre
      // sessioner, desktop) — en skevhet som inget nedströms kunde upptäcka.
      // hidden är det tillfälle som FAKTISKT inträffar på mobil.
      //
      // Priset, uttalat: emitSectionsOnce är en gång per laddning (aggregeringen
      // räknar en payload = en laddning), så tid EFTER första bakgrundningen
      // mäts inte. Sätet använder bara sektionernas INBÖRDES andelar, mätta
      // över samma fönster för alla sektioner, så rangordningen överlever —
      // vi byter alltså bort svansen av dwell mot att inte tappa 73 % av
      // laddningarna. page_leave/form_abandon rörs INTE här: en flikväxling
      // får aldrig se ut som en exit.
      if (!vis) emitSectionsOnce();
    });
    var left = false;
    function leave() {
      if (left) return;
      left = true;
      accrue();
      flushVideos();
      // Sektions-synligheten: flush med hemvist-rutten (delad med SPA-vägen).
      emitSectionsOnce();
      for (var ref in started) {
        if (!submitted[ref]) {
          track("form_abandon", { ref: ref, kind: started[ref], path: safePath() }, decisionId);
        }
      }
      track("page_leave", { engagedMs: engagedMs, path: safePath(), exit: true }, decisionId);
    }
    // pagehide är det tillförlitliga "lämnar sidan"-tillfället (navigering +
    // stängning, desktop + de flesta mobiler). Diagnos — inte mätkritiskt — så
    // vi accepterar det lilla bortfallet på mobil-Safari framför falska abandons.
    window.addEventListener("pagehide", leave);

    // SPA-resor (ägarfynd 2026-07-19): klientruttbyten laddar aldrig om sidan,
    // så utan detta blir varje SPA-besök EN pageview och resan går inte att
    // följa i personläget ("Step 1 of 1" med död Next-knapp — 21 av 197
    // pilotsessioner hade klick på flera sidor men bara 3 hade flera
    // pageviews). Hooka history-API:t + popstate och skicka en minimal
    // pageview vid PATH-byte. Kontexten (källa/enhet/land) läses ur besökets
    // FÖRSTA pageview av rollupen, så SPA-pageviewen behöver bara pathen.
    var lastJourneyPath = safePath();
    var routePageviews = 0;
    var ROUTE_PV_CAP = 60; // bounded — en människa navigerar inte förbi detta
    function onRouteChange() {
      try {
        var p = safePath();
        if (p === lastJourneyPath || routePageviews >= ROUTE_PV_CAP) return;
        lastJourneyPath = p;
        routePageviews++;
        // Videotid flushas per rutt — posternas path sattes när videon hittades,
        // så en sen flush attribuerar ändå till rätt sida. Sektionerna flushas
        // här av SAMMA skäl (granskningsfynd 2026-08-08: pagehide-stämpeln bar
        // annars nya rutten på gamla sidans sektioner).
        flushVideos();
        emitSectionsOnce();
        track("pageview", { path: p, spa: true }, decisionId);
      } catch (err) {
        /* aldrig bryta sidan */
      }
    }
    try {
      var origPush = window.history && window.history.pushState;
      var origReplace = window.history && window.history.replaceState;
      if (origPush) {
        window.history.pushState = function () {
          var r = origPush.apply(this, arguments);
          onRouteChange();
          return r;
        };
      }
      if (origReplace) {
        window.history.replaceState = function () {
          var r = origReplace.apply(this, arguments);
          onRouteChange();
          return r;
        };
      }
      window.addEventListener("popstate", onRouteChange);
      // MEDVETET ingen hashchange-lyssnare: safeUrl strippar alltid hashen
      // (integritetsvalet — hashen lämnar aldrig klienten), så ett rent
      // hashbyte kan per definition aldrig ge en ny path. Hash-routade
      // SPA:er (#/rutt) är en känd lucka — hellre ärligt osynlig än en
      // lyssnare som ser ut att täcka den men aldrig kan fyra.
    } catch (err) {
      /* history-API saknas/låst — fullsideladdningar täcker ändå */
    }
  }

  // ---- persist this visit --------------------------------------------------
  // Idempotent per page load: an attestation/CMP upgrade and the post-decision
  // tail can both reach here, but a visit must only be counted once. Anonymous
  // calls are a no-op that does NOT consume the guard, so a later consent
  // upgrade in the same load still records the (now lawful) visit exactly once.
  var visitRecorded = false;
  function recordVisit() {
    if (visitRecorded || !consented) return;
    visitRecorded = true;
    var s = readStore();
    s.visits = (s.visits || 0) + 1;
    s.lastPath = location.pathname;
    if (signals.viewedPricing || /pric/i.test(location.pathname)) s.viewedPricing = true;
    writeStore(s);
  }

  // ---- debug overlay -------------------------------------------------------
  // Enabled with data-angel-debug="1" on the script tag, or ?angel_debug=1.
  // Draws a panel showing the detected visitor context + the decision, and
  // whether each adaptation found a target on the page. Great for testing the
  // engine live on a real site before any content inventory exists.
  function isDebug() {
    return script.getAttribute("data-angel-debug") === "1" || qp.get("angel_debug") === "1";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch];
    });
  }
  function renderDebug(decision, applied) {
    var c = decision.context || {};
    var ctx = [
      ["source", c.trafficSource],
      ["device", c.device],
      ["country", c.country],
      ["browser", c.browser],
      ["returning", String(c.isReturning)],
    ]
      .map(function (p) {
        return (
          '<span style="display:inline-block;margin:0 8px 4px 0"><b>' +
          p[0] +
          ":</b> " +
          esc(p[1]) +
          "</span>"
        );
      })
      .join("");
    var rows = (decision.adaptations || [])
      .map(function (a) {
        var found = resolveNodes(a).length;
        var ok = applied.indexOf(a.pattern) !== -1 && found > 0;
        return (
          '<li style="margin:6px 0"><span style="color:' +
          (ok ? "#34d399" : "#9ca3af") +
          '">' +
          (ok ? "✓" : "○") +
          "</span> <b>" +
          esc(a.pattern) +
          "</b> " +
          '<span style="opacity:.65">' +
          esc(a.op) +
          (found ? "" : " · no target on page") +
          "</span>" +
          (a.value
            ? '<br><span style="opacity:.65;font-size:11px">→ "' + esc(a.value) + '"</span>'
            : "") +
          '<br><span style="opacity:.6;font-size:11px">' +
          esc(a.reason) +
          "</span></li>"
        );
      })
      .join("");
    // Omritning (sena appliceringen ritar om panelen med färskt state): EN
    // panel åt gången — utan städningen staplades två, och getElementById
    // nedan hade bundit stängningskrysset till fel panel.
    var prevPanel = document.getElementById("angel-debug");
    if (prevPanel && prevPanel.parentElement) prevPanel.parentElement.removeChild(prevPanel);
    // Variantens rad (granskningsfynd 2026-08-09): panelen byggde bara på
    // decision.adaptations — på variantladdningar stod "No adaptations" hur
    // adapterad sidan än var. applied-listan är sanningen om DENNA rendering.
    var variantApplied = false;
    for (var va = 0; va < (applied || []).length; va++) {
      if (String(applied[va]).indexOf("variant:") === 0) variantApplied = true;
    }
    var variantRow = decision.variant
      ? '<li style="margin-bottom:6px"><b>variant ' +
        esc(decision.variant.id) +
        "</b><br>" +
        '<span style="opacity:.65">' +
        (decision.variant.ops || []).length +
        " op(s) · " +
        (variantApplied ? "applied" : "not applied (yet)") +
        "</span></li>"
      : "";
    var el = document.createElement("div");
    el.id = "angel-debug";
    el.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:2147483647;width:360px;max-width:92vw;max-height:70vh;overflow:auto;background:#0b1020;color:#e5e7eb;font:13px/1.45 -apple-system,system-ui,sans-serif;border:1px solid #334155;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.45);padding:14px";
    el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><b style="color:#a78bfa">✦ Angel Adaptive — debug</b><span id="angel-debug-x" style="cursor:pointer;opacity:.6;padding:0 4px">✕</span></div>' +
      '<div style="font-size:12px;margin-bottom:8px">' +
      ctx +
      "</div>" +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.5;margin-bottom:2px">decision ' +
      esc(decision.decisionId) +
      " · " +
      (decision.adaptations || []).length +
      " adaptation(s)</div>" +
      '<ul style="list-style:none;margin:0;padding:0">' +
      (variantRow + rows || '<li style="opacity:.6">No adaptations for this visitor.</li>') +
      "</ul>" +
      '<div style="margin-top:8px;font-size:11px;opacity:.5">site: ' +
      esc(decision.site) +
      "</div>";
    document.body.appendChild(el);
    var x = el.querySelector("#angel-debug-x");
    if (x)
      x.onclick = function () {
        if (el.parentElement) el.parentElement.removeChild(el);
      };
  }

  // ---- run -----------------------------------------------------------------
  // The public API exists from init — NOT only after a successful decide. The
  // header documents window.AngelAdaptive.convert() for customer code; if it
  // only appeared in decide's .then, a 5xx (or an in-flight decide) would make
  // the customer's own success-handler throw TypeError. Fail open: decision/
  // applied fill in later when (if) the decision lands.
  window.AngelAdaptive = {
    version: VERSION,
    site: site,
    decision: null,
    applied: [],
    reset: function () {
      while (undoStack.length) {
        try {
          undoStack.pop()();
        } catch (e) {
          /* keep unwinding */
        }
      }
    },
    track: track,
    convert: convert,
  };

  function decideAndApply() {
    // Bounded: skörde-spärren väntar max ~12 s på decideSettled och kommentaren
    // där förutsätter en decide-timeout — utan den kunde ett hängt svar lämna
    // ett valt skördefönster oanvänt. 10 s täcker sega mobilnät med marginal.
    var ctrl = null;
    try {
      ctrl = new AbortController();
      setTimeout(function () {
        ctrl.abort();
      }, 10000);
    } catch (e) {
      ctrl = null;
    }
    fetch(DECIDE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signals),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error("decide " + r.status));
      })
      .then(function (decision) {
        lastDecisionId = decision.decisionId;
        // Control bucket: withhold the adaptations so their lift can be measured.
        var applied = decision.holdout ? [] : apply(decision);
        // Skörde-spärren (se loadHarvest): en adapterad laddning får ALDRIG
        // skördas — annars mäter skördaren vår egen förändring och skriver
        // över sidans inventory med post-adaptations-DOM:en (feedback-loopen
        // som raderade FAQ-posten på glutenforum). Kontrollgruppen (holdout)
        // och laddningar utan adaptationer är de rena skördekällorna.
        // En variant-arms-laddning räknas som adapterad ÄVEN om första apply
        // missade: SPA-omförsöket nedan kan applicera sent, mitt under en
        // pågående skörd — pessimism här är billig, kontrollarmen räcker.
        adaptedThisLoad = applied.length > 0 || !!(decision.variant && !decision.holdout);
        decideSettled = true;
        // Survive framework hydration: a React/Vue re-render can replace the
        // DOM we just adapted, silently wiping our (already-logged) exposure.
        // If every visible trace of the applied ops disappears shortly after
        // apply, re-apply once or twice — all ops are idempotent (classList
        // adds, same-value set_text, DOM-checked badge dedup), so a re-apply
        // on a surviving page is a no-op.
        // Delad per-laddning-spärr för variant_apply_skipped: vägarna (snabb
        // wipe / sen wipe / sen utebliven) är ömsesidigt uteslutande redan,
        // flaggan gör högst-en-gång STRUKTURELLT i stället för emergent.
        var skipTracked = false;
        if (applied.length > 0) {
          var reapplies = 0;
          var checkSurvival = function (finalAttempt) {
            try {
              var residue = document.querySelectorAll(
                ".angel-revealed,.angel-emphasized,.angel-condensed,[data-angel-injected],[data-angel-moved],[data-angel-retext],[data-angel-inserted]",
              ).length;
              if (residue === 0 && reapplies < 2) {
                reapplies++;
                var re = apply(decision);
                // ÄRLIG UTSPÄDNING även på wipe-vägen (granskningsfynd
                // 2026-08-09): fast-vägens applicering + framework-wipe +
                // blockerad återapplicering armar ALDRIG sena loopen — utan
                // spåret här stod laddningen som visad variant med baslinjen
                // på skärmen, osynligt för mätningen. Bara SISTA försöket
                // loggar (första kan ännu räddas av det andra).
                if (
                  finalAttempt &&
                  re.length === 0 &&
                  decision.variant &&
                  !decision.holdout &&
                  !skipTracked
                ) {
                  skipTracked = true;
                  // Publika statet får inte fortsätta hävda en applicerad
                  // variant på en sida där baslinjen står på skärmen.
                  window.AngelAdaptive.applied = [];
                  document.dispatchEvent(
                    new CustomEvent("angel:applied", { detail: window.AngelAdaptive }),
                  );
                  if (isDebug()) renderDebug(decision, []);
                  track(
                    "variant_apply_skipped",
                    {
                      variantId: String(decision.variant.id || ""),
                      reason:
                        lastApplyBlocked === "viewport" ? "viewport-guard" : "wiped-not-restored",
                      path: safePath(),
                    },
                    decision.decisionId,
                  );
                }
              }
            } catch (e) {
              /* never break the host page */
            }
          };
          setTimeout(function () {
            checkSurvival(false);
          }, 1500);
          setTimeout(function () {
            checkSurvival(true);
          }, 4000);
        }
        // SPA-monteringsracet (pilotfynd 2026-07-27, glutenforum): på en
        // klientrenderad sida kan decide-svaret landa FÖRE innehållet — då
        // hittar första apply inga mål, fast exponeringen redan loggats som
        // visad. Utan omförsök ser besökaren originalet och variant-armen
        // späds ut till kontrollarmens nivå. Försök tills målen monterats:
        // 400 ms × 30 ≈ 12 s (samma fönster som skörde-spärren). apply är
        // idempotent, och en sen lyckad applicering armar sin egen
        // hydrerings-vakt precis som den snabba vägen ovan.
        if (decision.variant && !decision.holdout && applied.length === 0) {
          var lateTries = 0;
          // Flimmervaktens spår över HELA fönstret: blockerade vakten någon
          // gång är det skälet till utebliven applicering — inte "målen fanns
          // aldrig". lastApplyBlocked nollas per apply()-anrop, så utan
          // ackumulatorn hade ett sista omförsök mot en bortdriven rubrik
          // maskerat trettio vakt-nej som targets-missing.
          var everViewportBlocked = lastApplyBlocked === "viewport";
          var lateTimer = setInterval(function () {
            try {
              lateTries++;
              var late = apply(decision);
              if (lastApplyBlocked === "viewport") everViewportBlocked = true;
              if (late.length > 0 || lateTries >= 30) {
                clearInterval(lateTimer);
                if (late.length > 0) {
                  // Sena appliceringen ÄR laddningens applicering — spegla den
                  // i publika state + eventet (granskningsfynd 2026-08-09:
                  // debug-panelen sa "No adaptations" på en sida som
                  // bevisligen var adapterad, och angel:applied-lyssnare
                  // missade den sena vägen helt).
                  window.AngelAdaptive.applied = late;
                  document.dispatchEvent(
                    new CustomEvent("angel:applied", { detail: window.AngelAdaptive }),
                  );
                  if (isDebug()) renderDebug(decision, late);
                  var lateReapplies = 0;
                  var lateSurvival = function (finalAttempt) {
                    try {
                      var res2 = document.querySelectorAll(
                        "[data-angel-moved],[data-angel-retext],[data-angel-inserted]",
                      ).length;
                      if (res2 === 0 && lateReapplies < 2) {
                        lateReapplies++;
                        var re2 = apply(decision);
                        // Samma wipe-ärlighet som checkSurvival ovan.
                        if (finalAttempt && re2.length === 0 && !skipTracked) {
                          skipTracked = true;
                          window.AngelAdaptive.applied = [];
                          document.dispatchEvent(
                            new CustomEvent("angel:applied", { detail: window.AngelAdaptive }),
                          );
                          if (isDebug()) renderDebug(decision, []);
                          track(
                            "variant_apply_skipped",
                            {
                              variantId: String(decision.variant.id || ""),
                              reason:
                                lastApplyBlocked === "viewport"
                                  ? "viewport-guard"
                                  : "wiped-not-restored",
                              path: safePath(),
                            },
                            decision.decisionId,
                          );
                        }
                      }
                    } catch (e) {
                      /* never break the host page */
                    }
                  };
                  setTimeout(function () {
                    lateSurvival(false);
                  }, 1500);
                  setTimeout(function () {
                    lateSurvival(true);
                  }, 4000);
                } else {
                  // ÄRLIG UTEBLIVEN APPLICERING: servern loggade exponeringen
                  // som visad vid decide — utan spåret här är utspädningen av
                  // variantarmen OSYNLIG. reason skiljer vaktens nej (besökaren
                  // stod i regionen hela fönstret — designen fungerar, tajmingen
                  // förbjöd den) från targets-missing (hydrering/drift — målen
                  // fanns aldrig). Bäst-effort: lämnar besökaren sidan före
                  // fönstrets slut hinner spåret inte skickas.
                  if (!skipTracked) {
                    skipTracked = true;
                    track(
                      "variant_apply_skipped",
                      {
                        variantId: String(decision.variant.id || ""),
                        reason: everViewportBlocked ? "viewport-guard" : "targets-missing",
                        path: safePath(),
                      },
                      decision.decisionId,
                    );
                  }
                }
              }
            } catch (e) {
              clearInterval(lateTimer);
            }
          }, 400);
        }
        var ctx = decision.context || {};
        track(
          "pageview",
          {
            // path (minimerad) gör sidORDNINGEN direkt rekonstruerbar per
            // session i nivå 2 — annars måste den härledas ur andra events.
            path: safePath(),
            trafficSource: ctx.trafficSource,
            device: ctx.device,
            isReturning: ctx.isReturning,
            country: ctx.country,
            browser: ctx.browser,
            language: ctx.language,
            campaign: ctx.campaign,
          },
          decision.decisionId,
        );
        // NOTE: we deliberately do NOT emit an "adaptation_shown" event here.
        // The server logs the exposure authoritatively for BOTH arms in
        // logDecision (adaptation_shown when adapted, adaptation_withheld when
        // held out), so a client emit would double-count exposures and, because
        // it carries the applied subset rather than the decided set, disagree
        // with the control arm's source. One source keeps the arms symmetric.
        wireEngagement(decision.decisionId);
        wirePerf(decision.decisionId);
        wireJourney(decision.decisionId);
        wireConversion();
        if (isDebug()) renderDebug(decision, applied);

        window.AngelAdaptive.decision = decision;
        window.AngelAdaptive.applied = applied;
        document.dispatchEvent(new CustomEvent("angel:applied", { detail: window.AngelAdaptive }));
      })
      .catch(function (err) {
        // Fail open: the customer's page is unchanged if Angel can't decide.
        // Sidan är då orörd → skörd är säker (adaptedThisLoad förblir false).
        decideSettled = true;
        // Tag-konfigurerade mål (data-conversion-*) ska spåras även när både
        // config-hämtningen och decide fallerat — annars tappas konverteringar
        // (inkl. URL-mål på tacksidan) tyst på exakt de laddningar där mätning
        // vore enda livstecknet. Idempotent — no-op om redan kopplad.
        wireConversion();
        // Observation är oberoende av beslutet: samla sidans prestanda + resa
        // även när vi inte ändrar något (decisionId=null). Det är hela poängen
        // med observe-only — data också på oadapterade laddningar.
        wirePerf(null);
        wireJourney(null);
        if (window.console && console.warn) console.warn("[angel] decide failed:", err);
      });

    // Watch for a later consent grant (CMP loads async) to upgrade live.
    watchConsent();
    recordVisit();
  }

  // Resolve the SITE OWNER's dashboard config before the first decision:
  //   mode       — 'attested' = owner (data controller) confirmed a lawful
  //                basis, so run consented at baseline (id + measurement).
  //   holdoutPct — measurement control %, unless the tag set data-holdout.
  //   conversion — conversion goal, unless the tag set data-conversion-*.
  // GPC/DNT and data-consent="denied" make measurement impossible/forbidden,
  // so they skip the round-trip entirely. Tag attributes always win over
  // dashboard values (explicit per-install overrides). För hold-outen bär
  // signals.holdoutOverride den distinktionen till servern: ett EXPLICIT
  // data-holdout (inkl. "0" = avstängning) respekteras, men utan attributet
  // är dashboard-värdet auktoritativt server-side — annars kunde en config-
  // timeout här bucketa om besökare mitt i mätningen.
  function applySiteConfig(cfg) {
    if (!cfg) return;
    if (HOLDOUT_ATTR === null && typeof cfg.holdoutPct === "number") {
      HOLDOUT_PCT = Math.max(0, Math.min(100, cfg.holdoutPct));
    }
    if (cfg.conversion) {
      if (!CONVERSION_URL && cfg.conversion.url) CONVERSION_URL = String(cfg.conversion.url);
      if (!CONVERSION_SELECTOR && cfg.conversion.selector) {
        CONVERSION_SELECTOR = String(cfg.conversion.selector);
      }
      if (!CONVERSION_TEXT && cfg.conversion.text) {
        CONVERSION_TEXT = String(cfg.conversion.text);
      }
    }
    // Sektionsobservationen ur sajtkonfigen — bara när taggen INTE uttalat sig
    // (ett explicit data-observe-sections="0" måste kunna stänga av lokalt).
    // Konfigen hämtas FÖRE beslutet och censusen kopplas efter det, så flaggan
    // hinner fram; på en laddning där konfig-hämtningen tajmar ut (1,5 s) blir
    // laddningen omätt — ärlig under-insamling, aldrig fel data.
    if (!OBSERVE_SECTIONS_SET_BY_TAG && typeof cfg.observeSections === "boolean") {
      OBSERVE_SECTIONS = cfg.observeSections;
    }
    if (cfg.mode === "attested") upgradeConsent("site_attested");
    // Already consented before this config arrived (CMP sync grant / override):
    // upgradeConsent above was a no-op, so refresh the holdout signal here.
    if (consented) signals.holdoutPct = HOLDOUT_PCT;
    // If the decision round-trip already wired conversions this is a no-op;
    // otherwise a late-arriving goal still gets wired exactly once.
    wireConversion();
  }
  function resolveSiteConfigThen(next) {
    if (gpcOrDnt() || CONSENT_OVERRIDE === "denied") return next();
    var done = false;
    function proceed() {
      if (done) return;
      done = true;
      next();
    }
    try {
      fetch(CONFIG_URL + "?site=" + encodeURIComponent(site))
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(applySiteConfig)
        .catch(function () {})
        .then(proceed);
    } catch (e) {
      proceed();
    }
    // Never let a slow/hung config response delay adaptation: decide with the
    // tag/default values after a short wait; late config still upgrades
    // consent + wires conversions from that point on.
    setTimeout(proceed, 1500);
  }

  // ---- content harvest (one tag, lazy + sampled) --------------------------
  // Fold the inventory harvester into this single install tag. After load, in
  // idle time, inject adaptive-harvest.js — but only for an ELECTED session, so
  // the heavy (~90 KB) harvester is fetched at most once per page/day and never
  // competes with adaptation or the TBT window. Non-elected visitors never even
  // download it. We elect here (not inside the harvester) precisely so we can
  // skip the download; the harvester is then told data-force="1" to run without
  // re-electing (which also means it writes no localStorage of its own).
  var HARVEST_URL = base + "/adaptive-harvest.js";
  // Election utan sidoeffekt: returnerar dedupe-nyckeln ("" på samplingsvägen,
  // null = inte vald). Nyckeln skrivs först när harvester-skriptet faktiskt
  // LADDATS (onload) — annars konsumerar en adblockad/failad hämtning dagens
  // enda skördeförsök för sökvägen.
  function harvestElectionKey() {
    // Consented: dedupe persistently, once per (site,path,UTC-day) — inventory
    // changes slowly. Anonymous: no device storage, so sample ~1/10 loads to
    // still gather inventory cheaply without writing anything.
    try {
      if (consented) {
        var day = new Date().toISOString().slice(0, 10);
        var key = "angel_harvest:" + site + ":" + location.pathname + ":" + day;
        if (localStorage.getItem(key)) return null;
        return key;
      }
    } catch (e) {
      /* storage blocked — fall through to sampling */
    }
    return Math.random() < 0.1 ? "" : null;
  }
  var harvestWaits = 0;
  function loadHarvest() {
    try {
      // GPC/DNT is a hard opt-out for us everywhere — don't even harvest.
      if (gpcOrDnt()) return;
      // ALDRIG skörda en adapterad sida — annars mäter skördaren vår egen
      // förändring och skriver över sidans inventory med post-adaptations-
      // DOM:en (feedback-loop: FAQ:n flyttas upp → nästa skörd känner inte
      // igen den som FAQ → posten försvinner → flytten slutar nomineras).
      // Vänta tills beslutet är avgjort (bounded — decide har egen timeout);
      // kontrollgrupps- och oadapterade laddningar förblir skördekällorna.
      if (!decideSettled) {
        if (harvestWaits++ < 15) setTimeout(loadHarvest, 800);
        return;
      }
      if (adaptedThisLoad) return;
      // Bälte (täcker fristående harvest-tag mitt i migrering): synliga
      // Angel-spår i DOM:en betyder adapterad sida oavsett hur vi kom hit.
      if (
        document.querySelector(
          ".angel-revealed,.angel-emphasized,.angel-condensed,[data-angel-injected],[data-angel-moved],[data-angel-retext],[data-angel-inserted]",
        )
      )
        return;
      // Don't double-load if a standalone harvest tag is still on the page
      // (e.g. mid-migration) or one was already injected.
      if (document.querySelector('script[src*="adaptive-harvest"]')) return;
      var electionKey = harvestElectionKey();
      if (electionKey === null) return;
      var s = document.createElement("script");
      s.src = HARVEST_URL;
      s.async = true;
      s.setAttribute("data-site", site);
      if (KEY) s.setAttribute("data-key", KEY); // gate the inventory POST too
      s.setAttribute("data-force", "1"); // already elected here
      if (electionKey) {
        s.onload = function () {
          try {
            localStorage.setItem(electionKey, "1");
          } catch (e) {
            /* storage blocked — nothing to dedupe against anyway */
          }
        };
      }
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      /* never break the host page */
    }
  }
  function scheduleHarvest() {
    var idle =
      window.requestIdleCallback ||
      function (f) {
        return setTimeout(f, 1);
      };
    var go = function () {
      idle(loadHarvest, { timeout: 4000 });
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }

  function run() {
    resolveSiteConfigThen(decideAndApply);
    // Harvest is independent of the decision round-trip: schedule it for idle
    // after load so it never sits on the critical path.
    scheduleHarvest();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
