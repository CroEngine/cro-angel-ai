import { isTemplatePattern } from "@/lib/page-template";

/**
 * Sidan en variant förhandsvisas på. Per-sida-varianter: pathen som den är.
 * Mall-varianter: mönstret (/blogg/*) är ingen riktig URL — spegeln blev en
 * tom vit sida (buggfynd 2026-07-27) — så förhandsvisningen öppnar variantens
 * REPRESENTANT-sida ur bevisblocket (samma sida verify:n mätte på), i andra
 * hand första mall-sidan. Utan användbart bevisblock returneras mönstret
 * oförändrat och spegelns vanliga felväg får tala.
 */
export function previewPagePath(path: string, evidence: unknown): string {
  if (!isTemplatePattern(path)) return path;
  const tpl = (evidence as { template?: { repPath?: unknown; pages?: unknown[] } } | null)
    ?.template;
  const rep = typeof tpl?.repPath === "string" ? tpl.repPath : null;
  const first =
    Array.isArray(tpl?.pages) && typeof tpl.pages[0] === "string" ? tpl.pages[0] : null;
  const page = rep ?? first;
  return page && page.startsWith("/") && !isTemplatePattern(page) ? page : path;
}
