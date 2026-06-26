// Pseudonymous first-party identity. Before consent allows persistence (and in
// anonymous_default mode) the visitor id lives in memory only — no cookie, no
// storage, no cross-session linking. Once persistence is allowed, the id is
// stored so returning visitors are recognized. The session id rotates after
// 30 min of inactivity.

const VID_KEY = "_angel_vid";
const SID_KEY = "_angel_sid";
const SID_TS_KEY = "_angel_sid_ts";
const SESSION_TTL_MS = 30 * 60 * 1000;

function randomId(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, "0");
  return s;
}

export interface Identity {
  visitorKey: string;
  sessionId: string;
  returning: boolean;
}

export function resolveIdentity(persist: boolean): Identity {
  let visitorKey: string | null = null;
  let returning = false;

  if (persist) {
    try {
      visitorKey = localStorage.getItem(VID_KEY);
    } catch {
      /* storage blocked — fall through to in-memory id */
    }
  }
  if (visitorKey) {
    returning = true;
  } else {
    visitorKey = randomId();
    if (persist) {
      try {
        localStorage.setItem(VID_KEY, visitorKey);
      } catch {
        /* ignore */
      }
    }
  }

  // Session id: reuse if recent, otherwise mint a new one.
  let sessionId: string | null = null;
  if (persist) {
    try {
      const prevTs = Number(sessionStorage.getItem(SID_TS_KEY) || 0);
      if (Date.now() - prevTs < SESSION_TTL_MS) {
        sessionId = sessionStorage.getItem(SID_KEY);
      }
    } catch {
      /* ignore */
    }
  }
  if (!sessionId) sessionId = randomId();
  if (persist) {
    try {
      sessionStorage.setItem(SID_KEY, sessionId);
      sessionStorage.setItem(SID_TS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  return { visitorKey, sessionId, returning };
}
