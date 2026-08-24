// Onboardingens server-fns (ägarbeslut 2026-08-18, "snuskigt enkel"):
//
//   activateFromPreview — demo-jobb → sajt, noll formulär. Tunn wrapper runt
//                         performActivation (kärnan, testad separat).
//   getInstallState     — /welcome-skärmens live-puls: är snippeten sedd än?
//                         (domain_verified_at stämplas av första origin-
//                         bevisade eventet), plus consent-läget för
//                         attesterings-steget.
//
// Båda auth-gatade; getInstallState dessutom ägarskapsgrindad (ownsSite) —
// installationsstatus är sajtens ägares sak, ingen annans.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdminEmail, ownsSite, type AuthCtx } from "@/lib/dashboard/dashboard.functions";

import { performActivation, type ActivationResult } from "./activate.server";

export const activateFromPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }): Promise<ActivationResult> => {
    const ctx = context as unknown as AuthCtx;
    return performActivation(
      { userId: ctx.userId, isAdmin: isAdminEmail(ctx.claims?.email) },
      data.jobId,
    );
  });

export const getInstallState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ site: z.string().min(1).max(200) }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      ok: boolean;
      installedAt: string | null;
      consentMode: "anonymous" | "attested" | null;
      domain: string | null;
      ingestKey: string | null;
    }> => {
      const empty = { installedAt: null, consentMode: null, domain: null, ingestKey: null };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, data.site))) {
        return { ok: false, ...empty };
      }
      const { data: row } = await supabaseAdmin
        .from("angel_sites")
        .select("domain_verified_at,consent_mode,domain,ingest_key")
        .eq("slug", data.site)
        .maybeSingle();
      if (!row) return { ok: false, ...empty };
      return {
        ok: true,
        installedAt: row.domain_verified_at ?? null,
        consentMode: (row.consent_mode as "anonymous" | "attested" | null) ?? null,
        domain: row.domain ?? null,
        ingestKey: row.ingest_key ?? null,
      };
    },
  );
