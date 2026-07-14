// POST /api/adaptive/decide
//
// The snippet posts the visitor's client signals; we enrich them with
// header-derived server signals, load the site's content inventory, run the
// decision engine, log the decision (best-effort), and return the adaptations
// for the browser to apply. CORS-open: customers call this from their own
// origin via the snippet.

import { createFileRoute } from "@tanstack/react-router";

import { buildVisitorContext, readServerSignals } from "@/adaptive/context";
import { decide, decisionIdFor } from "@/adaptive/decide";
import { resolveInventory } from "@/adaptive/inventory.server";
import { loadPatternBoosts } from "@/adaptive/performance.server";
import { isBotUserAgent } from "@/adaptive/bot";
import { fnv1a32 } from "@/adaptive/hash";
import { serveDecision } from "@/adaptive/redesign/serve";
import { loadSiteConfig, loadServableVariants, logDecision } from "@/adaptive/persistence.server";
import type { ClientSignals } from "@/adaptive/types";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });

export const Route = createFileRoute("/api/adaptive/decide")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        let client: ClientSignals;
        try {
          client = (await request.json()) as ClientSignals;
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        if (!client?.site || !client?.url) {
          return json({ error: "missing required fields: site, url" }, 400);
        }

        // One site-config read serves three needs: the write-key check, the
        // owner's declared conversion goal (drives emphasize_goal), and keeps
        // decide at a single angel_sites read per request.
        const cfg = await loadSiteConfig(client.site);
        // Keyed sites must present the matching write key; a wrong/absent key
        // means this isn't the legit install, so we neither decide nor log a
        // (poisonable) exposure. The snippet fails open → page unchanged.
        if (cfg.ingestKey && client.key !== cfg.ingestKey) {
          return json({ error: "unauthorized" }, 403);
        }

        const server = readServerSignals(request);
        const context = buildVisitorContext(server, client);

        // Bot-exkludering (auktoritativ): en bot får aldrig en adaptation och
        // loggar aldrig en exponering — annars förorenas armarna och segmenten.
        // Tomt svar med deterministiskt decisionId, precis som observe-läget.
        if (isBotUserAgent(server.userAgent)) {
          return json({
            decisionId: decisionIdFor(client.site, context, {
              selector: cfg.conversionSelector,
              url: cfg.conversionUrl,
              text: cfg.conversionText,
              kind: cfg.conversionKind,
            }),
            site: client.site,
            adaptations: [],
            holdout: false,
            context,
          });
        }

        // Ägarens deklarerade mål — driver emphasize_goal, badge-matchning och
        // (via decisionIdFor) den stabila besöks-hashen.
        const goal = {
          selector: cfg.conversionSelector,
          url: cfg.conversionUrl,
          text: cfg.conversionText,
          kind: cfg.conversionKind,
        };

        // Observe-first (croengine-vision.md): Angel är OSYNLIGT som standard
        // (adaptations_enabled=false). Då kör vi ingen decide-pipeline och
        // loggar INGEN exponering — bara den anonyma resan/strukturen/
        // prestandan flödar vidare via /api/adaptive/events. decisionId hålls
        // deterministiskt så journey-events grupperas stabilt per besökare +
        // kontext; apply-listan är tom, så snippeten ändrar ingenting synligt.
        // All nivå 1-2-3-logik nedan bevaras bakom flaggan — substrat för den
        // generativa fasen.
        if (!cfg.adaptationsEnabled) {
          return json({
            decisionId: decisionIdFor(client.site, context, goal),
            site: client.site,
            adaptations: [],
            holdout: false,
            context,
          });
        }

        // Resolve inventory for the specific page being adapted (per-page).
        let path = "/";
        try {
          path = new URL(client.url).pathname || "/";
        } catch {
          /* keep homepage default */
        }

        // ── Fas 4 steg 3: per-segment variant-servering ─────────────────────
        // Bakom TVÅ uttryckliga grindar (adaptations_enabled passerades ovan,
        // serving_enabled är masterswitchen ägaren slår på i dashboarden).
        // serveDecision (ren, testad) gör hela armvalet: finaste matchande
        // serving/winner-variant, deterministisk ramp-bucket (start 5 %).
        // Variant-armen får variantens verifierade serve-ops; kontrollarmen
        // ser sidan SOM DEN ÄR (inte mönstermotorns ops — armarna måste skilja
        // sig i exakt EN sak: varianten). Båda armarna loggas med
        // "variant:<id>" så vinnar-utvärderaren kan räkna dem.
        if (cfg.servingEnabled) {
          const vhServe = typeof client.visitorHash === "string" ? client.visitorHash : "";
          const verdict = serveDecision(
            { servingEnabled: cfg.servingEnabled, rampPct: cfg.rampPct },
            await loadServableVariants(client.site, path),
            {
              site: client.site,
              path,
              segment: {
                channel: context.trafficSource,
                device: context.device,
                country: context.country,
                isReturning: context.isReturning,
              },
            },
            vhServe,
          );
          if (verdict) {
            const decisionId = decisionIdFor(client.site, context, goal);
            const inVariantArm = verdict.arm === "variant";
            const serveOps = verdict.variant.serveOps ?? [];
            await logDecision(client.site, decisionId, context, [`variant:${verdict.variant.id}`], {
              referrer: client.referrer || server.referrer,
              userAgent: server.userAgent,
              visitorHash: vhServe,
              withheld: !inVariantArm,
              consent: typeof client.consent === "string" ? client.consent : null,
              changes: serveOps.map((o) => ({
                pattern: `variant:${verdict.variant.id}`,
                op: o.op,
                target: o.locator.tag ?? "",
                anchorText: o.locator.text,
                value: o.value,
                reason: o.why ?? `variant ${verdict.variant.segmentKey}`,
              })),
            });
            return json({
              decisionId,
              site: client.site,
              adaptations: [],
              holdout: !inVariantArm,
              // Snippeten applicerar variantens ops med harness-semantiken
              // (ett stegs lyft per move_up) — alla reversibla, allt-eller-inget.
              variant: inVariantArm
                ? { id: verdict.variant.id, segmentKey: verdict.variant.segmentKey, ops: serveOps }
                : null,
              context,
            });
          }
        }

        const inventory = await resolveInventory(client.site, path);
        // Feed measured lift back in (increment 2): prefer proven winners,
        // suppress proven losers — per SEGMENT where the segment has its own
        // adequately-powered verdict (D4). Best-effort + cached; {} = defaults.
        const boosts = await loadPatternBoosts(client.site, context.trafficSource);
        const decision = decide(
          client.site,
          context,
          inventory,
          boosts,
          goal,
          // v1: nivå 3 (layout) är av tills sajten uttryckligen aktiverat den
          // (pre-flight + ägargodkännande föregår opt-in:en).
          { allowLayoutPatterns: cfg.layoutPatternsEnabled },
        );

        // Measurement holdout: deterministically bucket this visitor 0..99 from
        // its id; below holdoutPct → control (snippet withholds the adaptations
        // so their lift can be measured). Off (0) unless the site opts in.
        // Prioritet: (1) EXPLICIT tag-override (data-holdout, holdoutOverride
        // markerar den — inkl. "0" som per-install-avstängning, dokumenterat
        // kontrakt), (2) dashboard-värdet, (3) klientens default. Utan
        // markören kunde en config-timeout i snippetet skicka 0 och bucketa
        // om besökare mitt i mätningen — dashboard-värdet är auktoritativt
        // för alla installationer som inte uttryckligen överridit.
        const clientPct =
          typeof client.holdoutPct === "number"
            ? Math.max(0, Math.min(100, client.holdoutPct))
            : null;
        const holdoutPct =
          client.holdoutOverride === true && clientPct !== null
            ? clientPct
            : cfg.holdoutPct > 0
              ? cfg.holdoutPct
              : (clientPct ?? 0);
        const vh = typeof client.visitorHash === "string" ? client.visitorHash : "";
        let holdout = false;
        if (holdoutPct > 0 && vh) {
          // Osaltad hash — rampBucket saltar med variant-id just för att
          // vara okorrelerad med denna hink (se serve.ts).
          holdout = fnv1a32(vh) % 100 < holdoutPct;
        }
        decision.holdout = holdout;

        // Best-effort log; never blocks or fails the decision.
        await logDecision(
          decision.site,
          decision.decisionId,
          context,
          decision.adaptations.map((a) => a.pattern),
          {
            referrer: client.referrer || server.referrer,
            userAgent: server.userAgent,
            visitorHash: vh || null,
            withheld: holdout,
            consent: typeof client.consent === "string" ? client.consent : null,
            // The concrete changes, so the dashboard can show exactly what this
            // visitor saw (or what the control arm was denied).
            changes: decision.adaptations.map((a) => ({
              pattern: a.pattern,
              op: a.op,
              target: a.target,
              anchorText: a.anchorText,
              value: a.value,
              reason: a.reason,
            })),
          },
        );

        return json(decision);
      },
    },
  },
});
