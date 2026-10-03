import { describe, expect, it } from "vitest";
import type { OpenTPConfig } from "../types";
import {
  analyzeBaseLayers,
  didYouMean,
  editDistance,
  exampleProblems,
  naturalCompare,
  suggestNames,
  unknownFieldMessage,
  valueProblems,
} from "./fields";
import type { DictionaryLookup } from "./payload";

const lookup: DictionaryLookup = (dict) => (dict === "apps" ? ["web-app", "mobile-app"] : null);

describe("field-name suggestions", () => {
  it("sorts naturally: digits as numbers, other text by code point", () => {
    expect(
      ["dimension_10", "dimension_2", "Dimension_3", "dimension_1"].sort(naturalCompare),
    ).toEqual(["Dimension_3", "dimension_1", "dimension_2", "dimension_10"]);
    expect(naturalCompare("a01", "a1")).toBe(1);
    expect(naturalCompare("a", "a")).toBe(0);
  });

  it("measures edit distance in code points", () => {
    expect(editDistance("event_nme", "event_name")).toBe(1);
    expect(editDistance("😀a", "a")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });

  it("prefers a name equal ignoring case, else the closest names (at most 2 edits, 3 names)", () => {
    const candidates = ["event_name", "Event_Name", "dimension_1", "dimension_2", "dimension_3"];
    expect(suggestNames("EVENT_NAME", candidates)).toEqual(["Event_Name", "event_name"]);
    expect(suggestNames("event_nme", candidates)).toEqual(["event_name"]);
    expect(suggestNames("dimension_", [...candidates, "dimension_4", "dimension_10"])).toEqual([
      "dimension_1",
      "dimension_2",
      "dimension_3",
    ]);
    expect(suggestNames("totally_different", candidates)).toEqual([]);
  });

  it("formats the suggestion and the closed-vocabulary message", () => {
    expect(didYouMean([])).toBe("");
    expect(didYouMean(["a"])).toBe(". Did you mean 'a'?");
    expect(didYouMean(["a", "b"])).toBe(". Did you mean 'a' or 'b'?");
    expect(didYouMean(["a", "b", "c"])).toBe(". Did you mean 'a', 'b' or 'c'?");
    expect(unknownFieldMessage("event_nme", "web", ["event_name"])).toBe(
      "Unknown field 'event_nme': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/web.schema. Did you mean 'event_name'?",
    );
  });
});

describe("valueProblems and exampleProblems", () => {
  it("checks the type, the constraints and every item of an array", () => {
    expect(valueProblems("ab", { type: "string", maxLength: 1 })).toEqual([
      { suffix: "", message: "Expected length <= 1" },
    ]);
    expect(valueProblems(1.5, { type: "integer" })).toEqual([
      { suffix: "", message: "Expected integer value, got number" },
    ]);
    expect(
      valueProblems(
        ["web-app", "tv-app", 3],
        {
          type: "array",
          maxItems: 2,
          items: { type: "string", dict: "apps" },
        },
        { lookup },
      ),
    ).toEqual([
      { suffix: "", message: "Expected maxItems 2" },
      {
        suffix: "[1]",
        message: "Item value 'tv-app' is not in dictionary 'apps'",
        dictionary: true,
      },
      { suffix: "[2]", message: "Expected string item, got number" },
    ]);
    // An unknown dictionary is reported where it is written, not here
    expect(
      valueProblems(["x"], { type: "array", items: { type: "string", dict: "no" } }, { lookup }),
    ).toEqual([]);
  });

  it("checks examples against the fixed value, the enum and the dictionary", () => {
    expect(exampleProblems("a", { type: "string", value: "b" })).toEqual([
      { suffix: "", message: 'Example "a" is not the fixed value "b"' },
    ]);
    expect(exampleProblems("c", { type: "string", enum: ["a", "b"] })).toEqual([
      { suffix: "", message: 'Example "c" is not in allowed enum: [a, b]' },
    ]);
    expect(exampleProblems("tv-app", { type: "string", dict: "apps" }, { lookup })).toEqual([
      { suffix: "", message: "Example \"tv-app\" is not in dictionary 'apps'", dictionary: true },
    ]);
    expect(exampleProblems("web-app", { type: "string", dict: "apps" }, { lookup })).toEqual([]);
  });
});

function makeConfig(): OpenTPConfig {
  return {
    opentp: "2026-09",
    info: { title: "Fields test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      targets: {
        all: {
          schema: {
            app: { value: "tv-app" },
            build: { type: "string", policy: "fixed", required: false },
            mode: { type: "string", policy: "always" as never },
            tags: { type: "array" },
          },
        },
      },
      events: {
        taxonomy: {},
        payload: {
          targets: { all: ["web"] },
          schema: { app: { type: "string", dict: "apps" } },
        },
      },
    },
  };
}

describe("analyzeBaseLayers", () => {
  it("reports base-layer problems once; dictionary rules only with dictionaries", () => {
    const withoutDictionaries = analyzeBaseLayers(makeConfig());
    expect(withoutDictionaries).toEqual([
      {
        path: "spec.targets.all.schema.build",
        message: "Field 'build' is always present (its policy is 'fixed'); remove required: false",
      },
      {
        path: "spec.targets.all.schema.mode.policy",
        message: "Invalid policy 'always': expected specified, restricted or fixed",
      },
      {
        path: "spec.targets.all.schema.tags.items",
        message:
          "Field 'tags' has no items.type: give its items a type in the catalog or in spec.targets",
      },
    ]);
    expect(analyzeBaseLayers(makeConfig(), lookup)).toEqual([
      {
        path: "spec.targets.all.schema.app.value",
        message: "Value 'tv-app' is not in dictionary 'apps'",
        dictionary: true,
      },
      ...withoutDictionaries,
    ]);
  });
});
