// Delad app-navigation för inloggade ytor (design-handoffen 2026-07-16):
// sticky vit header, ✳ Angel-ordmärke, flikar (aktiv = emerald på #f0fdf7-
// pill), högerställd plats för sidans kontroller (sajtväljare etc) + Sign out.
// Kund-konton ser bara Dashboard; Sandbox/Corpus/Agent är admin-ytor.

import { Link, useNavigate } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

const TABS = [
  { to: "/dashboard", label: "Dashboard", admin: false },
  { to: "/sandbox", label: "Sandbox", admin: true },
  { to: "/corpus", label: "Corpus", admin: true },
  { to: "/agent", label: "Agent", admin: true },
] as const;

export function AppNav({
  active,
  isAdmin = false,
  children,
}: {
  active: "/dashboard" | "/sandbox" | "/corpus" | "/agent";
  isAdmin?: boolean;
  /** Högerställda sidkontroller (sajtväljare, inställningar …). */
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }
  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-5 px-6 py-3">
        <Link
          to="/dashboard"
          className="flex items-center gap-2 text-[16px] font-bold text-stone-900"
        >
          <span className="text-[18px] leading-none text-emerald-700">✳</span> Angel
        </Link>
        <nav className="flex items-center gap-0.5">
          {TABS.filter((t) => !t.admin || isAdmin).map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="rounded-[8px] px-[13px] py-[7px] text-[13.5px] font-semibold"
              style={
                active === t.to ? { background: "#f0fdf7", color: "#047857" } : { color: "#57534e" }
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          <button
            type="button"
            onClick={signOut}
            className="flex h-[34px] items-center rounded-[9px] border border-stone-200 px-[13px] text-[13px] text-stone-600 hover:bg-[#f7f6f4]"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
