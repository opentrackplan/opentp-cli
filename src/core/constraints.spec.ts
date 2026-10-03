import { describe, expect, it } from "vitest";
import {
  codePointLength,
  matchesFormat,
  numberConstraintProblems,
  portableCheckProblems,
  stringConstraintProblems,
} from "./constraints";

describe("codePointLength", () => {
  it("counts Unicode code points, not UTF-16 code units", () => {
    expect(codePointLength("")).toBe(0);
    expect(codePointLength("abc")).toBe(3);
    expect(codePointLength("😀")).toBe(1);
    expect("😀".length).toBe(2);
    expect(codePointLength("日本語")).toBe(3);
    expect(codePointLength("é")).toBe(2);
  });
});

describe("format (2026-09 definitions)", () => {
  it.each([
    [
      "date",
      ["2026-09-01", "2024-02-29", "2000-02-29"],
      [
        "2026-9-1",
        "2026-02-30",
        "2023-02-29",
        "1900-02-29",
        "2026-13-01",
        "2026-09-01T00:00:00Z",
        " 2026-09-01",
      ],
    ],
    [
      "date-time",
      [
        "2026-09-01T12:30:00Z",
        "2026-09-01t12:30:00.123z",
        "2026-09-01T23:59:60+02:00",
        "2026-09-01T00:00:00-11:30",
      ],
      [
        "2026-09-01",
        "2026-09-01T12:30:00",
        "2026-09-01T24:00:00Z",
        "2026-09-01T12:60:00Z",
        "2026-09-01 12:30:00Z",
        "2026-02-30T00:00:00Z",
        "2026-09-01T12:30:00+24:00",
      ],
    ],
    [
      "email",
      ["a@b", "first.last@example.com", "x+tag@sub.example.co"],
      ["", "a", "@b", "a@", "a@b@c"],
    ],
    [
      "uuid",
      ["123e4567-e89b-12d3-a456-426614174000", "123E4567-E89B-12D3-A456-426614174000"],
      [
        "123e4567e89b12d3a456426614174000",
        "123e4567-e89b-12d3-a456-42661417400g",
        "{123e4567-e89b-12d3-a456-426614174000}",
      ],
    ],
    [
      "uri",
      ["https://example.com/a?b=c", "mailto:a@b", "urn:isbn:0451450523", "x:"],
      ["example.com", "/relative/path", "1http://x", "https://exa mple.com", ""],
    ],
    [
      "ipv4",
      ["127.0.0.1", "255.255.255.255", "0.0.0.0", "10.1.0.100", "192.168.1.1"],
      [
        "256.0.0.1",
        "1.2.3",
        "1.2.3.4.5",
        "1.2.3.a",
        "1.2.3.1234",
        // Octets have no leading zeros (as Ajv and the spec's validate.ts)
        "010.001.000.001",
        "192.168.001.1",
        "1.2.3.04",
        "00.0.0.0",
        "+1.2.3.4",
        " 1.2.3.4",
      ],
    ],
    [
      "ipv6",
      [
        "::",
        "::1",
        "2001:db8::1",
        "2001:0db8:0000:0000:0000:ff00:0042:8329",
        "fe80::",
        "::ffff:192.0.2.128",
        "1:2:3:4:5:6:7::",
      ],
      [
        "",
        ":",
        ":::",
        "1::2::3",
        "12345::",
        "1:2:3:4:5:6:7:8:9",
        "1:2:3:4:5:6:7",
        "::ffff:999.0.2.128",
        "::ffff:192.0.2.01",
        "fe80::1%eth0",
        "g::1",
      ],
    ],
  ])("%s", (format, valid, invalid) => {
    for (const value of valid) expect(matchesFormat(format, value), value).toBe(true);
    for (const value of invalid) expect(matchesFormat(format, value), value).toBe(false);
  });

  it("does not check unknown formats", () => {
    expect(matchesFormat("hostname", "not a host name")).toBe(true);
  });
});

describe("constraint problems", () => {
  it("reports string constraints with the validate messages", () => {
    expect(
      stringConstraintProblems("😀😀😀", {
        minLength: 4,
        maxLength: 2,
        pattern: "^a",
        format: "email",
      }),
    ).toEqual([
      "Expected length >= 4",
      "Expected length <= 2",
      'Value does not match pattern "^a"',
      "Value is not a valid email",
    ]);
    // Exactly at the limits, counted in code points
    expect(stringConstraintProblems("😀😀", { minLength: 2, maxLength: 2 })).toEqual([]);
    // Patterns use the u flag and are not anchored
    expect(stringConstraintProblems("x😀y", { pattern: "^x.y$" })).toEqual([]);
    expect(stringConstraintProblems("xay", { pattern: "a" })).toEqual([]);
  });

  it("reports or skips an invalid pattern", () => {
    expect(stringConstraintProblems("a", { pattern: "(" })).toEqual([]);
    expect(stringConstraintProblems("a", { pattern: "(" }, { invalidPattern: "report" })).toEqual([
      expect.stringMatching(/^Invalid regex pattern "\(": SyntaxError: /),
    ]);
  });

  it("reports number constraints", () => {
    expect(
      numberConstraintProblems(5, {
        minimum: 6,
        maximum: 4,
        exclusiveMinimum: 5,
        exclusiveMaximum: 5,
        multipleOf: 2,
      }),
    ).toEqual([
      "Expected >= 6",
      "Expected <= 4",
      "Expected > 5",
      "Expected < 5",
      "Expected multipleOf 2",
    ]);
    expect(numberConstraintProblems(0.3, { multipleOf: 0.1 })).toEqual([]);
  });

  it("applies portable checks by value type", () => {
    const check = { maxLength: 3, maximum: 10 };
    expect(portableCheckProblems(check, "abcd")).toEqual(["Expected length <= 3"]);
    expect(portableCheckProblems(check, 11)).toEqual(["Expected <= 10"]);
    expect(portableCheckProblems(check, true)).toEqual([]);
    expect(portableCheckProblems({ pattern: "(" }, "x")).toEqual([]);
  });
});
