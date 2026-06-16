// Sanningskälla för render-canary.families.json (on-disk receipt).
// Delas av skrivaren (harness.server.ts) och läsaren (scripts/breadth-replay.ts)
// så att schema-drift mellan dem blir kompilerings- eller runtime-fel, inte
// tyst false-floor.
//
// Receipten är en CACHE, inte en bevarad fixture: den är en deterministisk
// funktion av (frusen page.mhtml, pinnad chromium, harness-version). MHTML är
// den durabla artefakten; receipten regenereras av replayCorpus() vid varje
// breadth-replay-körning. Schemabumps hanteras genom att höja
// `schemaVersion` och låta replay re-stämpla.
//
// Disciplin för framtida ändringar:
//   - Nya fält adderas som `.optional()` (bakåtkompatibelt med v1-receipts).
//   - Breaking changes höjer schemaVersion → kräver omfrysning/replay.
//   - INGEN `.strict()` på fil-schemat: default-strip ger forward-compat
//     när skrivaren adderar fält som läsare på äldre versioner inte känner till.
import { z } from "zod";

export const Gate1ReasonSchema = z.enum([
  "ok",
  "unresolved",
  "fallback",
  "metric_twin",
  "check_mismatch",
  "descriptor_missing",
  "timeout",
]);

export const Gate2ReasonSchema = z.enum(["ok", "drift", "skipped"]);

export const BranchTakenSchema = z.enum([
  "load-rejected",
  "load-timeout",
  "A2-no-descriptor",
  "coverage-exclusion",
  "distinct+check",
  "distinct+!check",
  "!distinct+check",
  "!distinct+!check",
]);

export const Gate1DiagSchema = z.object({
  branchTaken: BranchTakenSchema,
  loadResultKind: z.enum(["loaded", "rejected", "timeout"]),
  faceCount: z.number(),
  hasDescriptorMatch: z.boolean(),
  epsilonLoadPx: z.number(),
  strings: z.object({
    manifestFamily: z.string(),
    allDescriptorFamilies: z.array(z.string()),
    matchedDescriptorFamilies: z.array(z.string()),
    checkString: z.string(),
    widthString: z.string(),
  }),
  canonMismatch: z.boolean(),
  canonMismatchDetail: z.array(z.string()),
});

export const Gate1ReportSchema = z.object({
  wWith: z.number(),
  wFallback: z.number(),
  deltaLoad: z.number(),
  fontsCheckPass: z.boolean(),
  pass: z.boolean(),
  reason: Gate1ReasonSchema,
  loadError: z.string().optional(),
});

export const Gate2ReportSchema = z.object({
  wOrig: z.number(),
  deltaSubset: z.number(),
  pass: z.boolean(),
  reason: Gate2ReasonSchema,
});

export const FamilyReceiptSchema = z.object({
  family: z.string(),
  gate1: Gate1ReportSchema,
  gate2: Gate2ReportSchema.optional(),
  diag: Gate1DiagSchema,
});

export const RenderCanaryEnvSchema = z.object({
  chromiumPath: z.string(),
  chromiumVersion: z.string(),
  pinned: z.boolean(),
});

export const FamiliesReceiptFileSchema = z.object({
  schemaVersion: z.literal(1),
  env: RenderCanaryEnvSchema.optional(),
  families: z.array(FamilyReceiptSchema),
  /** Familjer som klassificerats som freeze-time-ghosts vid replay:
   *  manifestet (freeze-report.embeddedFamilies) namnger familjen, men MHTML
   *  saknar @font-face-deklaration för den. Bakåtkompatibelt optional för
   *  äldre receipts skrivna före gate-split. */
  ghosts: z.array(z.string()).optional(),
});

export type Gate1Reason = z.infer<typeof Gate1ReasonSchema>;
export type Gate2Reason = z.infer<typeof Gate2ReasonSchema>;
export type BranchTaken = z.infer<typeof BranchTakenSchema>;
export type Gate1Diag = z.infer<typeof Gate1DiagSchema>;
export type Gate1Report = z.infer<typeof Gate1ReportSchema>;
export type Gate2Report = z.infer<typeof Gate2ReportSchema>;
export type FamilyReceipt = z.infer<typeof FamilyReceiptSchema>;
export type RenderCanaryEnv = z.infer<typeof RenderCanaryEnvSchema>;
export type FamiliesReceiptFile = z.infer<typeof FamiliesReceiptFileSchema>;
