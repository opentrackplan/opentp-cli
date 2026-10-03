import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { keysInSourceOrder, mergeKeyPaths, parseYaml } from "./yaml";

describe("parseYaml", () => {
  const VERSIONS = [
    "payload:",
    '  current: "2"',
    '  "2": { schema: { a: { value: 2 } } }',
    '  "1": { schema: { a: { value: 1 } } }',
    "  10: { schema: {} }",
    "  v0: { schema: {} }",
    "",
  ].join("\n");

  it("returns the same value as yaml.parse", () => {
    expect(parseYaml(VERSIONS)).toEqual(parse(VERSIONS));
    expect(JSON.stringify(parseYaml(VERSIONS))).toBe(JSON.stringify(parse(VERSIONS)));
    expect(parseYaml("")).toBe(parse(""));
    expect(parseYaml("- 1\n- two\n")).toEqual([1, "two"]);
  });

  it("keeps the source order of mappings whose integer-like keys JavaScript would reorder", () => {
    const value = parseYaml(VERSIONS) as { payload: Record<string, unknown> };
    // A JavaScript object lists integer-like keys first, in numeric order
    expect(Object.keys(value.payload)).toEqual(["1", "2", "10", "current", "v0"]);
    expect(keysInSourceOrder(value.payload)).toEqual(["current", "2", "1", "10", "v0"]);
    // The order is not an enumerable key: spreading and JSON leave it out
    expect(Object.keys({ ...value.payload })).toEqual(Object.keys(value.payload));
  });

  it("falls back to the object's own key order", () => {
    expect(keysInSourceOrder({ b: 1, a: 2 })).toEqual(["b", "a"]);
    const value = parseYaml("b: 1\na: 2\n") as Record<string, unknown>;
    expect(keysInSourceOrder(value)).toEqual(["b", "a"]);
  });

  it("covers mappings reached through an alias without expanding it again", () => {
    const value = parseYaml(
      'base: &v { "2": x, "1": y }\ncopy: *v\nlist: [*v, { "3": z, "0": w }]\n',
    ) as { base: Record<string, unknown>; copy: Record<string, unknown>; list: unknown[] };
    expect(keysInSourceOrder(value.base)).toEqual(["2", "1"]);
    expect(keysInSourceOrder(value.copy)).toEqual(["2", "1"]);
    expect(keysInSourceOrder(value.list[1] as Record<string, unknown>)).toEqual(["3", "0"]);
  });

  it("throws the errors yaml.parse throws (with line and column)", () => {
    const broken = "a: [1, 2\nb: c\n";
    expect(() => parse(broken)).toThrow();
    let error: unknown;
    try {
      parseYaml(broken);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("YAMLParseError");
    expect((error as { linePos?: unknown }).linePos).toBeDefined();
    expect(() => parseYaml("a: 1\na: 2\n")).toThrow(/unique/);
    expect(() => parseYaml("a: 1\n---\nb: 2\n")).toThrow(/multiple documents/);
  });
});

describe("mergeKeyPaths", () => {
  it("lists the plain << keys of the YAML text, not quoted ones, once where they are written", () => {
    const value = parseYaml(
      [
        "a: &base { x: 1 }",
        "b: { <<: *base, y: 2 }",
        "c: { \"<<\": quoted, nested: [{ '<<': single }, { <<: { z: 3 } }] }",
        "d: *base",
        "e: { f: &m { <<: { w: 1 } } }",
        "g: *m",
        "",
      ].join("\n"),
    );
    expect(mergeKeyPaths(value)).toEqual(["b.<<", "c.nested[1].<<", "e.f.<<"]);
    // The value is the same as yaml.parse gives (the paths are not an enumerable key)
    expect(Object.keys(value as object)).toEqual(["a", "b", "c", "d", "e", "g"]);
  });

  it("finds none in a document without merge keys, or in a value parseYaml did not return", () => {
    expect(mergeKeyPaths(parseYaml('a: { "<<": 1 }\n'))).toEqual([]);
    expect(mergeKeyPaths({ "<<": 1 })).toEqual([]);
    expect(mergeKeyPaths(parseYaml("just text"))).toEqual([]);
  });
});
