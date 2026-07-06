// Per-archetype goal-kind regression (target architecture in
// docs/contradictions-audit.md): the whole pipeline — frozen capture →
// collect+pageAudit replay → mapAuditToInventory → rankGoalCandidates — is
// exercised on a real site of EACH conversion goal kind, not just SaaS
// signup. If a rule change re-types a webshop's "Köp" as signup, or a
// nonprofit's "Ge en gåva" as start_flow, this fails.
//
// It asserts the deterministic no-LLM floor (rankGoalCandidates): the goal
// judge refines and ranks on top, but the floor is what ships when no
// ANTHROPIC_API_KEY is present, so pinning it here catches the taxonomy
// regressions the audit was about. We assert the EXPECTED kind appears among
// the top candidates (not necessarily rank 1 — prominence scoring is a
// separate axis), which is the property that matters: the site's real
// conversion motion is representable and correctly typed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

import { replayCorpus } from "../harness.server";
import { mapAuditToInventory, rankGoalCandidates } from "@/adaptive/crawler-inventory";
import type { PageAuditData } from "@/lib/tests/schema";

interface Archetype {
  name: string;
  domain: string;
  /** The conversion goal kind(s) that MUST appear among the top candidates. */
  expectKinds: string[];
}

const ARCHETYPES: Archetype[] = [
  { name: "cdon", domain: "cdon.se", expectKinds: ["purchase"] },
  { name: "elskling", domain: "elskling.se", expectKinds: ["start_flow", "quote"] },
  { name: "cancerfonden", domain: "cancerfonden.se", expectKinds: ["donate"] },
  { name: "hubspot", domain: "hubspot.com", expectKinds: ["signup", "trial", "contact"] },
  // NOTE: bokadirekt (booking) is deliberately NOT a strict-kind archetype.
  // Its homepage is a CATEGORY PORTAL — the most prominent CTAs are service
  // tiles ("Frisör", "Massage") rendered as href-less buttons, so the no-LLM
  // floor sees no booking verb/href and defaults to signup. The actual "Boka
  // tid" lives on the service page, not the homepage. The holistic goal judge
  // (LLM) reads "booking marketplace" from the whole inventory; the
  // deterministic floor can't from this capture. bokadirekt still ships as an
  // audit-layer snapshot (snapshot.test.ts) and is covered softly below. A
  // clean booking archetype needs a service-page capture — see the sites.ts
  // note.
];

let chromiumAvailable = false;
let probe: Browser | undefined;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    probe = await chromium.launch({ headless: true, executablePath });
    await probe.close();
    probe = undefined;
    chromiumAvailable = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[archetype-goals.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  if (probe) await probe.close();
});

describe("archetype goal kinds — the goal pipeline reads every conversion type", () => {
  for (const a of ARCHETYPES) {
    const frozen = existsSync(join("corpus", a.name, "page.mhtml"));
    it(
      `${a.name}: proposes a ${a.expectKinds.join("/")} goal from a real capture`,
      async () => {
        if (!chromiumAvailable || !frozen) return;
        const { pageAudit } = await replayCorpus(a.name);
        const inventory = mapAuditToInventory(pageAudit as PageAuditData, a.name);
        const candidates = rankGoalCandidates(inventory, a.domain);

        // There must be at least one acquisition CTA to propose a goal from.
        expect(candidates.length).toBeGreaterThan(0);

        const kinds = candidates.map((c) => c.kind);
        const hit = a.expectKinds.some((k) => kinds.includes(k as never));
        expect(
          hit,
          `${a.name}: expected one of [${a.expectKinds.join(", ")}] among candidate kinds, got [${kinds.join(", ")}] — texts: ${candidates
            .slice(0, 5)
            .map((c) => `"${c.text}"→${c.kind}`)
            .join(", ")}`,
        ).toBe(true);
      },
      120_000,
    );
  }

  // bokadirekt (booking): soft coverage — the homepage is a category portal,
  // so we only assert the pipeline produces candidates from the real capture,
  // not a specific kind (see the ARCHETYPES note). This still guards against
  // the harvest → inventory path silently breaking for a booking marketplace.
  const bokadirektFrozen = existsSync(join("corpus", "bokadirekt", "page.mhtml"));
  it(
    "bokadirekt (booking portal): harvest → inventory yields goal candidates",
    async () => {
      if (!chromiumAvailable || !bokadirektFrozen) return;
      const { pageAudit } = await replayCorpus("bokadirekt");
      const inventory = mapAuditToInventory(pageAudit as PageAuditData, "bokadirekt");
      const candidates = rankGoalCandidates(inventory, "bokadirekt.se");
      expect(candidates.length).toBeGreaterThan(0);
    },
    120_000,
  );
});
