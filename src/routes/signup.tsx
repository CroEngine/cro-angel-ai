// /signup — enhetliga auth-formuläret (ägarbeslut 2026-07-27): samma komponent
// som /login. URL:en lever kvar för alla befintliga länkar och kampanjer;
// den som redan har konto fångas mjukt av e-poststeget och hamnar i
// inloggningen i stället. Visitor-info-intyget (juridiska attesten) bor i
// formulärets nytt-konto-steg, ordagrant bevarat.

import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign in or sign up — Agritm" }] }),
  component: Signup,
});

function Signup() {
  return <AuthForm />;
}
