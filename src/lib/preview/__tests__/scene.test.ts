// Scenens grindbeslut (hållna jobb uppslukande, 2026-08-31): reglerna som
// låses — vyn hålls tillbaka tills BÅDA proberna svarat; ingen before-kopia ⇒
// klassiska kortvyn (äldre jobb); verifierat öppnar på varianten, hållet
// öppnar ALLTID på Original; växlaren finns bara när after-kopian finns.
import { describe, expect, it } from "vitest";

import { sceneMode } from "../scene";

describe("sceneMode — probes + verdict → scenens läge", () => {
  it("någon probe pending ⇒ wait (inga halvvyer som blixtrar)", () => {
    expect(sceneMode("pending", "pending", true).show).toBe("wait");
    expect(sceneMode("ok", "pending", true).show).toBe("wait");
    expect(sceneMode("pending", "missing", false).show).toBe("wait");
  });

  it("ingen before-kopia ⇒ klassiska vyn (äldre jobb byggda före uppladdningen)", () => {
    expect(sceneMode("missing", "ok", true)).toEqual({
      show: "classic",
      canFlip: false,
      defaultArm: "before",
    });
    expect(sceneMode("missing", "missing", false).show).toBe("classic");
  });

  it("verifierat med båda kopiorna ⇒ scen, växlare, öppnar på varianten", () => {
    expect(sceneMode("ok", "ok", true)).toEqual({
      show: "scene",
      canFlip: true,
      defaultArm: "after",
    });
  });

  it("hållet förslag med after-kopia ⇒ scen, växlare, öppnar på Original", () => {
    expect(sceneMode("ok", "ok", false)).toEqual({
      show: "scene",
      canFlip: true,
      defaultArm: "before",
    });
  });

  it("hållet utan after (upplösningen vägrade) ⇒ scen utan växlare, Original", () => {
    expect(sceneMode("ok", "missing", false)).toEqual({
      show: "scene",
      canFlip: false,
      defaultArm: "before",
    });
  });

  it("verifierat men after-kopian saknas (uppladdning föll) ⇒ Original utan växlare", () => {
    expect(sceneMode("ok", "missing", true)).toEqual({
      show: "scene",
      canFlip: false,
      defaultArm: "before",
    });
  });
});
