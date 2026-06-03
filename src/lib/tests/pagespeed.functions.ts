import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Google PageSpeed Insights v5
// Docs: https://developers.google.com/speed/docs/insights/v5/get-started

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
const STRATEGIES = ["mobile", "desktop"] as const;

type Strategy = (typeof STRATEGIES)[number];

export type CategoryScores = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
};

export type CoreWebVitals = {
  // Lab (Lighthouse) metrics — always present when run succeeds
  lcpMs: number | null;
  fcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  speedIndexMs: number | null;
  ttiMs: number | null;
  // Field (CrUX) data — present when URL has enough real-user traffic
  fieldLcpMs: number | null;
  fieldFcpMs: number | null;
  fieldClsP75: number | null;
  fieldInpMs: number | null;
  hasFieldData: boolean;
};

export type PsiStrategyResult = {
  strategy: Strategy;
  fetchedAt: string;
  scores: CategoryScores;
  vitals: CoreWebVitals;
  audits: {
    // Top opportunities sorted by potential savings (ms)
    opportunities: Array<{ id: string; title: string; savingsMs: number; displayValue: string | null }>;
    // Failed diagnostics worth surfacing
    diagnostics: Array<{ id: string; title: string; displayValue: string | null; score: number | null }>;
  };
  error: string | null;
};

export type PsiResult = {
  url: string;
  mobile: PsiStrategyResult | null;
  desktop: PsiStrategyResult | null;
  error: string | null;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function scoreToPct(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
}

type LighthouseAudit = {
  id?: string;
  title?: string;
  displayValue?: string;
  score?: number | null;
  numericValue?: number;
  details?: { overallSavingsMs?: number };
};

function parsePsi(json: unknown, strategy: Strategy): PsiStrategyResult {
  const lhr = (json as { lighthouseResult?: Record<string, unknown> })?.lighthouseResult ?? {};
  const cats = (lhr.categories as Record<string, { score?: number }> | undefined) ?? {};
  const audits = (lhr.audits as Record<string, LighthouseAudit> | undefined) ?? {};
  const loadingExp = (json as { loadingExperience?: { metrics?: Record<string, { percentile?: number }> } })
    ?.loadingExperience;
  const field = loadingExp?.metrics ?? {};

  const opportunities: PsiStrategyResult["audits"]["opportunities"] = [];
  const diagnostics: PsiStrategyResult["audits"]["diagnostics"] = [];

  for (const [id, a] of Object.entries(audits)) {
    const savings = a?.details?.overallSavingsMs;
    if (typeof savings === "number" && savings > 50) {
      opportunities.push({
        id,
        title: a.title ?? id,
        savingsMs: Math.round(savings),
        displayValue: a.displayValue ?? null,
      });
    } else if (typeof a?.score === "number" && a.score < 0.9 && a.score >= 0 && a.displayValue) {
      diagnostics.push({
        id,
        title: a.title ?? id,
        displayValue: a.displayValue ?? null,
        score: a.score,
      });
    }
  }
  opportunities.sort((a, b) => b.savingsMs - a.savingsMs);

  return {
    strategy,
    fetchedAt: new Date().toISOString(),
    scores: {
      performance: scoreToPct(cats.performance?.score),
      accessibility: scoreToPct(cats.accessibility?.score),
      bestPractices: scoreToPct(cats["best-practices"]?.score),
      seo: scoreToPct(cats.seo?.score),
    },
    vitals: {
      lcpMs: num(audits["largest-contentful-paint"]?.numericValue),
      fcpMs: num(audits["first-contentful-paint"]?.numericValue),
      tbtMs: num(audits["total-blocking-time"]?.numericValue),
      cls: num(audits["cumulative-layout-shift"]?.numericValue),
      speedIndexMs: num(audits["speed-index"]?.numericValue),
      ttiMs: num(audits["interactive"]?.numericValue),
      fieldLcpMs: num(field.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
      fieldFcpMs: num(field.FIRST_CONTENTFUL_PAINT_MS?.percentile),
      fieldClsP75: (() => {
        const n = num(field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);
        return n === null ? null : n / 100; // CrUX returns CLS * 100
      })(),
      fieldInpMs: num(field.INTERACTION_TO_NEXT_PAINT?.percentile),
      hasFieldData: Object.keys(field).length > 0,
    },
    audits: {
      opportunities: opportunities.slice(0, 10),
      diagnostics: diagnostics.slice(0, 10),
    },
    error: null,
  };
}

const FETCH_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 2_000;
const RETRYABLE_LIGHTHOUSE_ERRORS = [
  "FAILED_DOCUMENT_REQUEST",
  "ERRORED_DOCUMENT_REQUEST",
  "NO_FCP",
  "INSECURE_DOCUMENT_REQUEST",
];

function isRetryableError(error: string): boolean {
  if (error.includes("AbortError") || error.includes("aborted")) return true;
  return RETRYABLE_LIGHTHOUSE_ERRORS.some((e) => error.includes(e));
}

function emptyStrategyResult(strategy: Strategy, error: string): PsiStrategyResult {
  return {
    strategy,
    fetchedAt: new Date().toISOString(),
    scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
    vitals: {
      lcpMs: null, fcpMs: null, tbtMs: null, cls: null, speedIndexMs: null, ttiMs: null,
      fieldLcpMs: null, fieldFcpMs: null, fieldClsP75: null, fieldInpMs: null, hasFieldData: false,
    },
    audits: { opportunities: [], diagnostics: [] },
    error,
  };
}

async function fetchStrategyOnce(
  url: string,
  strategy: Strategy,
  apiKey: string,
): Promise<PsiStrategyResult> {
  const params = new URLSearchParams({ url, strategy, key: apiKey });
  for (const c of CATEGORIES) params.append("category", c);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return emptyStrategyResult(strategy, `PSI ${strategy} ${res.status}: ${body.slice(0, 300)}`);
    }
    return parsePsi(await res.json(), strategy);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return emptyStrategyResult(strategy, msg);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStrategy(
  url: string,
  strategy: Strategy,
  apiKey: string,
): Promise<PsiStrategyResult> {
  const first = await fetchStrategyOnce(url, strategy, apiKey);
  if (!first.error || !isRetryableError(first.error)) return first;
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  const second = await fetchStrategyOnce(url, strategy, apiKey);
  if (second.error) return { ...second, error: `[retried] ${second.error}` };
  return second;
}

export const runPageSpeedInsights = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }): Promise<PsiResult> => {
    const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;
    if (!apiKey) {
      return {
        url: data.url,
        mobile: null,
        desktop: null,
        error: "GOOGLE_PAGESPEED_API_KEY is not configured",
      };
    }

    // Sequential to stay under proxy timeout and avoid doubling PSI load
    const mobile = await fetchStrategy(data.url, "mobile", apiKey);
    const desktop = await fetchStrategy(data.url, "desktop", apiKey);

    return {
      url: data.url,
      mobile,
      desktop,
      error: mobile.error && desktop.error ? `Both strategies failed: ${mobile.error}` : null,
    };
  });
