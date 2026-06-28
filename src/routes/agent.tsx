// /agent — the SEO & CRO analysis agent (BrowserShell). This is the internal
// crawler/analysis tool. It used to live at "/"; the public landing page now
// occupies "/" and this moved here.

import { createFileRoute } from "@tanstack/react-router";
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
  return <BrowserShell />;
}
