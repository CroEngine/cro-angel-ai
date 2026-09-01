// Naturhöjdsmätningen (stardream 2026-09-01): skal-låsta sidor rapporterar
// rotens scrollHeight = viewporthöjden medan innehållet bor djupare i trädet.
// Reglerna som låses: hög rot ⇒ trädet skannas aldrig (dyrt); skal-låst rot ⇒
// trädets största innehållsbärare vinner; smala remsor ignoreras.
import { describe, expect, it } from "vitest";

import { measureDocHeight } from "../doc-height";

const el = (scrollHeight: number, clientWidth = 390) => ({ scrollHeight, clientWidth });
const doc = (root: number, kids: { scrollHeight: number; clientWidth: number }[]) => ({
  documentElement: el(root),
  body: Object.assign(el(root), { querySelectorAll: () => kids }),
});

describe("measureDocHeight — naturhöjd även genom app-skal", () => {
  it("roten bär innehållet (≥1266) ⇒ roten gäller, trädet skannas inte", () => {
    const d = doc(4000, []);
    d.body.querySelectorAll = () => {
      throw new Error("trädet ska inte skannas när roten är hög");
    };
    expect(measureDocHeight(d)).toBe(4000);
  });

  it("skal-låst rot (844) ⇒ trädets största innehållsbärare vinner (Ionic-fallet)", () => {
    expect(measureDocHeight(doc(844, [el(844), el(4896), el(1200)]))).toBe(4896);
  });

  it("smala remsor (<250px) får inte diktera höjden", () => {
    expect(measureDocHeight(doc(844, [el(9000, 40), el(2100, 390)]))).toBe(2100);
  });

  it("kort sida utan högre barn ⇒ rotens höjd står", () => {
    expect(measureDocHeight(doc(900, [el(600), el(900)]))).toBe(900);
  });

  it("saknad body/rot ⇒ 0/roten — aldrig ett kast", () => {
    expect(measureDocHeight({ documentElement: null, body: null })).toBe(0);
    expect(measureDocHeight({ documentElement: el(844), body: null })).toBe(844);
  });
});
