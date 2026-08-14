// Enhetlig inloggning/registrering (ägarbeslut 2026-07-27, ChatGPT-mönstret):
// ETT formulär för båda — e-post först, sedan visar systemet rätt steg 2:
// lösenord för befintligt konto, lösenord + visitor-info-intyget (den
// juridiska attesten, oförändrad text) för nytt. /login och /signup renderar
// samma komponent; ingen behöver längre veta i förväg vilken sida som är "rätt".

import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { emailHasAccount } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step = "email" | "signin" | "signup" | "confirm_sent";

// Ärlig felöversättning för inloggningen (granskningsfynd 2026-08-14): ALLA
// signInWithPassword-fel visades som "fel lösenord" — även "Email not
// confirmed" (användaren skickades på lösenordsåterställning i stället för
// till bekräftelsemejlet) och rena nätfel. Ren, exporterad funktion så
// mappningen kan vitest-testas utan DOM — repots mönster.
export function signInErrorMessage(error: {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}): string {
  const message = error.message ?? "";
  if (error.code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "Your email isn't confirmed yet — click the link in the email we sent you, then sign in.";
  }
  if (error.code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "That password doesn't match this account — try again.";
  }
  if (error.code === "over_request_rate_limit" || error.status === 429) {
    return "Too many attempts — wait a minute and try again.";
  }
  // AuthRetryableFetchError: nätfel (status 0) eller 5xx hos Supabase — inget
  // svar hanns fås ⇒ status saknas. Aldrig användarens fel.
  if (
    error.name === "AuthRetryableFetchError" ||
    error.status === undefined ||
    error.status === 0 ||
    error.status >= 500
  ) {
    return "We couldn't reach the sign-in service — check your connection and try again.";
  }
  return message || "Something went wrong signing you in — try again.";
}

export function AuthForm({ redirect }: { redirect?: string }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Bara sajt-egna relativa mål (aldrig en attacker-styrd absolut URL ur
  // ?redirect=) — samma regel som gamla /login.
  const dest =
    redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/dashboard";

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { exists } = await emailHasAccount({ data: { email } });
      setStep(exists ? "signin" : "signup");
    } catch {
      // Kontrollen är en bekvämlighet — faller den, anta nytt konto; en
      // befintlig adress fångas av signUp:s "already registered" nedan.
      setStep("signup");
    } finally {
      setBusy(false);
    }
  }

  async function submitSignin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(signInErrorMessage(error));
      return;
    }
    navigate({ to: dest });
  }

  async function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!ack) {
      setError("Please acknowledge how Angel uses visitor information.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        // Ägarens intyg (rättslig grund för besökarinformation) stämplas på
        // kontot — samma attest som gamla /signup, ordagrant bevarad.
        data: {
          visitor_info_acknowledged: true,
          visitor_info_acknowledged_at: new Date().toISOString(),
        },
      },
    });
    setBusy(false);
    if (error) {
      // Existenskontrollen kan ha fel-fallits till "nytt konto" — säg då
      // ärligt att adressen redan finns och byt till inloggningssteget.
      if (/already registered/i.test(error.message)) {
        setStep("signin");
        setPassword("");
        setError("That address already has an account — sign in instead.");
        return;
      }
      setError(error.message);
      return;
    }
    if (data.session) {
      navigate({ to: dest });
    } else {
      setStep("confirm_sent");
    }
  }

  const emailChip = (
    <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm">
      <span className="truncate text-stone-700">{email}</span>
      <button
        type="button"
        className="ml-3 flex-none text-xs font-medium text-emerald-700 hover:underline"
        onClick={() => {
          setStep("email");
          setPassword("");
          setAck(false);
          setError(null);
        }}
      >
        Edit
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf9] px-4 text-stone-900">
      <Card className="w-full max-w-sm rounded-2xl border-stone-200 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-[18px] font-bold">
            <span className="text-xl leading-none text-emerald-700">✳</span>{" "}
            {step === "signup" ? "Create your account" : "Sign in or sign up"}
          </CardTitle>
          {step !== "email" && (
            <p className="text-sm text-muted-foreground">
              {step === "signin" && "Welcome back — enter your password."}
              {step === "signup" && "New here — pick a password to get started."}
              {step === "confirm_sent" && "One click left."}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {step === "email" && (
            <form onSubmit={submitEmail} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-emerald-700 text-white hover:bg-emerald-600"
                disabled={busy}
              >
                {busy ? "One moment…" : "Continue"}
              </Button>
            </form>
          )}

          {step === "signin" && (
            <form onSubmit={submitSignin} className="space-y-4">
              {emailChip}
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <Button
                type="submit"
                className="w-full bg-emerald-700 text-white hover:bg-emerald-600"
                disabled={busy}
              >
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}

          {step === "signup" && (
            <form onSubmit={submitSignup} className="space-y-4">
              {emailChip}
              <div className="space-y-1.5">
                <Label htmlFor="password">Choose a password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3">
                <div className="mb-2 font-mono text-[11px] tracking-wider text-emerald-700">
                  [ visitor information ]
                </div>
                <label htmlFor="ack" className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    id="ack"
                    checked={ack}
                    onCheckedChange={(v) => setAck(v === true)}
                    className="mt-0.5 border-stone-400 data-[state=checked]:border-emerald-700 data-[state=checked]:bg-emerald-700"
                  />
                  <span className="text-xs leading-relaxed text-stone-600">
                    To measure real lift, Angel uses <strong>visitor information</strong> — a
                    persistent visitor id and conversion events — on the sites I connect. I confirm
                    I have a lawful basis or visitor consent for this and remain the data
                    controller. Visitors who signal Global Privacy Control or Do&nbsp;Not&nbsp;Track
                    are always excluded.
                  </span>
                </label>
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <Button
                type="submit"
                className="w-full bg-emerald-700 text-white hover:bg-emerald-600"
                disabled={busy || !ack}
              >
                {busy ? "Creating…" : "Create account"}
              </Button>
            </form>
          )}

          {step === "confirm_sent" && (
            <div className="space-y-3 text-sm">
              <p className="text-foreground">
                Check <strong>{email}</strong> for a confirmation link — then you&apos;re in.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Back to sign in</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
