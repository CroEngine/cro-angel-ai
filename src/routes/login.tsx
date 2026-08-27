// /login — enhetliga auth-formuläret (ägarbeslut 2026-07-27): samma komponent
// som /signup, ChatGPT-mönstret — e-post först, systemet visar rätt steg 2.
// URL:en lever kvar för alla befintliga länkar; ?redirect= respekteras som
// förut (enbart sajt-egna relativa mål, se AuthForm). Säkerhetsgränsen är
// oförändrat server-side: requireSupabaseAuth validerar JWT:n per server-fn.

import { createFileRoute, useSearch } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in — Agritm" }] }),
  component: Login,
});

function Login() {
  const { redirect } = useSearch({ from: "/login" });
  return <AuthForm redirect={redirect} />;
}
