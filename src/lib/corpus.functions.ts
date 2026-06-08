// Read-only inspector data for frozen corpus sites under ./corpus/<name>/.
// Returns, per site, which artefact files exist plus parsed sammanfattningar
// från meta.json, freeze-report.json och golden.json så UI:t kan visa
// snabbsiffror utan att ladda hela goldens.

import { createServerFn } from "@tanstack/react-start";
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CORPUS_ROOT = "corpus";

export const ARTIFACT_FILES = [
  "golden.json",
  "meta.json",
  "freeze-report.json",
  "page.mhtml",
  "screenshot.jpg",
] as const;

export type ArtifactFile = (typeof ARTIFACT_FILES)[number];

export interface CorpusSite {
  name: string;
  files: Record<ArtifactFile, { exists: boolean; sizeBytes: number | null }>;
  meta: any | null;
  freezeReport: any | null;
  goldenSummary: {
    elementCount: number | null;
    primaryCtaAboveFold: number | null;
    competingAboveFold: number | null;
    h1: string[];
    heroHeadline: string | null;
    heroCtaText: string | null;
    heroCtaIntent: string | null;
    title: string | null;
    sectionOrder: string[] | null;
  } | null;
}

function safeReadJson(path: string): any | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function fileStat(path: string): { exists: boolean; sizeBytes: number | null } {
  try {
    const s = statSync(path);
    return { exists: true, sizeBytes: s.size };
  } catch {
    return { exists: false, sizeBytes: null };
  }
}

function summarizeGolden(golden: any) {
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
    if (!existsSync(CORPUS_ROOT)) return { sites: [], root: CORPUS_ROOT };

    const names = readdirSync(CORPUS_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const sites: CorpusSite[] = names.map((name) => {
      const dir = join(CORPUS_ROOT, name);
      const files = Object.fromEntries(
        ARTIFACT_FILES.map((f) => [f, fileStat(join(dir, f))]),
      ) as CorpusSite["files"];

      const meta = safeReadJson(join(dir, "meta.json"));
      const freezeReport = safeReadJson(join(dir, "freeze-report.json"));
      const golden = safeReadJson(join(dir, "golden.json"));

      return {
        name,
        files,
        meta,
        freezeReport,
        goldenSummary: summarizeGolden(golden),
      };
    });

    return { sites, root: CORPUS_ROOT };
  },
);
