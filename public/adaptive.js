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

  var qp = new URLSearchParams(location.search);

  // ---- visitor identity + history (localStorage) ---------------------------
  var STORE_KEY = "angel:" + site;
  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function writeStore(s) {
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
  var vid = visitorId();

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
  };

  // ---- analytics -----------------------------------------------------------
  function send(events) {
    var body = JSON.stringify({ site: site, visitorHash: vid, events: events });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(EVENTS_URL, new Blob([body], { type: "application/json" }));
        return;
      }
    } catch (e) {
      /* fall through to fetch */
    }
    fetch(EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
    }).catch(function () {});
  }
  function track(type, payload, decisionId) {
    send([{ type: type, decisionId: decisionId, payload: payload || {}, ts: Date.now() }]);
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

  function each(selector, fn) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  var OPS = {
    reveal: function (a) {
      each(a.target, function (el) {
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
      each(a.target, function (el) {
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
      each(a.target, function (el) {
        el.classList.add("angel-emphasized");
        record(function () {
          el.classList.remove("angel-emphasized");
        });
      });
    },
    condense: function (a) {
      each(a.target, function (el) {
        el.classList.add("angel-condensed");
        record(function () {
          el.classList.remove("angel-condensed");
        });
      });
    },
    set_text: function (a) {
      if (!a.value) return;
      each(a.target, function (el) {
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
      each(a.target, function (el) {
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
  function recordVisit() {
    var s = readStore();
    s.visits = (s.visits || 0) + 1;
    s.lastPath = location.pathname;
    if (signals.viewedPricing || /pric/i.test(location.pathname)) s.viewedPricing = true;
    writeStore(s);
  }

  // ---- run -----------------------------------------------------------------
  function run() {
    fetch(DECIDE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signals),
    })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error("decide " + r.status));
      })
      .then(function (decision) {
        var applied = apply(decision);
        track(
          "pageview",
          {
            trafficSource: decision.context && decision.context.trafficSource,
            device: decision.context && decision.context.device,
            isReturning: decision.context && decision.context.isReturning,
          },
          decision.decisionId,
        );
        if (applied.length) {
          track("adaptation_shown", { patterns: applied }, decision.decisionId);
        }
        wireEngagement(decision.decisionId);

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
        };
        document.dispatchEvent(new CustomEvent("angel:applied", { detail: window.AngelAdaptive }));
      })
      .catch(function (err) {
        // Fail open: the customer's page is unchanged if Angel can't decide.
        if (window.console && console.warn) console.warn("[angel] decide failed:", err);
      });

    recordVisit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
