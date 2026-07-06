// Angel Adaptive — admin sandbox (server functions).
//
// createSandboxPreview mints short-lived signed mirror URLs for the /sandbox
// page: paste any URL, see the page FÖRE/EFTER with Angel applied — nothing
// installed on the real site, and (anonymous mode + sandbox-- slug) zero
// events written, so previews can never add noise to measurement.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  guardTargetUrl,
  sandboxSecret,
  sandboxSiteSlug,
  signSandboxToken,
  SANDBOX_TOKEN_TTL_MS,
} from "@/lib/sandbox/mirror.server";
import { isAdminEmail } from "./dashboard.functions";

export interface SandboxPreview {
  ok: boolean;
  /** "admin" | "invalid_url" | "unavailable" | guard reason — for the UI. */
  reason?: string;
  site?: string;
  /** Mirror path WITH Angel (append &angel_debug=1 to highlight changes). */
  mirrorPath?: string;
  /** Mirror path WITHOUT Angel — the FÖRE frame. */
  mirrorOffPath?: string;
}

export const createSandboxPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ url: z.string().min(4).max(2000) }))
  .handler(async ({ data, context }): Promise<SandboxPreview> => {
    const email = (context as unknown as { claims?: { email?: string } }).claims?.email;
    if (!isAdminEmail(email)) return { ok: false, reason: "admin" };

    // Default to https:// when the admin types a bare domain.
    const raw = /^[a-z][a-z0-9+.-]*:/i.test(data.url.trim())
      ? data.url.trim()
      : `https://${data.url.trim()}`;
    const guarded = guardTargetUrl(raw);
    if (!guarded.ok) return { ok: false, reason: guarded.reason };

    const secret = sandboxSecret();
    if (!secret) return { ok: false, reason: "unavailable" };

    const url = guarded.url.href;
    const exp = Date.now() + SANDBOX_TOKEN_TTL_MS;
    const t = signSandboxToken(url, exp, secret);
    const qs = `url=${encodeURIComponent(url)}&exp=${exp}&t=${t}`;
    return {
      ok: true,
      site: sandboxSiteSlug(guarded.url),
      mirrorPath: `/api/sandbox/mirror?${qs}`,
      mirrorOffPath: `/api/sandbox/mirror?${qs}&angel=0`,
    };
  });
