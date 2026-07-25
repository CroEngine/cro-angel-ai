import { describe, expect, it } from "vitest";

import { parseJsonArray } from "../llm-json";

describe("parseJsonArray", () => {
  it("parses a bare JSON array", () => {
    expect(parseJsonArray('[{"i":0,"type":"pricing"}]')).toEqual([{ i: 0, type: "pricing" }]);
  });

  it("strips a ```json fence flush against the string ends", () => {
    expect(parseJsonArray('```json\n[{"i":0}]\n```')).toEqual([{ i: 0 }]);
  });

  it("strips a bare ``` fence", () => {
    expect(parseJsonArray('```\n[{"i":1}]\n```')).toEqual([{ i: 1 }]);
  });

  it("recovers when a newline precedes the fence (the bug that broke the 200-run)", () => {
    // Old regex anchored ``` to string start/end, so a leading newline left a
    // backtick and JSON.parse threw "Unrecognized token '`'".
    expect(parseJsonArray('\n```json\n[{"i":2}]\n```')).toEqual([{ i: 2 }]);
  });

  it("recovers when the model adds a prose preamble around the JSON", () => {
    expect(parseJsonArray('Here is the JSON:\n```json\n[{"i":3,"strength":0.9}]\n```')).toEqual([
      { i: 3, strength: 0.9 },
    ]);
  });

  it("recovers a trailing-newline-after-fence response via bracket extraction", () => {
    expect(parseJsonArray('```json\n[{"i":4}]\n```\n')).toEqual([{ i: 4 }]);
  });

  it("returns null for a response with no array", () => {
    expect(parseJsonArray("I could not classify these sections.")).toBeNull();
  });

  it("returns null (never throws) for malformed JSON", () => {
    expect(parseJsonArray("[{oops not json")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(parseJsonArray("")).toBeNull();
  });
});
