// /agent — the SEO & CRO analysis agent (BrowserShell). This is the internal
// crawler/analysis tool. It used to live at "/"; the public landing page now
// occupies "/" and this moved here.

import { createFileRoute } from "@tanstack/react-router";

import { AppNav } from "@/components/app-nav";
import { BrowserShell } from "@/components/browser-shell/BrowserShell";

export const Route = createFileRoute("/agent")({
  head: () => ({
    meta: [
      { title: "SEO & CRO Agent" },
      { name: "description", content: "Browser session viewer for the SEO & CRO analysis agent." },
    ],
  }),
  component: Agent,
});

function Agent() {
  // Naven ovanpå, shellen fyller resten av höjden (prototypen: calc(100vh - nav)).
  return (
    <div className="flex h-screen flex-col">
      <AppNav active="/agent" isAdmin />
      <div className="min-h-0 flex-1">
        <BrowserShell />
      </div>
    </div>
  );
}
