// Read-only inspector data för frysta corpus-sajter.
// Läser från build-time bundle (corpus-bundle.ts) istället för disk-FS,
// eftersom Cloudflare Worker-runtimen inte har repo-filerna.

import { createServerFn } from "@tanstack/react-start";

import {
  getFreezeReport,
  getMeta,
  hasFamilies,
  hasGolden,
  jsonByteSize,
  listSiteNames,
  loadGolden,
} from "./corpus-bundle";

export const ARTIFACT_FILES = [
  "golden.json",
  "meta.json",
  "freeze-report.json",
  "page.mhtml",
  "page.mhtml.asset.json",
  "screenshot.jpg",
] as const;

export type ArtifactFile = (typeof ARTIFACT_FILES)[number];

export interface CorpusSite {
  name: string;
  files: Record<ArtifactFile, { exists: boolean; sizeBytes: number | null }>;
  meta: any | null;
  freezeReport: any | null;
  // Snabbsiffrorna lazy-laddas via getGoldenSummary i UI:t.
  goldenSummary: null;
}

export interface GoldenSummary {
  elementCount: number | null;
  primaryCtaAboveFold: number | null;
  competingAboveFold: number | null;
  h1: string[];
  heroHeadline: string | null;
  heroCtaText: string | null;
  heroCtaIntent: string | null;
  title: string | null;
  sectionOrder: string[] | null;
}

function summarizeGolden(golden: any): GoldenSummary | null {
  if (!golden || typeof golden !== "object") return null;
  const collect = golden.collect ?? {};
  const audit = golden.pageAudit ?? {};
  return {
    elementCount: typeof collect.count === "number" ? collect.count : null,
    primaryCtaAboveFold: collect.summary?.primaryConversionCtaCount ?? null,
    competingAboveFold: collect.summary?.competingAboveFold ?? null,
    h1: Array.isArray(audit.headings?.h1) ? audit.headings.h1 : [],
    heroHeadline: audit.hero?.headline ?? null,
    heroCtaText: audit.hero?.primaryCtaText ?? null,
    heroCtaIntent: audit.hero?.primaryCtaIntent ?? null,
    title: audit.head?.title ?? null,
    sectionOrder: Array.isArray(audit.sectionOrder) ? audit.sectionOrder : null,
  };
}

export const listCorpus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ sites: CorpusSite[]; root: string }> => {
    const names = listSiteNames();

    const sites: CorpusSite[] = names.map((name) => {
      const meta = getMeta(name);
      const freezeReport = getFreezeReport(name);

      const files: CorpusSite["files"] = {
        "golden.json": {
          exists: hasGolden(name),
          // Storlek okänd utan att exekvera lazy-loadern — visa null.
          sizeBytes: null,
        },
        "meta.json": { exists: meta != null, sizeBytes: meta ? jsonByteSize(meta) : null },
        "freeze-report.json": {
          exists: freezeReport != null,
          sizeBytes: freezeReport ? jsonByteSize(freezeReport) : null,
        },
        // Binärerna ligger i public/corpus/<name>/ — antas finnas om
        // sajten har en meta.json. Storlek serveras inte (no-op).
        "page.mhtml": { exists: meta != null, sizeBytes: null },
        "page.mhtml.asset.json": { exists: false, sizeBytes: null },
        "screenshot.jpg": { exists: meta != null, sizeBytes: null },
      };

      return {
        name,
        files,
        meta,
        freezeReport,
        goldenSummary: null,
      };
    });

    return { sites, root: "corpus" };
  },
);

export const getGoldenSummary = createServerFn({ method: "GET" })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<GoldenSummary | null> => {
    const golden = await loadGolden(data.name);
    return summarizeGolden(golden);
  });
