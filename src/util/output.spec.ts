import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonLines, printLines } from "./output";

describe("jsonLines", () => {
  it("produces the text of JSON.stringify(document, null, 2)", () => {
    const documents: Array<Record<string, unknown>> = [
      {
        success: false,
        events: 2,
        errors: [{ event: "a.yaml", path: "", message: 'multi\nline "quoted"', severity: "error" }],
        warnings: [],
      },
      { success: true, events: 0, errors: [], warnings: [] },
      {
        nested: { list: [1, [2, 3], { a: null }], empty: {} },
        items: [1, "two", null, undefined, { deep: [{ x: 1 }] }, []],
        skipped: undefined,
        last: "x",
      },
      {},
      { only: undefined },
    ];
    for (const document of documents) {
      expect([...jsonLines(document)].join("\n")).toBe(JSON.stringify(document, null, 2));
    }
  });

  it("serializes array elements one at a time", () => {
    const lines = [...jsonLines({ list: Array.from({ length: 3 }, (_, n) => ({ n })) })];
    expect(lines).toEqual([
      "{",
      '  "list": [',
      '    {\n      "n": 0\n    },',
      '    {\n      "n": 1\n    },',
      '    {\n      "n": 2\n    }',
      "  ]",
      "}",
    ]);
  });
});

describe("printLines", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the lines in chunks that together equal one joined string", () => {
    const calls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((text: string) => {
      calls.push(text);
    });
    const lines = Array.from({ length: 2500 }, (_, n) => (n % 7 === 0 ? `\n[${n}]` : `line ${n}`));
    printLines(lines);
    expect(calls).toHaveLength(3);
    expect(calls.join("\n")).toBe(lines.join("\n"));

    calls.length = 0;
    printLines([]);
    expect(calls).toEqual([]);
  });
});
