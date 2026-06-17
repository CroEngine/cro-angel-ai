// Server-side bundle av corpus-artefakter.
// Cloudflare Worker SSR har inte tillgång till repo-FS, så vi bundlar
// corpus-JSON via Vite glob. Binärer (page.mhtml, screenshot.jpg) ligger
// istället under public/corpus/<site>/ och serveras som static assets.
//
// Eager: små filer som behövs för listningen (meta + freeze-report).
// Lazy:  stora filer som bara behövs när viewern expanderar (golden + families).

const metaModules = import.meta.glob("../../corpus/*/meta.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const freezeReportModules = import.meta.glob("../../corpus/*/freeze-report.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const goldenLoaders = import.meta.glob("../../corpus/*/golden.json", {
  import: "default",
}) as Record<string, () => Promise<unknown>>;

const familiesLoaders = import.meta.glob("../../corpus/*/render-canary.families.json", {
  import: "default",
}) as Record<string, () => Promise<unknown>>;

function siteFromPath(path: string): string | null {
  const m = path.match(/\/corpus\/([^/]+)\/[^/]+\.json$/);
  return m ? m[1] : null;
}

function buildIndex<T>(map: Record<string, T>): Map<string, T> {
  const out = new Map<string, T>();
  for (const [path, value] of Object.entries(map)) {
    const name = siteFromPath(path);
    if (name) out.set(name, value);
  }
  return out;
}

const metaByName = buildIndex(metaModules);
const freezeReportByName = buildIndex(freezeReportModules);
const goldenLoaderByName = buildIndex(goldenLoaders);
const familiesLoaderByName = buildIndex(familiesLoaders);

export function listSiteNames(): string[] {
  return Array.from(metaByName.keys()).sort();
}

export function getMeta(name: string): unknown | null {
  return metaByName.get(name) ?? null;
}

export function getFreezeReport(name: string): unknown | null {
  return freezeReportByName.get(name) ?? null;
}

export function hasGolden(name: string): boolean {
  return goldenLoaderByName.has(name);
}

export function hasFamilies(name: string): boolean {
  return familiesLoaderByName.has(name);
}

export async function loadGolden(name: string): Promise<unknown | null> {
  const loader = goldenLoaderByName.get(name);
  return loader ? await loader() : null;
}

export async function loadFamilies(name: string): Promise<unknown | null> {
  const loader = familiesLoaderByName.get(name);
  return loader ? await loader() : null;
}

// Storlek från strängifierat JSON (approx, men deterministiskt).
export function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}
