// Consent-first boot. We persist a first-party id / link sessions only when
// consent is known to allow it. Resolution order: TCF CMP → (site-configured
// signal, wired once /api/config lands) → anonymous_default: operate, but
// in-memory only, no persistence. Adaptation needs *signals*, not *identity*, so
// the product still functions in anonymous mode.

export type ConsentMode = "tcf" | "site_signal" | "anonymous_default";

export interface ConsentDecision {
  persist: boolean; // may we persist a first-party id + link sessions?
  mode: ConsentMode;
}

type TcfApi = (cmd: string, version: number, cb: (data: TcData, success: boolean) => void) => void;

interface TcData {
  purpose?: { consents?: Record<string, boolean | undefined> };
}

// Non-blocking TCF probe with a short timeout so a slow or absent CMP never holds
// up the page. Returns true/false if a CMP answered, null if none is present.
function probeTcf(timeoutMs: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const api = (window as unknown as { __tcfapi?: TcfApi }).__tcfapi;
    if (typeof api !== "function") {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (v: boolean | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    try {
      api("getTCData", 2, (data, ok) => {
        window.clearTimeout(timer);
        if (!ok || !data) return done(null);
        // Purpose 1 = "Store and/or access information on a device".
        done(Boolean(data.purpose?.consents?.["1"]));
      });
    } catch {
      window.clearTimeout(timer);
      done(null);
    }
  });
}

export async function resolveConsent(): Promise<ConsentDecision> {
  const tcf = await probeTcf(500);
  if (tcf === true) return { persist: true, mode: "tcf" };
  if (tcf === false) return { persist: false, mode: "tcf" };
  return { persist: false, mode: "anonymous_default" };
}
