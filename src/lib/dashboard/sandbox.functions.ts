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
import { isAdminEmail, ownsSite, type AuthCtx } from "./dashboard.functions";
import { mirrorStorageKey } from "@/lib/sandbox/mirror-key";
import { segmentDims } from "@/lib/segment-key";

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

export interface VariantPreview {
  ok: boolean;
  /** "not_owner" | "not_found" | "no_domain" | "unavailable" | guard reason. */
  reason?: string;
  /** Spegeln MED varianten tvingad (?angel_variant=<id>) — EFTER-ramen. */
  mirrorPath?: string;
  /** Spegeln utan Angel — FÖRE-ramen. */
  mirrorOffPath?: string;
  /** Variantens segment gäller mobil → rendera ramarna i mobilbredd. */
  mobile?: boolean;
}

/**
 * "Se live" för EN variant: minta spegel-URL:er för variantens riktiga sida
 * (https://<sajtens domän><variantens path>) där EFTER-ramen tvingar exakt den
 * variantens serve-ops genom snippetens vanliga apply-väg. Ägar-gatad (inte
 * bara admin) — det här är vad kunden tittar på innan hen godkänner.
 * Sandbox-slugs skriver aldrig events, så en titt blir aldrig en mätpunkt.
 */
export const createVariantPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ site: z.string().min(1), variantId: z.string().uuid() }))
  .handler(async ({ data, context }): Promise<VariantPreview> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, data.site))) {
      return { ok: false, reason: "not_owner" };
    }

    const { data: v, error } = await supabaseAdmin
      .from("angel_variants")
      .select("id,path,segment_key,status")
      .eq("id", data.variantId)
      .eq("site", data.site)
      .in("status", ["verified", "serving", "winner"])
      .maybeSingle();
    if (error || !v) return { ok: false, reason: "not_found" };

    const { data: siteRow } = await supabaseAdmin
      .from("angel_sites")
      .select("domain")
      .eq("slug", data.site)
      .maybeSingle();
    if (!siteRow?.domain) return { ok: false, reason: "no_domain" };

    const guarded = guardTargetUrl(`https://${siteRow.domain}${v.path}`);
    if (!guarded.ok) return { ok: false, reason: guarded.reason };
    const secret = sandboxSecret();
    if (!secret) return { ok: false, reason: "unavailable" };

    const url = guarded.url.href;
    const exp = Date.now() + SANDBOX_TOKEN_TTL_MS;
    const t = signSandboxToken(url, exp, secret);
    // Segmentnyckelns dimensioner skiljs med "·" (t.ex. "instagram·mobile·SE").
    const mobile = segmentDims(v.segment_key).includes("mobile");
    const qs =
      `url=${encodeURIComponent(url)}&exp=${exp}&t=${t}` + (mobile ? "&angel_device=mobile" : "");
    return {
      ok: true,
      mirrorPath: `/api/sandbox/mirror?${qs}&angel_variant=${encodeURIComponent(v.id)}`,
      mirrorOffPath: `/api/sandbox/mirror?${qs}&angel=0`,
      mobile,
    };
  });
