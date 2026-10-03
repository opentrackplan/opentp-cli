import { describe, expect, it } from "vitest";
import type { OpenTPConfig, ResolvedEvent } from "../types";
import { filterEvents } from "./select";

const CONFIG: OpenTPConfig = {
  opentp: "2026-09",
  info: { title: "Select", version: "1.0.0" },
  spec: {
    paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
    events: {
      taxonomy: { area: { title: "Area", type: "string" } },
      payload: { targets: { all: ["web", "ios"], mobile: ["ios"] }, schema: {} },
    },
  },
};

function event(key: string, payload: unknown, area = "auth"): ResolvedEvent {
  return {
    filePath: `/plan/events/${key}.yaml`,
    relativePath: `${key}.yaml`,
    opentp: "2026-09",
    key,
    expectedKey: null,
    taxonomy: { area },
    ignore: [],
    payload: payload as ResolvedEvent["payload"],
  };
}

describe("filterEvents", () => {
  it("selects by target from the selectors, also when a version does not resolve", () => {
    const events = [
      event("implicit", { schema: {} }),
      // `current` names no version: the payload still covers every target
      event("broken_current", { current: "9", "1": { schema: {} } }),
      event("mobile", { mobile: { schema: {} } }),
      event("mobile_broken", { mobile: { current: "x", "1": { schema: {} } } }),
      event("web", { web: { current: "1", "1": { schema: {} } } }),
    ];
    const keys = (target: string) =>
      filterEvents(events, CONFIG, { target }).map((selected) => selected.key);
    expect(keys("web")).toEqual(["implicit", "broken_current", "web"]);
    expect(keys("ios")).toEqual(["implicit", "broken_current", "mobile", "mobile_broken"]);
  });

  it("combines the target with taxonomy values", () => {
    const events = [event("a", { schema: {} }, "auth"), event("b", { web: { schema: {} } }, "pay")];
    expect(
      filterEvents(events, CONFIG, { target: "web", events: { area: "pay" } }).map((e) => e.key),
    ).toEqual(["b"]);
  });
});
