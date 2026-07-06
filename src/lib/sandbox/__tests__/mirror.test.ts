import { describe, it, expect } from "vitest";

import {
  blockedIpReason,
  guardTargetUrl,
  normalizeHost,
  sandboxSiteSlug,
  signSandboxToken,
  transformMirrorHtml,
  verifySandboxToken,
} from "../mirror.server";

const SECRET = "test-secret";

describe("sandbox tokens", () => {
  it("round-trips a valid token", () => {
    const exp = 1_000_000;
    const t = signSandboxToken("https://example.com/", exp, SECRET);
    expect(verifySandboxToken("https://example.com/", exp, t, SECRET, exp - 1)).toBe(true);
  });

  it("rejects tampered url, exp, token and wrong secret", () => {
    const exp = 1_000_000;
    const t = signSandboxToken("https://example.com/", exp, SECRET);
    const now = exp - 1;
    expect(verifySandboxToken("https://evil.com/", exp, t, SECRET, now)).toBe(false);
    expect(verifySandboxToken("https://example.com/", exp + 1, t, SECRET, now)).toBe(false);
    expect(verifySandboxToken("https://example.com/", exp, t.slice(0, -1) + "0", SECRET, now)).toBe(false);
    expect(verifySandboxToken("https://example.com/", exp, t, "other-secret", now)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const exp = 1_000_000;
    const t = signSandboxToken("https://example.com/", exp, SECRET);
    expect(verifySandboxToken("https://example.com/", exp, t, SECRET, exp + 1)).toBe(false);
  });
});

describe("guardTargetUrl — SSRF surface", () => {
  it("accepts plain public http(s) sites", () => {
    expect(guardTargetUrl("https://example.com/page?x=1").ok).toBe(true);
    expect(guardTargetUrl("http://books.toscrape.com").ok).toBe(true);
  });

  it("refuses non-http protocols and embedded credentials", () => {
    expect(guardTargetUrl("file:///etc/passwd").ok).toBe(false);
    expect(guardTargetUrl("ftp://example.com/").ok).toBe(false);
    expect(guardTargetUrl("https://user:pw@example.com/").ok).toBe(false);
    expect(guardTargetUrl("not a url").ok).toBe(false);
  });

  it("refuses IP literals, localhost and internal suffixes — incl. trailing-dot FQDN form", () => {
    for (const bad of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.8/",
      "http://[::1]/",
      "http://localhost:3000/",
      "http://foo.localhost/",
      "http://intranet.local/",
      "http://db.internal/",
      "http://bare-hostname/",
      // Trailing-dot bypass — the FQDN form resolvers accept for the same host.
      "http://localhost./",
      "http://db.internal./",
      "http://metadata.google.internal./",
      "http://127.0.0.1./",
      // Integer / octal / hex IPv4 forms normalize to a literal → ip_literal.
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://0/",
    ]) {
      expect(guardTargetUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe("normalizeHost", () => {
  it("strips trailing dots and lowercases", () => {
    expect(normalizeHost("LocalHost.")).toBe("localhost");
    expect(normalizeHost("Example.COM...")).toBe("example.com");
  });
});

describe("blockedIpReason — the connect-time SSRF gate", () => {
  it("blocks loopback, private, CGNAT, link-local (metadata) and reserved v4", () => {
    for (const ip of [
      "127.0.0.1",
      "127.10.20.30",
      "10.0.0.1",
      "172.16.5.5",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "192.0.2.5",
      "198.18.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]) {
      expect(blockedIpReason(ip), ip).not.toBeNull();
    }
  });

  it("blocks IPv6 loopback/ULA/link-local and IPv4-mapped internal", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(blockedIpReason(ip), ip).not.toBeNull();
    }
  });

  it("allows real public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1::1"]) {
      expect(blockedIpReason(ip), ip).toBeNull();
    }
  });
});

describe("transformMirrorHtml", () => {
  const OPTS = {
    pageUrl: "https://example.com/start/",
    ourOrigin: "https://croengine.netlify.app",
    site: "sandbox--example.com",
    angel: true,
  };

  it("strips CSP metas and any existing Angel tag, injects base + snippet + reporter", () => {
    const html =
      "<html><head>" +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">' +
      '<script async src="https://croengine.netlify.app/adaptive.js" data-site="example.com" data-key="ak_x"></script>' +
      "</head><body>hi</body></html>";
    const out = transformMirrorHtml(html, OPTS);
    expect(out).not.toContain("Content-Security-Policy");
    expect(out).not.toContain("ak_x"); // the REAL install's tag is gone
    expect(out).toContain('<base href="https://example.com/start/">');
    expect(out).toContain('data-site="sandbox--example.com"');
    expect(out).toContain('data-endpoint="https://croengine.netlify.app"');
    expect(out).toContain("angel-sandbox"); // reporter postMessage
    // Exactly one snippet tag — ours.
    expect(out.match(/adaptive\.js/g)?.length).toBe(1);
  });

  it("keeps an existing <base> and copes with head-less documents", () => {
    const withBase = '<head><base href="/x/"><title>t</title></head>ok';
    expect(transformMirrorHtml(withBase, OPTS).match(/<base/gi)?.length).toBe(1);

    const headless = "<p>bare fragment</p>";
    const out = transformMirrorHtml(headless, OPTS);
    expect(out).toContain("<base href=");
    expect(out).toContain("data-site=");
  });

  it("angel:false serves the page untouched apart from base/CSP hygiene", () => {
    const out = transformMirrorHtml("<html><head></head><body></body></html>", {
      ...OPTS,
      angel: false,
    });
    expect(out).not.toContain("adaptive.js");
    expect(out).not.toContain("angel-sandbox");
  });

  it("escapes attribute values", () => {
    const out = transformMirrorHtml("<head></head>", {
      ...OPTS,
      pageUrl: 'https://example.com/"><script>x</script>',
    });
    expect(out).not.toContain('"><script>x</script>');
  });
});

describe("sandboxSiteSlug", () => {
  it("derives the isolated per-host slug", () => {
    expect(sandboxSiteSlug(new URL("https://www.example.com/a"))).toBe("sandbox--www.example.com");
  });
});
