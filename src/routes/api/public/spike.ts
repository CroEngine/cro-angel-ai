import { createFileRoute } from "@tanstack/react-router";
import { spikePlaywright, spikeStagehand } from "@/lib/tests/spike.functions";

export const Route = createFileRoute("/api/public/spike")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const which = url.searchParams.get("which") ?? "both";
        const out: Record<string, unknown> = {};
        if (which === "pw" || which === "both") {
          out.playwright = await spikePlaywright();
        }
        if (which === "sh" || which === "both") {
          out.stagehand = await spikeStagehand();
        }
        return Response.json(out);
      },
    },
  },
});
