// Väntestegen på /try (ägarfynd 2026-08-31, "man vet inte vart man är i
// väntandet"): arbetaren stämplar grovfasen i jobbraden (freeze → analyze →
// verify) och den här RENA mappningen ritar den som en steglista — verkliga
// lägen i stället för en pulserande låtsas-stapel. Gamla rader/arbetare utan
// stämpel ⇒ första bygg-steget aktivt (ärlig degradering, aldrig ett kast).

export type WaitStepState = "done" | "active" | "todo";

export interface WaitStep {
  key: string;
  label: string;
  state: WaitStepState;
}

/** Ordningen ÄR arbetarens kedja (scripts/loop/preview.ts): kön → frysning i
 *  riktig browser → sektionskarta + val av drag → verify-grindarna. Etiketterna
 *  beskriver vad som faktiskt sker — inget steg är påhittat. */
const STEPS: readonly { key: string; label: string }[] = [
  { key: "queued", label: "In the queue" },
  { key: "freeze", label: "Opening your page in a real browser" },
  { key: "analyze", label: "Mapping sections, choosing the strongest change" },
  { key: "verify", label: "Running the safety gates" },
];

export function waitSteps(
  status: "queued" | "running",
  stage: string | null | undefined,
): WaitStep[] {
  // Okänd/saknad stämpel medan jobbet kör ⇒ frysningen (indexgolvet 1):
  // hellre ett ärligt "tidigt i bygget" än ett kast eller alla steg klara.
  const active =
    status === "queued"
      ? 0
      : Math.max(
          1,
          STEPS.findIndex((s) => s.key === stage),
        );
  return STEPS.map((s, i) => ({
    ...s,
    state: i < active ? "done" : i === active ? "active" : "todo",
  }));
}
