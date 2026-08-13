// Delade hjälpare för skärmdumpsläsande fleet-verktyg (galleri + sandlåda).
// Par-upptäckten bor på ETT ställe (granskningsfynd 2026-08-12: en dubblerad
// slug-härledning driftade en gång och gjorde galleriet tyst tomt — samma
// öde väntade två kopior av par-regeln).

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Första kompletta *-before.jpg/*-after.jpg-paret i sajtens katalog. */
export function pairFor(root: string, name: string): { before: string; after: string } | null {
  let files: string[] = [];
  try {
    files = readdirSync(join(root, name));
  } catch {
    return null;
  }
  for (const bf of files.filter((f) => f.endsWith("-before.jpg")).sort()) {
    const af = bf.replace(/-before\.jpg$/, "-after.jpg");
    if (files.includes(af)) return { before: join(root, name, bf), after: join(root, name, af) };
  }
  return null;
}

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
