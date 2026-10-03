import { describe, expect, it } from "vitest";
import type { ResolvedEvent } from "../types";
import { eventDocument, normalizeText, TrigramIndex, trigrams, words } from "./search";

function event(overrides: Partial<ResolvedEvent>): ResolvedEvent {
  return {
    filePath: "/plan/events/x.yaml",
    relativePath: "x.yaml",
    key: "x",
    expectedKey: null,
    taxonomy: {},
    ignore: [],
    payload: { schema: {} },
    ...overrides,
  };
}

describe("normalizeText", () => {
  it("lowercases and removes combining marks for every script", () => {
    expect(normalizeText("Café")).toBe("cafe");
    expect(normalizeText("Ёлка")).toBe("елка");
    expect(normalizeText("ÜBER")).toBe("uber");
  });
});

describe("words", () => {
  it("splits on anything that is not a letter or digit and drops single characters", () => {
    expect(words("login_button-click a, Step 2: x1")).toEqual([
      "login",
      "button",
      "click",
      "step",
      "x1",
    ]);
  });

  it("keeps letters of any script", () => {
    expect(words("Привет, мир")).toEqual(["привет", "мир"]);
  });
});

describe("trigrams", () => {
  it("marks word boundaries", () => {
    expect(trigrams("log")).toEqual(["_lo", "log", "og_"]);
    expect(trigrams("ab")).toEqual(["_ab", "ab_"]);
  });
});

describe("TrigramIndex", () => {
  const index = new TrigramIndex([
    "user clicks the login button",
    "dashboard opened",
    "payment completed successfully",
  ]);

  it("ranks the best match first and leaves out documents with no match", () => {
    const hits = index.search("login", 10);
    expect(hits[0]?.index).toBe(0);
    expect(hits.every((hit) => hit.index !== 2 || hit.score > 0)).toBe(true);
  });

  it("tolerates typos and word forms", () => {
    expect(index.search("logn buton", 1)[0]?.index).toBe(0);
    expect(index.search("payments", 1)[0]?.index).toBe(2);
  });

  it("respects the limit and returns nothing for an empty query", () => {
    expect(index.search("e", 10)).toEqual([]);
    expect(index.search("dashboard payment login", 2)).toHaveLength(2);
  });

  it("works for an empty index", () => {
    expect(new TrigramIndex([]).search("login", 5)).toEqual([]);
  });
});

describe("eventDocument", () => {
  it("contains the key, taxonomy values and the payload fields the event defines", () => {
    const text = eventDocument(
      event({
        key: "auth::login_click",
        relativePath: "auth/login_click.yaml",
        taxonomy: { area: "auth", action: "User clicks the login button", priority: 2 },
        payload: {
          web: {
            current: "1.0.0",
            "1.0.0": {
              schema: {
                event_name: { value: "zebra_fixed_value" },
                method: { type: "string", title: "Auth method", enum: ["email", "google"] },
                country: { type: "string", enum: Array.from({ length: 20 }, (_, i) => `c${i}`) },
              },
            },
          },
        } as unknown as ResolvedEvent["payload"],
      }),
    );
    expect(text).toContain("auth::login_click");
    expect(text).toContain("User clicks the login button");
    expect(text).toContain("2");
    // A fixed value that appears nowhere else
    expect(text).toContain("zebra_fixed_value");
    expect(text).toContain("Auth method");
    expect(text).toContain("google");
    // Long enums are shared vocabularies, not a property of the event
    expect(text).not.toContain("c19");
    // Path values are already taxonomy values
    expect(text).not.toContain("auth/login_click");
  });
});
