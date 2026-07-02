/*!
 * Angel Adaptive — site snippet.
 *
 * The single line a customer installs:
 *   <script src="https://app.angel.example/adaptive.js" data-site="acme"></script>
 *
 * It reads the visitor's context, asks the Decision Engine what to show, applies
 * the chosen safe patterns to the live DOM, and reports analytics. Every change
 * is recorded and reversible (window.AngelAdaptive.reset()). The original page
 * is never mutated on the server and nothing is persisted into the DOM.
 *
 * Dependency-free, framework-free. Targets evergreen browsers.
 */
(function () {
  "use strict";

  var VERSION = "0.1.0";
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

  var site = script.getAttribute("data-site") || "demo";
  var base = script.getAttribute("data-endpoint") || new URL(script.src).origin;
  var DECIDE_URL = base + "/api/adaptive/decide";
  var EVENTS_URL = base + "/api/adaptive/events";
  var CONFIG_URL = base + "/api/adaptive/consent-config";

  // ---- measurement config (opt-in) -----------------------------------------
  // data-holdout: % of visitors held out as control (0 = off).
  // data-conversion-url / data-conversion-selector: how conversions fire.
  var HOLDOUT_PCT = parseInt(script.getAttribute("data-holdout") || "0", 10) || 0;
  var CONVERSION_URL = script.getAttribute("data-conversion-url") || "";
  var CONVERSION_SELECTOR = script.getAttribute("data-conversion-selector") || "";

  var qp = new URLSearchParams(location.search);

  // ---- consent gate (anonymous-default) ------------------------------------
  // We never render our own banner. We read the site's EXISTING consent; until
  // we see a positive signal we run in ANONYMOUS mode: still adapt the page
  // (pure, reversible DOM — no storage), but store no persistent id, run no
  // holdout bucketing, and send no behavioural events. A later grant (TCF /
  // Cookiebot) upgrades live. GPC/DNT are hard opt-outs. Config via
  // data-consent="granted"|"denied" overrides detection.
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
    // Refresh the consent-dependent signal fields so any decision computed
    // after this upgrade gets holdout bucketing + attribution. A no-op for the
    // fields the server ignores when anonymous.
    signals.visitorHash = vid || undefined;
    signals.holdoutPct = HOLDOUT_PCT;
    signals.consent = consentBasis;
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

  // ---- demo simulator overrides (?angel_source=, angel_device=, ...) --------
  function deviceWidth(d) {
    return d === "mobile" ? 375 : d === "tablet" ? 800 : 1440;
  }
  var deviceOverride = qp.get("angel_device");

  // ---- client signals ------------------------------------------------------
  var signals = {
    site: site,
    url: location.href,
    referrer: document.referrer || "",
    utmSource: qp.get("utm_source") || qp.get("angel_source") || undefined,
    utmMedium: qp.get("utm_medium") || qp.get("angel_medium") || undefined,
    utmCampaign: qp.get("utm_campaign") || undefined,
    screenWidth: deviceOverride ? deviceWidth(deviceOverride) : window.innerWidth || 0,
    language: (navigator.language || "en").split("-")[0],
    hourOfDay: new Date().getHours(),
    isReturning: qp.get("angel_returning") === "1" || prevVisits > 0,
    visitCount: qp.get("angel_returning") === "1" ? Math.max(1, prevVisits) : prevVisits,
    viewedPricing: qp.get("angel_pricing") === "1" || !!store.viewedPricing,
    lastPath: store.lastPath || null,
    // Omitted (undefined) in anonymous mode so the server withholds holdout
    // bucketing + attribution. holdoutPct is 0 unless consented.
    visitorHash: vid || undefined,
    holdoutPct: consented ? HOLDOUT_PCT : 0,
    consent: consentBasis,
  };

  // ---- analytics -----------------------------------------------------------
  function send(events) {
    // Anonymous mode sends no behavioural data (no visitorHash to attribute it
    // to anyway). A later consent grant enables sending from that point on.
    if (!consented) return;
    var body = JSON.stringify({ site: site, visitorHash: vid, events: events });
    // Send as text/plain (a CORS-safelisted content type) so cross-origin
    // beacons need NO preflight — navigator.sendBeacon cannot perform one, and
    // application/json would force one and silently drop the beacon. The server
    // parses the JSON body regardless of the declared content type.
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(EVENTS_URL, new Blob([body], { type: "text/plain;charset=UTF-8" }));
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
    send([{ type: type, decisionId: decisionId, payload: payload || {}, ts: Date.now() }]);
  }

  // ---- conversions ---------------------------------------------------------
  var lastDecisionId = null;
  // Public trigger: the customer calls window.AngelAdaptive.convert(value?, meta?)
  // (or configures a URL / selector). Carries visitorHash (via send) + the last
  // decisionId so the conversion can be attributed to what was shown.
  function convert(value, meta) {
    var payload = meta && typeof meta === "object" ? meta : {};
    if (value !== undefined) payload.value = value;
    track("conversion", payload, lastDecisionId);
  }
  function wireConversion() {
    try {
      if (CONVERSION_URL && location.href.indexOf(CONVERSION_URL) !== -1) convert();
      if (CONVERSION_SELECTOR) {
        document.addEventListener(
          "click",
          function (e) {
            var t = e.target;
            while (t && t.nodeType === 1) {
              if (t.matches && t.matches(CONVERSION_SELECTOR)) {
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

  function ensureStyles() {
    if (document.getElementById("angel-style")) return;
    var css =
      "[data-angel-hidden]{display:none!important}" +
      ".angel-revealed{display:revert!important}" +
      ".angel-emphasized{outline:2px solid #6d28d9;outline-offset:4px;border-radius:8px;box-shadow:0 0 0 4px rgba(109,40,217,.12);transition:box-shadow .2s}" +
      ".angel-condensed [data-angel-secondary]{display:none!important}" +
      ".angel-badge{display:inline-flex;align-items:center;gap:6px;margin:8px 8px 0 0;padding:4px 10px;font-size:12px;font-weight:600;line-height:1;border-radius:999px;background:#f3f0ff;color:#5b21b6;border:1px solid #ddd6fe}" +
      ".angel-badge::before{content:'\\2713';font-weight:700}";
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
    try { if (a.target) nodes = document.querySelectorAll(a.target); } catch (e) {}
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

  function each(a, fn) {
    var nodes = resolveNodes(a);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  var OPS = {
    reveal: function (a) {
      each(a, function (el) {
        var hadHidden = el.hasAttribute("data-angel-hidden");
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
      each(a, function (el) {
        var parent = el.parentElement;
        if (!parent) return;
        var nextSibling = el.nextSibling;
        parent.insertBefore(el, parent.firstChild);
        record(function () {
          parent.insertBefore(el, nextSibling);
        });
      });
    },
    emphasize: function (a) {
      each(a, function (el) {
        el.classList.add("angel-emphasized");
        record(function () {
          el.classList.remove("angel-emphasized");
        });
      });
    },
    condense: function (a) {
      each(a, function (el) {
        el.classList.add("angel-condensed");
        record(function () {
          el.classList.remove("angel-condensed");
        });
      });
    },
    set_text: function (a) {
      if (!a.value) return;
      each(a, function (el) {
        // Prefer an inner text host so we don't clobber icons/children.
        var host = el.querySelector("[data-angel-text]") || el;
        var prev = host.textContent;
        host.textContent = a.value;
        record(function () {
          host.textContent = prev;
        });
      });
    },
    inject_badge: function (a) {
      if (!a.value) return;
      each(a, function (el) {
        var badge = document.createElement("span");
        badge.className = "angel-badge";
        badge.setAttribute("data-angel-injected", "");
        badge.textContent = a.value;
        var anchor = el.parentElement || el;
        anchor.appendChild(badge);
        record(function () {
          if (badge.parentElement) badge.parentElement.removeChild(badge);
        });
      });
    },
  };

  function apply(decision) {
    ensureStyles();
    var applied = [];
    (decision.adaptations || []).forEach(function (a) {
      var op = OPS[a.op];
      if (!op) return;
      try {
        op(a);
        applied.push(a.pattern);
      } catch (e) {
        /* one bad selector must not break the rest */
      }
    });
    return applied;
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
            ".angel-revealed,.angel-emphasized,.angel-condensed,[data-angel-injected]",
          ).length;
        } catch (e) {
          return -1;
        }
      },
    };
  }

  // ---- engagement tracking -------------------------------------------------
  function wireEngagement(decisionId) {
    // CTA clicks.
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target;
        var cta = t && t.closest && t.closest('[data-angel-slot="cta"], [data-angel-cta]');
        if (cta)
          track("cta_click", { text: (cta.textContent || "").trim().slice(0, 80) }, decisionId);
      },
      true,
    );

    // Scroll depth — fire each 25% bucket once.
    var buckets = { 25: false, 50: false, 75: false, 100: false };
    window.addEventListener(
      "scroll",
      function () {
        var doc = document.documentElement;
        var max = doc.scrollHeight - doc.clientHeight;
        if (max <= 0) return;
        var pct = Math.round((doc.scrollTop / max) * 100);
        [25, 50, 75, 100].forEach(function (b) {
          if (pct >= b && !buckets[b]) {
            buckets[b] = true;
            track("scroll_depth", { depth: b }, decisionId);
          }
        });
      },
      { passive: true },
    );
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
      (rows || '<li style="opacity:.6">No adaptations for this visitor.</li>') +
      "</ul>" +
      '<div style="margin-top:8px;font-size:11px;opacity:.5">site: ' +
      esc(decision.site) +
      "</div>";
    document.body.appendChild(el);
    var x = document.getElementById("angel-debug-x");
    if (x)
      x.onclick = function () {
        if (el.parentElement) el.parentElement.removeChild(el);
      };
  }

  // ---- run -----------------------------------------------------------------
  function decideAndApply() {
    fetch(DECIDE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signals),
    })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error("decide " + r.status));
      })
      .then(function (decision) {
        lastDecisionId = decision.decisionId;
        // Control bucket: withhold the adaptations so their lift can be measured.
        var applied = decision.holdout ? [] : apply(decision);
        var ctx = decision.context || {};
        track(
          "pageview",
          {
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
        if (applied.length) {
          track("adaptation_shown", { patterns: applied }, decision.decisionId);
        }
        wireEngagement(decision.decisionId);
        wireConversion();
        if (isDebug()) renderDebug(decision, applied);

        window.AngelAdaptive = {
          version: VERSION,
          site: site,
          decision: decision,
          applied: applied,
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
        document.dispatchEvent(new CustomEvent("angel:applied", { detail: window.AngelAdaptive }));
      })
      .catch(function (err) {
        // Fail open: the customer's page is unchanged if Angel can't decide.
        if (window.console && console.warn) console.warn("[angel] decide failed:", err);
      });

    // Watch for a later consent grant (CMP loads async) to upgrade live.
    watchConsent();
    recordVisit();
  }

  // Resolve the SITE OWNER's consent configuration before the first decision.
  // The owner (data controller) can attest a lawful basis in the dashboard;
  // an attested site runs consented at baseline (persistent id + measurement).
  // GPC/DNT and an explicit data-consent override always take precedence and
  // skip the round-trip. Anonymous sites decide without waiting.
  function resolveOwnerConsentThen(next) {
    if (consented || CONSENT_OVERRIDE || gpcOrDnt()) return next();
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
        .then(function (cfg) {
          if (cfg && cfg.mode === "attested") upgradeConsent("site_attested");
        })
        .catch(function () {})
        .then(proceed);
    } catch (e) {
      proceed();
    }
    // Never let a slow/hung config response delay adaptation: decide anonymously
    // after a short wait; a late attestation still upgrades events from then on.
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
  function harvestElected() {
    // Consented: dedupe persistently, once per (site,path,UTC-day) — inventory
    // changes slowly. Anonymous: no device storage, so sample ~1/10 loads to
    // still gather inventory cheaply without writing anything.
    try {
      if (consented) {
        var day = new Date().toISOString().slice(0, 10);
        var key = "angel_harvest:" + site + ":" + location.pathname + ":" + day;
        if (localStorage.getItem(key)) return false;
        localStorage.setItem(key, "1");
        return true;
      }
    } catch (e) {
      /* storage blocked — fall through to sampling */
    }
    return Math.random() < 0.1;
  }
  function loadHarvest() {
    try {
      // GPC/DNT is a hard opt-out for us everywhere — don't even harvest.
      if (gpcOrDnt()) return;
      // Don't double-load if a standalone harvest tag is still on the page
      // (e.g. mid-migration) or one was already injected.
      if (document.querySelector('script[src*="adaptive-harvest"]')) return;
      if (!harvestElected()) return;
      var s = document.createElement("script");
      s.src = HARVEST_URL;
      s.async = true;
      s.setAttribute("data-site", site);
      s.setAttribute("data-force", "1"); // already elected here
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
    resolveOwnerConsentThen(decideAndApply);
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
