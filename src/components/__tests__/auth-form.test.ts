import { describe, it, expect } from "vitest";

import { signInErrorMessage } from "../auth-form";

// Granskningsfynd 2026-08-14: alla signInWithPassword-fel kollapsade till
// "fel lösenord" — även obekräftad e-post och nätfel. Testerna pinnar den
// ärliga mappningen mot Supabase-felens verkliga former (code/status/name ur
// @supabase/auth-js) — ingen DOM, repots mönster.

describe("signInErrorMessage — ärlig översättning av Supabase-fel", () => {
  it("obekräftad e-post pekar på bekräftelselänken, inte lösenordet", () => {
    const msg = signInErrorMessage({
      code: "email_not_confirmed",
      status: 400,
      name: "AuthApiError",
      message: "Email not confirmed",
    });
    expect(msg).toMatch(/confirm/i);
    expect(msg).not.toMatch(/password/i);
  });

  it("obekräftad e-post fångas på message när code saknas (äldre GoTrue)", () => {
    const msg = signInErrorMessage({
      status: 400,
      name: "AuthApiError",
      message: "Email not confirmed",
    });
    expect(msg).toMatch(/confirm/i);
    expect(msg).not.toMatch(/password/i);
  });

  it("fel lösenord behåller den raka lösenordskopian", () => {
    const msg = signInErrorMessage({
      code: "invalid_credentials",
      status: 400,
      name: "AuthApiError",
      message: "Invalid login credentials",
    });
    expect(msg).toBe("That password doesn't match this account — try again.");
  });

  it("rate limit säger vänta — inte att lösenordet är fel", () => {
    const msg = signInErrorMessage({
      code: "over_request_rate_limit",
      status: 429,
      name: "AuthApiError",
      message: "Request rate limit reached",
    });
    expect(msg).toMatch(/too many attempts/i);
    expect(msg).not.toMatch(/password/i);
  });

  it("nätfel (AuthRetryableFetchError, status 0) skyller aldrig på lösenordet", () => {
    const msg = signInErrorMessage({
      status: 0,
      name: "AuthRetryableFetchError",
      message: "Failed to fetch",
    });
    expect(msg).toMatch(/couldn't reach/i);
    expect(msg).not.toMatch(/password/i);
  });

  it("fel utan status (inget svar hanns fås) behandlas som oåtkomlig tjänst", () => {
    const msg = signInErrorMessage({ name: "AuthError", message: "Load failed" });
    expect(msg).toMatch(/couldn't reach/i);
  });

  it("5xx hos Supabase är tjänstefel, inte användarfel", () => {
    const msg = signInErrorMessage({
      status: 503,
      name: "AuthRetryableFetchError",
      message: "Service unavailable",
    });
    expect(msg).toMatch(/couldn't reach/i);
  });

  it("okänt API-fel faller tillbaka på Supabase-meddelandet — aldrig 'fel lösenord'", () => {
    const msg = signInErrorMessage({
      code: "user_banned",
      status: 403,
      name: "AuthApiError",
      message: "User is banned",
    });
    expect(msg).toBe("User is banned");
  });

  it("okänt fel utan meddelande får ett ärligt generiskt fel", () => {
    const msg = signInErrorMessage({ status: 400, name: "AuthApiError", message: "" });
    expect(msg).toMatch(/something went wrong/i);
  });
});
