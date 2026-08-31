// Väntestegen (ägarfynd 2026-08-31, "man vet inte vart man är i väntandet"):
// ren mappning status+stage → steglista. Reglerna som låses: exakt ETT aktivt
// steg, allt före är klart, allt efter väntar — och okänd/saknad stämpel
// degraderar till första bygg-steget i stället för att kasta eller ljuga klart.
import { describe, expect, it } from "vitest";

import { waitSteps } from "../wait-steps";

const states = (status: "queued" | "running", stage: string | null | undefined) =>
  waitSteps(status, stage).map((s) => s.state);

describe("waitSteps — status+stage → steglista", () => {
  it("köad ⇒ första steget aktivt, resten väntar", () => {
    expect(states("queued", null)).toEqual(["active", "todo", "todo", "todo"]);
  });

  it("kör utan stämpel (gammal rad/arbetare) ⇒ frysningen aktiv — aldrig ett kast", () => {
    expect(states("running", null)).toEqual(["done", "active", "todo", "todo"]);
    expect(states("running", undefined)).toEqual(["done", "active", "todo", "todo"]);
  });

  it("stämplarna vandrar i arbetarens ordning: freeze → analyze → verify", () => {
    expect(states("running", "freeze")).toEqual(["done", "active", "todo", "todo"]);
    expect(states("running", "analyze")).toEqual(["done", "done", "active", "todo"]);
    expect(states("running", "verify")).toEqual(["done", "done", "done", "active"]);
  });

  it("okänd framtida stämpel ⇒ frysningen aktiv (golvet), inte alla klara", () => {
    expect(states("running", "framtida_steg")).toEqual(["done", "active", "todo", "todo"]);
  });

  it("exakt ett aktivt steg i varje läge", () => {
    for (const [status, stage] of [
      ["queued", null],
      ["running", null],
      ["running", "freeze"],
      ["running", "analyze"],
      ["running", "verify"],
      ["running", "x"],
    ] as const) {
      const active = waitSteps(status, stage).filter((s) => s.state === "active");
      expect(active).toHaveLength(1);
    }
  });

  it("etiketterna är beskrivande och stabila nycklar följer med", () => {
    expect(waitSteps("queued", null).map((s) => s.key)).toEqual([
      "queued",
      "freeze",
      "analyze",
      "verify",
    ]);
  });
});
