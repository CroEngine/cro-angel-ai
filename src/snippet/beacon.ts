// A small batching ring buffer that flushes events to /api/ingest. Flushes on a
// size threshold, a timer, or page unload. Uses sendBeacon (survives unload) with
// a keepalive-fetch fallback. Both send a plain string body (text/plain) so the
// request stays CORS-"simple" and avoids a preflight on the hot path.

import type { IngestBatch, IngestEvent, VisitorSignals } from "./contract";

const MAX_BATCH = 20;
const FLUSH_MS = 5000;

export interface BeaconConfig {
  endpoint: string; // absolute URL of /api/ingest
  siteKey: string;
  visitorKey: string;
  sessionId: string;
  sig?: VisitorSignals;
}

export class Beacon {
  private buf: IngestEvent[] = [];
  private timer: number | undefined;
  private sigSent = false;

  constructor(private cfg: BeaconConfig) {}

  push(e: IngestEvent): void {
    this.buf.push(e);
    if (this.buf.length >= MAX_BATCH) {
      this.flush(false);
    } else if (this.timer === undefined) {
      this.timer = window.setTimeout(() => this.flush(false), FLUSH_MS);
    }
  }

  flush(unloading: boolean): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.buf.length === 0) return;

    const events = this.buf;
    this.buf = [];

    const batch: IngestBatch = {
      siteKey: this.cfg.siteKey,
      visitorKey: this.cfg.visitorKey,
      sessionId: this.cfg.sessionId,
      events,
    };
    // Acquisition signals ride along only on the first batch of the session.
    if (!this.sigSent && this.cfg.sig) {
      batch.sig = this.cfg.sig;
      this.sigSent = true;
    }

    const body = JSON.stringify(batch);

    let sent = false;
    if (unloading && typeof navigator.sendBeacon === "function") {
      try {
        sent = navigator.sendBeacon(this.cfg.endpoint, body);
      } catch {
        sent = false;
      }
    }
    if (!sent) {
      void fetch(this.cfg.endpoint, {
        method: "POST",
        body, // no Content-Type header → text/plain → no CORS preflight
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      }).catch(() => {
        /* best-effort telemetry */
      });
    }
  }
}
