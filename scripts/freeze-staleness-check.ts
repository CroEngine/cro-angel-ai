#!/usr/bin/env bun
/**
 * Grind 3 — Staleness check.
 *
 * Auktoritativt:  meta.expiresAt < now → stale
 * Rådgivande:     HEAD-diff (etag/last-modified/content-length ±10%) → hint
 * Warning:        chromiumVersion drift mot Playwright-bundled
 *
 * Producerar corpus/STALENESS.json. Returnerar exit 0 även med stale snapshots
 * — människa-i-loopen, ingen auto-re-freeze. Exit 2 reserverat för verktygsfel.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Meta {
  url: string;
  name: string;
  captured_at?: string;
  frozenAt?: string;
  expiresAt?: string;
  ttlDays?: number;
  refreezeReason?: string;
}

interface SnapshotStatus {
  name: string;
  url: string;
  frozenAt: string | null;
  expiresAt: string | null;
  ttlDays: number | null;
  stale: boolean;
  staleReason: string | null;
  hints: string[];
  headProbe: {
    ok: boolean;
    etag: string | null;
    lastModified: string | null;
    contentLength: number | null;
    error: string | null;
  } | null;
}

const corpusDir = "corpus";
const entries = readdirSync(corpusDir).filter((n) => {
  const p = join(corpusDir, n);
  return statSync(p).isDirectory() && existsSync(join(p, "meta.json"));
});

async function headProbe(url: string): Promise<SnapshotStatus["headProbe"]> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return {
      ok: res.ok,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      contentLength: res.headers.get("content-length") ? Number(res.headers.get("content-length")) : null,
      error: res.ok ? null : `${res.status} ${res.statusText}`,
    };
  } catch (e) {
    return { ok: false, etag: null, lastModified: null, contentLength: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const now = Date.now();
const statuses: SnapshotStatus[] = [];

for (const name of entries) {
  const metaPath = join(corpusDir, name, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  const frozenAt = meta.frozenAt ?? meta.captured_at ?? null;
  const expiresAt = meta.expiresAt ?? null;
  const ttlDays = meta.ttlDays ?? null;

  const hints: string[] = [];
  let stale = false;
  let staleReason: string | null = null;

  // Auktoritativt
  if (expiresAt) {
    const expMs = Date.parse(expiresAt);
    if (!Number.isNaN(expMs) && expMs < now) {
      stale = true;
      staleReason = `expiresAt (${expiresAt}) < now`;
    }
  } else {
    hints.push("no-expiresAt-in-meta (older snapshot format; re-freeze to populate)");
  }

  // Rådgivande — HEAD-diff. Loggas som hint, inte stale.
  const probe = await headProbe(meta.url);
  if (probe?.ok && existsSync(join(corpusDir, name, "freeze-report.json"))) {
    const report = JSON.parse(readFileSync(join(corpusDir, name, "freeze-report.json"), "utf8"));
    const frozenSize = report.capture?.mhtmlKb ? report.capture.mhtmlKb * 1024 : null;
    if (probe.contentLength && frozenSize) {
      const ratio = probe.contentLength / frozenSize;
      if (ratio < 0.5 || ratio > 2) {
        hints.push(`live-url-content-length-changed (frozen=${frozenSize}b live=${probe.contentLength}b ratio=${ratio.toFixed(2)})`);
      }
    }
    // Capture-drift (Chromium) — warning, inte stale.
    const frozenChromium = report.env?.chromiumVersion ?? null;
    if (frozenChromium) {
      hints.push(`captured-with-chromium=${frozenChromium} (A+C: warning only, not stale)`);
    }
  }

  statuses.push({
    name, url: meta.url, frozenAt, expiresAt, ttlDays,
    stale, staleReason, hints, headProbe: probe,
  });
}

const staleCount = statuses.filter((s) => s.stale).length;
const out = {
  ranAt: new Date().toISOString(),
  total: statuses.length,
  staleCount,
  snapshots: statuses,
};
const outPath = join(corpusDir, "STALENESS.json");
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`[staleness] -> ${outPath}`);
console.log(`[staleness] ${staleCount}/${statuses.length} stale (TTL-auktoritativt; HEAD-hints rådgivande)`);
