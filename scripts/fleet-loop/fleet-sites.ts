// Fleet-listan för 200-sajtsmålet (ägarbeslut 2026-07-27: "testa typ 200
// hemsidor"): day0-flottan FÖRST (stabila index — offset-körningar och
// jämförelser mot tidigare fördelningar förblir giltiga), därefter den breda
// korpusens domäner (e-handel/media/dev/fintech/konsument) dedupade på
// hostname. Ren data utan sidoeffekter.

import { SITES } from "../day0-sites";
import { CORPUS_DOMAINS } from "../capture-eval/corpus-domains";

const seenHosts = new Set(
  SITES.map((s) => new URL(s.url).hostname.replace(/^www\./, "")),
);

const extra: Array<{ name: string; url: string }> = [];
for (const d of [...new Set(CORPUS_DOMAINS)]) {
  const host = d.replace(/^www\./, "");
  if (seenHosts.has(host)) continue;
  seenHosts.add(host);
  extra.push({
    name: host.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/gi, "-"),
    url: `https://${d}/`,
  });
}

export const FLEET_SITES: Array<{ name: string; url: string }> = [...SITES, ...extra];
