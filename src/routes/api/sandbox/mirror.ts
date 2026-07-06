// GET /api/sandbox/mirror?url=...&exp=...&t=...[&angel=0][&angel_debug=1]
//
// Serves a token-gated mirror of an external page with the Angel snippet
// injected — the admin sandbox's iframe source. Tokens are minted only by the
// admin-only createSandboxPreview server fn, so this is not an open proxy.
// The snippet reads angel_debug from the page URL itself, so the dashboard's
// "markera ändringar" toggle is just an extra query param here.

import { createFileRoute } from "@tanstack/react-router";

import {
  guardTargetUrl,
  safeMirrorFetch,
  sandboxSecret,
  sandboxSiteSlug,
  transformMirrorHtml,
  verifySandboxToken,
} from "@/lib/sandbox/mirror.server";

const MAX_HTML_BYTES = 3_000_000;
const FETCH_TIMEOUT_MS = 12_000;
// A realistic browser UA — many sites 403 unknown agents. (Sites that block by
// datacenter IP will still refuse; that's inherent to any server-side fetch.)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function deny(status: number, reason: string): Response {
  return new Response(`sandbox mirror: ${reason}`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/sandbox/mirror")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = sandboxSecret();
        if (!secret) return deny(503, "unavailable");

        const q = new URL(request.url).searchParams;
        const rawUrl = q.get("url") ?? "";
        const exp = Number(q.get("exp") ?? "");
        const token = q.get("t") ?? "";
        const angel = q.get("angel") !== "0";

        const guarded = guardTargetUrl(rawUrl);
        if (!guarded.ok) return deny(400, guarded.reason);
        // Token is bound to the raw url the admin approved — verify BEFORE any
        // network work. Then safeMirrorFetch resolves + range-checks + pins the
        // IP and re-guards every redirect hop (DNS-rebinding / redirect-to-
        // internal are closed there, not by the string guard above).
        if (!verifySandboxToken(rawUrl, exp, token, secret)) return deny(403, "bad_token");

        const fetched = await safeMirrorFetch(guarded.url.href, {
          ua: UA,
          timeoutMs: FETCH_TIMEOUT_MS,
          maxBytes: MAX_HTML_BYTES,
        });
        if (!fetched.ok) {
          // not_html is the one client-meaningful 4xx; everything else
          // (dns, ip_*, unreachable, redirect_*, too_large) is an upstream 502.
          return deny(fetched.reason === "not_html" ? 415 : 502, fetched.reason);
        }
        const { result } = fetched;
        if (result.status !== 200 || result.body === undefined) {
          return deny(502, "upstream_" + result.status);
        }

        const ourOrigin = new URL(request.url).origin;
        const finalGuard = guardTargetUrl(result.finalUrl);
        const site = finalGuard.ok ? sandboxSiteSlug(finalGuard.url) : sandboxSiteSlug(guarded.url);
        const body = transformMirrorHtml(result.body, {
          pageUrl: result.finalUrl,
          ourOrigin,
          site,
          angel,
        });
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-robots-tag": "noindex, nofollow",
            "referrer-policy": "no-referrer",
            // `sandbox allow-scripts` forces an OPAQUE origin however the
            // mirror is opened (iframe or new tab): the mirrored site's
            // scripts run, but can never reach our origin's storage/session.
            // frame-ancestors: only our own pages may embed it.
            "content-security-policy": "sandbox allow-scripts; frame-ancestors 'self'",
          },
        });
      },
    },
  },
});
