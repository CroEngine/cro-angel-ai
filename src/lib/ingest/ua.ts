// Minimal user-agent classifier — coarse device/browser/os, no external lib.
// The raw UA is parsed server-side (the snippet just forwards navigator.userAgent)
// so we store a small summary, never the raw string.

export interface DeviceInfo {
  type: "mobile" | "tablet" | "desktop";
  browser?: string;
  os?: string;
}

export function parseUserAgent(ua: string | undefined): DeviceInfo {
  if (!ua) return { type: "desktop" };
  const s = ua.toLowerCase();

  const tablet = /ipad|tablet|playbook|silk|android(?!.*mobi)/.test(s);
  const mobile = /mobi|iphone|ipod|blackberry|iemobile|opera mini/.test(s);
  const type: DeviceInfo["type"] = tablet ? "tablet" : mobile ? "mobile" : "desktop";

  let browser: string | undefined;
  if (/edg\//.test(s)) browser = "Edge";
  else if (/chrome|crios/.test(s)) browser = "Chrome";
  else if (/firefox|fxios/.test(s)) browser = "Firefox";
  else if (/safari/.test(s)) browser = "Safari";

  let os: string | undefined;
  if (/windows/.test(s)) os = "Windows";
  else if (/mac os|macintosh/.test(s)) os = "macOS";
  else if (/android/.test(s)) os = "Android";
  else if (/iphone|ipad|ipod/.test(s)) os = "iOS";
  else if (/linux/.test(s)) os = "Linux";

  return { type, browser, os };
}
