// Enhetlig inloggning/registrering (ägarbeslut 2026-07-27, ChatGPT-mönstret):
// e-post först, sedan rätt steg 2. Serverfunktionen är den ENDA vägen till
// "finns kontot?"-svaret — RPC:n är service-role-låst, och här normaliseras
// fel (okänt/ogiltigt ⇒ false, aldrig throw) så klienten bara får en boolean.
//
// Enumeration-avvägning (ärligt): svaret läcker om en adress har konto — samma
// avvägning som ChatGPT/Google gjort för flödets skull. Ytan är minimal:
// ingen lösenordskontroll, inga sidoeffekter, inga mejl skickas.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const emailHasAccount = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().trim().toLowerCase().email() }))
  .handler(async ({ data }): Promise<{ exists: boolean }> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: exists, error } = await supabaseAdmin.rpc("angel_email_has_account", {
        p_email: data.email,
      });
      if (error) return { exists: false };
      return { exists: exists === true };
    } catch {
      return { exists: false };
    }
  });
