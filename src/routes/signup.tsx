// /signup — self-service account creation for the Angel dashboard.
//
// Email + password via Supabase Auth. When email confirmation is enabled
// (recommended), signUp returns no session until the user clicks the link in
// their inbox, so we show a "check your email" state; if confirmation is off we
// get a session immediately and go straight to the dashboard. New accounts own
// nothing until they add a site.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — Angel Adaptive" }] }),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        // Record the owner's acknowledgment (lawful basis for visitor
        // information) on the account itself — this is the attestation, moved
        // out of the per-site toggle so setup is one decision, not many.
        data: {
          visitor_info_acknowledged: true,
          visitor_info_acknowledged_at: new Date().toISOString(),
        },
      },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Confirmation off → session present → straight in. Confirmation on → no
    // session yet → tell them to check their inbox.
    if (data.session) {
      navigate({ to: "/dashboard" });
    } else {
      setSent(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafaf9] px-4 text-stone-900">
      <Card className="w-full max-w-sm border-stone-200 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="text-xl leading-none text-emerald-700">✳</span> Create your account
          </CardTitle>
          <p className="text-sm text-muted-foreground">Start measuring lift on your site.</p>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-3 text-sm">
              <p className="text-foreground">
                Check <strong>{email}</strong> for a confirmation link, then sign in.
              </p>
              <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/login" })}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
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
                    persistent visitor id and conversion events — on the sites I connect. I confirm I
                    have a lawful basis or visitor consent for this and remain the data controller.
                    Visitors who signal Global Privacy Control or Do&nbsp;Not&nbsp;Track are always
                    excluded.
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
              <p className="text-center text-xs text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="text-emerald-700 hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
