import { describe, expect, it } from "vitest";
import { setEventKey } from "./fix";

const fixed = (text: string, key: string): string => {
  const edit = setEventKey(text, key);
  if (!edit.ok) throw new Error(edit.reason);
  return edit.text;
};

describe("setEventKey", () => {
  it("replaces only the key's text: comments, blank lines and the rest stay byte for byte", () => {
    const text = [
      "# yaml-language-server: $schema=https://opentp.dev/schemas/2026-09/event.schema.json",
      "opentp: 2026-09   # header",
      "",
      "event:",
      "    key: wrong     # the key",
      "",
      "    taxonomy: { action: 'Clicks' }",
      "    payload:",
      '        current: "2"',
      '        "2": { schema: { a: { value: "x" } } }',
      '        "1": { schema: {} }',
      "",
    ].join("\n");
    expect(fixed(text, "auth::login")).toBe(text.replace("key: wrong ", "key: auth::login "));
  });

  it("keeps the quoting style of the key", () => {
    expect(fixed("event:\n  key: 'old'\n", "a::b")).toBe("event:\n  key: 'a::b'\n");
    expect(fixed("event:\n  key: 'old'\n", "it's")).toBe("event:\n  key: 'it''s'\n");
    expect(fixed('event:\n  key: "old"\n', 'say "hi"')).toBe('event:\n  key: "say \\"hi\\""\n');
    expect(fixed("event:\n  key: !!str old\n", "a::b")).toBe("event:\n  key: !!str a::b\n");
  });

  it("quotes a plain key when the new key would not read back as the same string", () => {
    expect(fixed("event:\n  key: old\n", "123")).toBe('event:\n  key: "123"\n');
    expect(fixed("event:\n  key: old\n", "true")).toBe('event:\n  key: "true"\n');
    expect(fixed("event:\n  key: old\n", "a #b")).toBe('event:\n  key: "a #b"\n');
    // In a flow mapping a comma ends a plain scalar
    expect(fixed("event: { key: old, taxonomy: {} }\n", "a,b")).toBe(
      'event: { key: "a,b", taxonomy: {} }\n',
    );
  });

  it("keeps CRLF line endings, a byte order mark and block scalars' line breaks", () => {
    expect(fixed("opentp: 2026-09\r\nevent:\r\n  key: old\r\n  x-a: 1\r\n", "new")).toBe(
      "opentp: 2026-09\r\nevent:\r\n  key: new\r\n  x-a: 1\r\n",
    );
    expect(fixed("﻿event:\n  key: old\n", "new")).toBe("﻿event:\n  key: new\n");
    expect(fixed("event:\n  key: |\n    old\n  taxonomy: {}\n", "new")).toBe(
      'event:\n  key: "new"\n  taxonomy: {}\n',
    );
  });

  it("changes nothing when the key cannot be changed alone", () => {
    const cases: Array<[string, RegExp]> = [
      ["base: &e { key: old }\nevent: *e\n", /'event' is not a mapping written in the file/],
      ["x-acme: &k old\nevent:\n  key: *k\n", /event\.key is not a scalar written in the file/],
      ["event:\n  taxonomy: {}\n", /event\.key is not a scalar written in the file/],
      ["event:\n  key: &k old\n  x-acme-previous: *k\n", /carries the anchor &k/],
      ["event:\n  key: old\n  key: other\n", /cannot be read as one YAML document/],
      ["event:\n  key: old\n---\nevent: {}\n", /cannot be read as one YAML document/],
      ["- event\n", /'event' is not a mapping written in the file/],
    ];
    for (const [text, reason] of cases) {
      const edit = setEventKey(text, "new");
      expect(edit.ok, text).toBe(false);
      if (!edit.ok) expect(edit.reason).toMatch(reason);
    }
  });

  it("changes an anchored key that no alias repeats", () => {
    expect(fixed("event:\n  key: &k old\n", "new")).toBe("event:\n  key: &k new\n");
  });
});
