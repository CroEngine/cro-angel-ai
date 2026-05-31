import { createFileRoute } from "@tanstack/react-router";
import { BrowserShell } from "@/components/browser-shell/BrowserShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SEO & CRO Agent" },
      { name: "description", content: "Browser session viewer for the SEO & CRO analysis agent." },
    ],
  }),
  component: Index,
});

function Index() {
  return <BrowserShell />;
}
