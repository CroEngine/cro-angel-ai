// Minimal auth gate for the dashboard. Checks the Supabase session, subscribes to
// auth changes, and renders a login card until the user is signed in. No router
// redirect needed — it simply swaps what it renders.

import type { Session } from "@supabase/supabase-js";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (!session) return <LoginCard />;
  return <>{children}</>;
}

export function signOut() {
  return supabase.auth.signOut();
}

function LoginCard() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setInfo("Account created. Check your email to confirm, then sign in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Angel Adaptive</CardTitle>
          <CardDescription>
            {mode === "signin" ? "Sign in to your dashboard." : "Create your account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
