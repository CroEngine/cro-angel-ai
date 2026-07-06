// Angel Adaptive — private sandbox mirror (server only).
//
// Lets an admin preview what Angel WOULD do on any site, without installing
// anything on it: the target page's HTML is fetched once (like any crawler),
// rewritten to run inside our origin, and served behind a short-lived signed
// token. The dashboard embeds the mirror in an OPAQUE-origin iframe
// (sandbox="allow-scripts", never allow-same-origin) so the mirrored site's
// scripts can't touch the admin's session.
//
// Isolation guarantees:
//  - Token-gated: only createSandboxPreview (admin-only server fn) can mint
//    mirror URLs — the route is not an open proxy.
//  - SSRF-guarded: http(s) hostnames only; IP literals, localhost and
//    internal-suffix hosts are refused (closes the metadata-endpoint door).
//  - Data-isolated: the snippet runs under a `sandbox--<host>` slug in
//    anonymous mode — it adapts (that's the preview) but stores no visitor
//    ids or events, so sandbox sessions can NEVER add noise to measurement.

import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { promisify } from "node:util";

const dnsLookupAll = promisify(dnsLookup);

/** Mirror links die quickly — they exist for one preview session. */
export const SANDBOX_TOKEN_TTL_MS = 30 * 60 * 1000;

/** HMAC secret for mirror tokens. A dedicated var wins; the service-role key
 *  (always present where the mirror is useful) is the fallback. */
export function sandboxSecret(): string | null {
  return process.env.ANGEL_SANDBOX_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function signSandboxToken(url: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${url}|${exp}`).digest("hex");
}

export function verifySandboxToken(
  url: string,
  exp: number,
  token: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = Buffer.from(signSandboxToken(url, exp, secret), "utf8");
  const given = Buffer.from(String(token ?? ""), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Hostnames that can only mean "inside our own network". Matched against a
// trailing-dot-stripped, lowercased host (see normalizeHost) so `localhost.`
// and `db.internal.` — which resolvers treat as the FQDN forms — can't slip
// past the `$` anchor.
const BLOCKED_HOST_RX = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i;
const IPV4_RX = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Trailing dots are the FQDN form (`host.` ≡ `host`); strip them and lowercase
 *  so every downstream check sees one canonical spelling. */
export function normalizeHost(host: string): string {
  return host.replace(/\.+$/, "").toLowerCase();
}

/**
 * Is this resolved IP address inside a range we must never fetch from — the
 * whole SSRF blast radius (loopback, RFC1918 private, CGNAT, link-local incl.
 * 169.254.169.254 cloud metadata, ULA, unspecified, reserved)? Covers IPv4,
 * IPv6, and IPv4-mapped/compat IPv6 (::ffff:127.0.0.1). Returns a reason or null.
 */
export function blockedIpReason(ip: string): string | null {
  let addr = ip.trim().toLowerCase();
  // IPv4-mapped / -compat IPv6 carry a v4 tail we must judge as v4.
  const mapped = addr.match(/^(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) addr = mapped[1];

  if (IPV4_RX.test(addr)) {
    const p = addr.split(".").map(Number);
    if (p.some((n) => n > 255)) return "ip_malformed";
    const [a, b] = p;
    if (a === 0) return "ip_unspecified";
    if (a === 10) return "ip_private";
    if (a === 127) return "ip_loopback";
    if (a === 169 && b === 254) return "ip_link_local"; // incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return "ip_private";
    if (a === 192 && b === 168) return "ip_private";
    if (a === 100 && b >= 64 && b <= 127) return "ip_cgnat";
    if (a === 192 && b === 0) return "ip_reserved"; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return "ip_benchmark";
    if (a >= 240) return "ip_reserved"; // 240.0.0.0/4 + 255.255.255.255
    return null;
  }

  // IPv6.
  if (addr === "::1") return "ip_loopback";
  if (addr === "::" || addr === "") return "ip_unspecified";
  if (/^f[cd][0-9a-f]{2}:/i.test(addr)) return "ip_ula"; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(addr)) return "ip_link_local"; // fe80::/10
  return null;
}

/**
 * Validate a preview target. Refuses anything that isn't a plain public
 * http(s) site: other protocols, embedded credentials, IP literals (v4 or v6
 * — real sites have hostnames), localhost/internal suffixes (trailing-dot
 * normalized), and dotless hostnames (which resolve against internal search
 * domains). NOTE: this is the string-level guard; DNS-rebinding and
 * public-name-to-private-IP are closed at connect time by safeMirrorFetch,
 * which resolves + range-checks + pins the IP.
 */
export function guardTargetUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "protocol" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  const host = normalizeHost(url.hostname);
  if (!host || BLOCKED_HOST_RX.test(host)) return { ok: false, reason: "host" };
  if (IPV4_RX.test(host) || host.includes(":") || url.hostname.startsWith("[")) {
    return { ok: false, reason: "ip_literal" };
  }
  if (!host.includes(".")) return { ok: false, reason: "host" };
  return { ok: true, url };
}

/** Site slug a preview writes under — ordinary per-site isolation applies. */
export function sandboxSiteSlug(target: URL): string {
  return `sandbox--${target.hostname}`;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  /** Present only on 2xx text/html — the transform never sees other bodies. */
  body?: string;
  /** Final URL after redirects (all hops guarded + IP-checked). */
  finalUrl: string;
}

/**
 * Fetch an external page for the mirror WITHOUT the SSRF holes a plain
 * `fetch(url, { redirect: "follow" })` leaves open:
 *  - every host is DNS-resolved and EVERY resolved address range-checked
 *    (blockedIpReason) before any connection — a public name that resolves to
 *    a private/loopback/metadata IP is refused;
 *  - the connection is PINNED to the validated address via an undici Agent
 *    whose lookup only ever returns that IP, so the name can't re-resolve to a
 *    different address between check and connect (TOCTOU / DNS rebinding);
 *  - redirects are followed MANUALLY, re-running guardTargetUrl + resolve +
 *    range-check on each hop, so a public page can't 30x us onto localhost.
 * TLS still validates against the real hostname (SNI/servername unchanged).
 */
export async function safeMirrorFetch(
  startUrl: string,
  opts: { ua: string; timeoutMs: number; maxBytes: number; maxHops?: number },
): Promise<{ ok: true; result: SafeFetchResult } | { ok: false; reason: string }> {
  let current = startUrl;
  const maxHops = opts.maxHops ?? 5;

  // Connection-pinning (below) connects straight to the validated IP. That is
  // the right protection when we own the socket — but if an egress proxy is
  // configured (dev containers, some hosts), the proxy must do the connecting,
  // so pinning would both break the fetch AND be meaningless (the proxy
  // re-resolves anyway). Production (Netlify) has no such proxy → we pin.
  const proxied = !!(
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  );

  // undici ships with Node's global fetch; import lazily so a bundling hiccup
  // degrades to a clear error rather than a build failure.
  let Agent: typeof import("undici").Agent | null = null;
  if (!proxied) {
    try {
      ({ Agent } = await import("undici"));
    } catch {
      Agent = null; // fall back to the default dispatcher — resolve-check still runs
    }
  }

  for (let hop = 0; hop <= maxHops; hop++) {
    const guard = guardTargetUrl(current);
    if (!guard.ok) return { ok: false, reason: hop === 0 ? guard.reason : "redirect_" + guard.reason };
    const host = guard.url.hostname;

    // Resolve + range-check EVERY address the host maps to. This closes the
    // primary SSRF vector (a public name pointing at a private/loopback/
    // metadata IP) regardless of pinning, on every redirect hop.
    let addrs: { address: string; family: number }[];
    try {
      addrs = (await dnsLookupAll(host, { all: true })) as { address: string; family: number }[];
    } catch {
      return { ok: false, reason: "dns" };
    }
    if (addrs.length === 0) return { ok: false, reason: "dns" };
    for (const a of addrs) {
      const blocked = blockedIpReason(a.address);
      if (blocked) return { ok: false, reason: blocked };
    }

    // Pin the socket to the already-validated IP (no proxy only); TLS
    // servername stays the host so cert validation is unaffected. This also
    // closes the TOCTOU / DNS-rebinding race between check and connect.
    const agent =
      Agent && !proxied
        ? new Agent({
            connect: {
              lookup: (_hostname, _options, cb) =>
                cb(null, addrs[0].address as never, addrs[0].family as never),
            },
          })
        : null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      // `dispatcher` is an undici extension to RequestInit that Node's global
      // fetch honours but the DOM types don't declare — hence the cast.
      const init: RequestInit & { dispatcher?: unknown } = {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": opts.ua, accept: "text/html,application/xhtml+xml" },
      };
      if (agent) init.dispatcher = agent;
      res = await fetch(guard.url.href, init);
    } catch {
      return { ok: false, reason: hop === 0 ? "unreachable" : "redirect_unreachable" };
    } finally {
      clearTimeout(timer);
      if (agent) void agent.close();
    }

    // Manual redirect handling — resolve Location against the current URL and loop.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, reason: "bad_redirect" };
      try {
        current = new URL(loc, guard.url.href).href;
      } catch {
        return { ok: false, reason: "bad_redirect" };
      }
      continue;
    }

    const contentType = res.headers.get("content-type") || "";
    if (res.status !== 200) return { ok: true, result: { status: res.status, contentType, finalUrl: guard.url.href } };
    if (!contentType.includes("text/html")) {
      return { ok: false, reason: "not_html" };
    }
    const body = await res.text();
    if (body.length > opts.maxBytes) return { ok: false, reason: "too_large" };
    return { ok: true, result: { status: 200, contentType, body, finalUrl: guard.url.href } };
  }
  return { ok: false, reason: "too_many_redirects" };
}

const escAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface MirrorTransformOptions {
  /** Final page URL after redirects — becomes the <base href> so the page's
   *  relative assets load straight from the real site (browser-side, full
   *  egress — no asset proxying needed). */
  pageUrl: string;
  /** Our deployment origin, e.g. https://croengine.netlify.app */
  ourOrigin: string;
  /** sandbox--<host> */
  site: string;
  /** false → the FÖRE view: serve the page untouched (no snippet). */
  angel: boolean;
}

/**
 * Rewrite fetched target HTML into a mirror page:
 *  - CSP metas are stripped (we serve from our origin and inject a script;
 *    the target's CSP HTTP headers never applied to our response anyway),
 *  - any REAL Angel tag is stripped so an existing install can't double-run,
 *  - a <base> keeps the page's own asset URLs working (only if the page
 *    doesn't already set one),
 *  - the snippet tag (absolute src → endpoint defaults to our origin) plus a
 *    tiny reporter that postMessages the applied patterns to the embedding
 *    dashboard. Pure and deterministic — unit-tested.
 */
export function transformMirrorHtml(html: string, opts: MirrorTransformOptions): string {
  let out = html;
  out = out.replace(
    /<meta[^>]+http-equiv\s*=\s*["']?content-security-policy(-report-only)?["']?[^>]*\/?>/gi,
    "",
  );
  out = out.replace(/<script[^>]*adaptive\.js[^>]*>\s*<\/script>/gi, "");

  if (!/<base[\s>]/i.test(out)) {
    const baseTag = `<base href="${escAttr(opts.pageUrl)}">`;
    out = /<head(\s[^>]*)?>/i.test(out)
      ? out.replace(/<head(\s[^>]*)?>/i, (m) => m + baseTag)
      : baseTag + out;
  }

  if (opts.angel) {
    const snippetTag =
      `<script async src="${escAttr(opts.ourOrigin)}/adaptive.js"` +
      ` data-site="${escAttr(opts.site)}" data-endpoint="${escAttr(opts.ourOrigin)}"></script>`;
    // The mirror iframe is opaque-origin, so the dashboard can't read
    // window.AngelAdaptive out of it — the page reports its own result.
    const reporter =
      "<script>(function(){var n=0;var t=setInterval(function(){n++;" +
      "var A=window.AngelAdaptive;" +
      "if(A&&A.decision){clearInterval(t);try{parent.postMessage({type:'angel-sandbox'," +
      "site:A.site,applied:A.applied||[]},'*')}catch(e){}}" +
      "else if(n>60){clearInterval(t);" +
      "try{parent.postMessage({type:'angel-sandbox',site:" +
      JSON.stringify(opts.site) +
      ",applied:[],timedOut:true},'*')}catch(e){}}},250)})();</script>";
    const inject = snippetTag + reporter;
    out = out.includes("</head>") ? out.replace("</head>", `${inject}</head>`) : out + inject;
  }
  return out;
}
