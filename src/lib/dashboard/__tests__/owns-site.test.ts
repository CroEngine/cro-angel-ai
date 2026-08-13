// Isolationsprimitiven (buggjakt 2026-08-13): ownsSite är grinden som VARJE
// tenant-skopad server-fn (setVariantStatus, setServing*, confirmGoal,
// rotateIngestKey, createVariantPreview, ...) frågar innan den rör en kunds
// data med service-roll-klienten. Håller den inte isär medlemmar från icke-
// medlemmar läcker/skrivs en kunds data av en annan. Sömmen var otestad —
// detta pinnar kontraktet: medlem ⇒ ja, icke-medlem ⇒ nej, admin ⇒ ja utan
// att ens fråga DB:n.
import { afterEach, describe, expect, it } from "vitest";

import { ownsSite, type AuthCtx } from "../dashboard.functions";

// En minimal admin-klient-stub som spelar upp angel_site_members-uppslaget.
// Kedjan är .from(t).select(c).eq(k,v).eq(k,v).maybeSingle().
function memberLookup(rowForUserSlug: (userId: string, slug: string) => boolean) {
  const calls: { table: string; filters: Record<string, string> }[] = [];
  const admin = {
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: string) {
          filters[col] = val;
          return builder;
        },
        async maybeSingle() {
          calls.push({ table, filters });
          const hit = rowForUserSlug(filters.user_id, filters.site_slug);
          return { data: hit ? { id: "m1" } : null, error: null };
        },
      };
      return builder;
    },
  };
  return { admin, calls };
}

const ctx = (userId: string, email?: string): AuthCtx => ({
  userId,
  claims: email ? { email } : {},
});

const priorAdmins = process.env.ANGEL_ADMIN_EMAILS;
afterEach(() => {
  if (priorAdmins === undefined) delete process.env.ANGEL_ADMIN_EMAILS;
  else process.env.ANGEL_ADMIN_EMAILS = priorAdmins;
});

describe("ownsSite — tenant-isolationsprimitiven", () => {
  it("medlem i sajten ⇒ true", async () => {
    const { admin } = memberLookup((u, s) => u === "user-A" && s === "kund-a");
    expect(await ownsSite(admin as never, ctx("user-A"), "kund-a")).toBe(true);
  });

  it("ICKE-medlem ⇒ false (en annan kunds sajt nekas)", async () => {
    // user-B är medlem i sin egen sajt men frågar efter kund-a.
    const { admin, calls } = memberLookup((u, s) => u === "user-B" && s === "kund-b");
    expect(await ownsSite(admin as never, ctx("user-B"), "kund-a")).toBe(false);
    // ...och uppslaget skoppades verkligen på (user_id, site_slug) — inte en
    // bredare fråga som kunde matcha fel rad.
    expect(calls[0]).toEqual({
      table: "angel_site_members",
      filters: { user_id: "user-B", site_slug: "kund-a" },
    });
  });

  it("admin-e-post ⇒ true UTAN att ens fråga DB:n", async () => {
    process.env.ANGEL_ADMIN_EMAILS = "ops@croengine.com";
    const { admin, calls } = memberLookup(() => false);
    expect(await ownsSite(admin as never, ctx("user-Z", "ops@croengine.com"), "vilken-sajt")).toBe(
      true,
    );
    expect(calls).toHaveLength(0); // kortslöts på admin, ingen medlemsfråga
  });

  it("admin-listan är skiftlägesokänslig men annars exakt (ingen delsträngsmatch)", async () => {
    process.env.ANGEL_ADMIN_EMAILS = "ops@croengine.com";
    const { admin } = memberLookup(() => false);
    // Rätt e-post, annat skiftläge ⇒ admin.
    expect(await ownsSite(admin as never, ctx("u", "OPS@CroEngine.com"), "s")).toBe(true);
    // En e-post som BARA innehåller admin-adressen som delsträng ⇒ INTE admin.
    expect(await ownsSite(admin as never, ctx("u", "ops@croengine.com.evil.com"), "s")).toBe(false);
  });
});
