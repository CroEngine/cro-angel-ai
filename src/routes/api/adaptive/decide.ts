// POST /api/adaptive/decide
//
// The snippet posts the visitor's client signals; we enrich them with
// header-derived server signals and answer with EXACTLY ONE of two things:
// an owner-approved variant (Fas 4-serveringen, bakom ägarens grindar) or an
// observe-only empty response. CORS-open: customers call this from their own
// origin via the snippet.
//
// Legacy-livevägen PENSIONERAD (2026-07-20): den gamla regelmotorn serverade
// synliga mönster-adaptationer direkt ur decide() utan ägargodkännande —
// det bröt mot observe-first ("inga synliga ändringar förrän en testad
// variant finns") och krockade med variant-flödet: bägge låg bakom samma
// adaptations_enabled-flagga, så en godkänd variant kunde inte serveras utan
// att också väcka regelmotorn (sticky-pill-fyndet). Den rena decide()-motorn
// + mönsterkatalogen lever kvar som kvalitetsharness (robustness/preflight/
// day-0) — bara LIVE-vägen är borta. adaptations_enabled betyder numera
// enbart "generativa lagret på" (nattloopens sajturval).

import { createFileRoute } from "@tanstack/react-router";

import {
  buildVisitorContext,
  cohortsForVisitor,
  readServerSignals,
  referrerHost,
} from "@/adaptive/context";
import { decisionIdFor } from "@/adaptive/decide";
import { isBotUserAgent } from "@/adaptive/bot";
import { originVerdict } from "@/adaptive/domain";
import { servingAllowedForBilling } from "@/lib/billing/billing";
import { serveDecision } from "@/adaptive/redesign/serve";
import {
  bumpReferrerDomain,
  isSandboxSlug,
  loadPreviewVariant,
  loadServableVariants,
  loadSiteConfig,
  logDecision,
  sandboxRealSlug,
} from "@/adaptive/persistence.server";
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
        // owner's declared conversion goal (driver decisionIdFor + badge-
        // matchning i harnesserna), and keeps decide at a single
        // angel_sites read per request.
        const cfg = await loadSiteConfig(client.site);
        // Keyed sites must present the matching write key; a wrong/absent key
        // means this isn't the legit install, so we neither decide nor log a
        // (poisonable) exposure. The snippet fails open → page unchanged.
        if (cfg.ingestKey && client.key !== cfg.ingestKey) {
          return json({ error: "unauthorized" }, 403);
        }
        // Domän-registrerade sajter: en Origin som MOTSÄGER domänen är inte
        // den legitima installationen (nyckeln står i publika HTML:en och
        // bevisar inget — webbläsarens Origin gör). Frånvaro tillåts;
        // motbevis nekas. Stämpling av domain_verified_at sker i events-vägen.
        const dv = originVerdict(
          cfg.domain,
          request.headers.get("origin"),
          request.headers.get("referer"),
        );
        if (!dv.allowed) {
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

        // "Other websites"-domänräknaren (ägarbeslut 2026-07-26: samla nu,
        // visa senare — går inte att backfilla). BARA när klassificeraren
        // landade i "other" (kända kanaler behöver ingen domän), bara samtyckta
        // besök (visitorHash finns — samma hållning som events-vägen), aldrig
        // sandbox-speglar. Bara domänen; fire-safe i persistence-hjälparen.
        if (
          context.trafficSource === "other" &&
          typeof client.visitorHash === "string" &&
          client.visitorHash &&
          !isSandboxSlug(client.site)
        ) {
          const dom = referrerHost(client.referrer || server.referrer, client.url);
          if (dom) await bumpReferrerDomain(client.site, dom);
        }

        // Ägarens deklarerade mål — driver emphasize_goal, badge-matchning och
        // (via decisionIdFor) den stabila besöks-hashen.
        const goal = {
          selector: cfg.conversionSelector,
          url: cfg.conversionUrl,
          text: cfg.conversionText,
          kind: cfg.conversionKind,
        };

        // Sandbox-spegelns "se live": ägaren tittar på EN specifik variant i
        // spegeln innan hen godkänner den — snippetens riktiga apply-väg, inga
        // skärmdumpar. BARA för sandbox-slugs (event-loggen är avstängd där,
        // så en förhandsvisning kan aldrig bli en exponering) och bara när
        // variantens sajt äger den speglade domänen (loadPreviewVariant).
        // Ingen logDecision: en titt är inte en mätpunkt. Okänd/otillåten
        // variant → falla vidare till de vanliga vägarna.
        if (typeof client.forceVariant === "string" && isSandboxSlug(client.site)) {
          const mirrorHost = sandboxRealSlug(client.site);
          const pv = mirrorHost ? await loadPreviewVariant(client.forceVariant, mirrorHost) : null;
          if (pv) {
            return json({
              decisionId: decisionIdFor(client.site, context, goal),
              site: client.site,
              adaptations: [],
              holdout: false,
              variant: { id: pv.id, segmentKey: pv.segmentKey, ops: pv.serveOps },
              context,
            });
          }
        }

        // Sidan besökaren står på (per-page variantnycklar).
        let path = "/";
        try {
          path = new URL(client.url).pathname || "/";
        } catch {
          /* keep homepage default */
        }

        // ── Fas 4 steg 3: per-segment variant-servering ─────────────────────
        // Det ENDA synliga Angel kan göra live, bakom ägarens uttryckliga
        // grindar (serving_enabled är masterswitchen i dashboarden, varje
        // variant är dessutom individuellt godkänd av ägaren).
        // serveDecision (ren, testad) gör hela armvalet: finaste matchande
        // serving/winner-variant, deterministisk ramp-bucket (start 5 %).
        // Variant-armen får variantens verifierade serve-ops; kontrollarmen
        // ser sidan SOM DEN ÄR (inte mönstermotorns ops — armarna måste skilja
        // sig i exakt EN sak: varianten). Båda armarna loggas med
        // "variant:<id>" så vinnar-utvärderaren kan räkna dem.
        // Domän-registrerad sajt utan verifieringsstämpel serverar ALDRIG
        // varianter: nyckeln bevisar inte kontroll, det gör bara trafik från
        // rätt domän. Legacy/labb (ingen domän) påverkas inte. Betalningen
        // gate:ar på samma ställe: pausad prenumeration ⇒ besökarna ser
        // originalsidan; observationen fortsätter (datan bevaras).
        const domainOkForServing = !cfg.domain || cfg.domainVerifiedAt !== null;
        if (cfg.servingEnabled && domainOkForServing && servingAllowedForBilling(cfg.billingStatus)) {
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
              // Härledda kohortnycklar (ch:/src:/ret:/seen:) — grindar
              // kohortscopade varianter; besökare utan kraven faller till
              // grövre varianter eller observe-only. Serverberäknat.
              cohorts: cohortsForVisitor(context),
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

        // Observe-only (croengine-vision.md): ingen servbar variant för den
        // här besökaren ⇒ Angel är osynligt. Ingen exponering loggas — bara
        // den anonyma resan/strukturen/prestandan flödar via /api/adaptive/
        // events. decisionId hålls deterministiskt så journey-events grupperas
        // stabilt per besökare + kontext.
        return json({
          decisionId: decisionIdFor(client.site, context, goal),
          site: client.site,
          adaptations: [],
          holdout: false,
          context,
        });
      },
    },
  },
});
