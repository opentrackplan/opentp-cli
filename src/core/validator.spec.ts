import { describe, expect, it } from "vitest";
import type { OpenTPConfig, ResolvedEvent, ValidationError } from "../types";
import { validateConfig } from "./config";
import {
  formatWarnings,
  ignoresOverlap,
  OVERLAP_TEXT_LIMIT,
  payloadFieldOf,
  validateEvents,
} from "./validator";

function makeConfig(): OpenTPConfig {
  return {
    opentp: "2026-09",
    info: { title: "Validator test", version: "1.0.0" },
    spec: {
      paths: { events: { root: "/events", template: "{area}/{event}.yaml" } },
      events: {
        key: { maxLength: 8, format: "uuid" },
        taxonomy: {
          area: { title: "Area", type: "string", maxLength: 2 },
          release: { title: "Release", type: "string", format: "date" },
          contact: {
            title: "Contact",
            type: "string",
            template: "{name}<{email}>",
            fragments: {
              name: { title: "Name", type: "string", minLength: 2 },
              email: { title: "Email", type: "string", format: "email" },
            },
          },
        },
        payload: {
          targets: { all: ["web", "ios"] },
          schema: {
            user_email: { type: "string", format: "email" },
            nickname: { type: "string", maxLength: 2 },
            tags: { type: "array", items: { type: "string", format: "uuid" } },
          },
        },
      },
      targets: {
        all: { schema: { app: { type: "string", format: "uri" } } },
      },
    },
  };
}

function makeEvent(overrides: Partial<ResolvedEvent> = {}): ResolvedEvent {
  return {
    filePath: "/plan/events/日本/e.yaml",
    relativePath: "日本/e.yaml",
    opentp: "2026-09",
    key: "123e4567-e89b-12d3-a456-426614174000",
    expectedKey: null,
    taxonomy: { area: "日本", release: "2026-09-01", contact: "Jo<jo@example.com>" },
    ignore: [],
    payload: { schema: {} },
    ...overrides,
  };
}

describe("validateEvents: format and code points", () => {
  it("accepts values that satisfy format and lengths counted in code points", async () => {
    const config = makeConfig();
    config.spec.events.key = { maxLength: 36, format: "uuid" };
    const event = makeEvent({
      payload: {
        schema: {
          user_email: { value: "a@example.com" },
          nickname: { value: "😀😀" },
          tags: { value: ["123e4567-e89b-12d3-a456-426614174000"] },
          app: { value: "https://example.com" },
        },
      },
    });
    expect(await validateEvents([event], config, new Map())).toEqual([]);
  });

  it("reports format problems on keys, taxonomy, fragments, payload values, items and common fields", async () => {
    const config = makeConfig();
    const event = makeEvent({
      key: "not-a-uuid",
      taxonomy: { area: "日本語", release: "2026-02-30", contact: "J<jo>" },
      payload: {
        web: {
          schema: {
            user_email: { value: "jo" },
            nickname: { value: "😀😀😀" },
            tags: { value: ["x"] },
            app: { value: "example.com" },
          },
        },
      },
    });
    const errors = await validateEvents([event], config, new Map());
    expect(errors.map((error) => [error.path, error.message])).toEqual([
      ["event.key", "Key length must be <= 8"],
      ["event.key", "Value is not a valid uuid"],
      ["taxonomy.area", "Expected length <= 2"],
      ["taxonomy.release", "Value is not a valid date"],
      ["taxonomy.name", "Expected length >= 2"],
      ["taxonomy.email", "Value is not a valid email"],
      // Common fields come first in the effective field set
      ["payload.web.schema.app.value", "Value is not a valid uri"],
      ["payload.web.schema.user_email.value", "Value is not a valid email"],
      ["payload.web.schema.nickname.value", "Expected length <= 2"],
      ["payload.web.schema.tags.value[0]", "Value is not a valid uuid"],
    ]);
  });

  it("skips a payload field definition that is not a mapping (no crash)", async () => {
    const config = makeConfig();
    config.spec.events.key = {};
    (config.spec.events.payload.schema as Record<string, unknown>).broken = null;
    const event = makeEvent({
      payload: { schema: { user_email: null, nickname: { value: "ok" } } } as never,
    });
    const errors = await validateEvents([event], config, new Map());
    // The opentp.yaml problem is reported once; the event's own null definition is a load-time
    // file issue (see event.spec.ts), so validation itself reports nothing for it
    expect(errors.map((error) => [error.event, error.path])).toEqual([
      ["opentp.yaml", "spec.events.payload.schema.broken"],
    ]);
  });
});

describe("2026-09 field semantics", () => {
  function semanticsConfig(): OpenTPConfig {
    const config = makeConfig();
    config.spec.events.key = {};
    config.spec.events.taxonomy = {};
    config.spec.targets = {
      all: {
        schema: {
          app: { type: "string", dict: "apps", policy: "fixed" },
          kind: { type: "string", value: "page", checks: { "max-length": 3 } },
        },
      },
      ios: { schema: { app: { value: "ios-app" } } },
    };
    return config;
  }
  const dictionaries = new Map([["apps", ["web-app", "ios-app"]]]);
  const paths = (errors: ValidationError[]) =>
    errors.map((error) => [error.event, error.path, error.message]);

  it("a layer after the declaring layer can satisfy a policy for every event of a target", async () => {
    const config = semanticsConfig();
    // ios sets app after spec.targets.all declared `fixed`: `{}` is enough there, not on web
    const event = makeEvent({ payload: { schema: { app: {} } } });
    expect(paths(await validateEvents([event], config, dictionaries))).toEqual([
      // kind has a fixed value 'page' and a max-length 3 check: reported once against opentp.yaml
      ["opentp.yaml", "spec.targets.all.schema.kind.value", "Length 4 exceeds maximum 3"],
      [
        "日本/e.yaml",
        "payload.web.schema.app",
        "Field 'app' has policy 'fixed': every event must set its value",
      ],
    ]);
  });

  it("runs checks the event adds to an inherited fixed value, at the value", async () => {
    const config = semanticsConfig();
    const event = makeEvent({
      payload: { ios: { schema: { app: {}, kind: { checks: { "starts-with": "x" } } } } },
    });
    const errors = await validateEvents([event], config, dictionaries);
    expect(paths(errors).filter(([file]) => file !== "opentp.yaml")).toEqual([
      ["日本/e.yaml", "payload.ios.schema.kind.value", 'Value "page" does not start with "x"'],
    ]);
  });

  it("reports base problems that need dictionaries once, in validateEvents only", async () => {
    const config = semanticsConfig();
    config.spec.targets!.ios.schema!.app = { value: "tv-app" };
    const narrowing = [
      "opentp.yaml",
      "spec.targets.ios.schema.app.value",
      "Value 'tv-app' is not in dictionary 'apps'",
    ];
    expect(validateConfig(config).map((issue) => issue.path)).not.toContain(narrowing[1]);
    const events = [
      makeEvent({ payload: { ios: { schema: {} } } }),
      makeEvent({ relativePath: "b.yaml", key: "x", payload: { ios: { schema: {} } } }),
    ];
    const errors = paths(await validateEvents(events, config, dictionaries));
    expect(errors.filter((error) => error[1] === narrowing[1])).toEqual([narrowing]);
  });

  it("silences field-level checks with every payload ignore form, never a closed-vocabulary error", async () => {
    const config = semanticsConfig();
    const payload = {
      web: {
        schema: {
          app: { value: "tv-app" },
          user_email: { value: "x" },
          nickname: { value: "abc" },
          tags: { value: ["y"] },
          extra: {},
        },
      },
    };
    const forms = [
      "payload.app",
      "payload.web.schema.user_email.value",
      "payload::nickname",
      "payload.tags.value",
      "payload.extra",
    ];
    const ignored = makeEvent({ payload, ignore: forms.map((path) => ({ path })) });
    expect(paths(await validateEvents([ignored], config, dictionaries))).toEqual([
      ["opentp.yaml", "spec.targets.all.schema.kind.value", "Length 4 exceeds maximum 3"],
      [
        "日本/e.yaml",
        "payload.web.schema.extra",
        "Unknown field 'extra': add it to the catalog (spec.events.payload.schema) or to spec.targets.all/web.schema",
      ],
    ]);
  });
});

describe("payloadFieldOf (2026-09 ignore grammar)", () => {
  it("names the field of every payload path form", () => {
    expect(payloadFieldOf("payload::a.b")).toBe("a.b");
    expect(payloadFieldOf("payload.schema.user_id")).toBe("user_id");
    expect(payloadFieldOf("payload.all.1.0.0.schema.application_id.value")).toBe("application_id");
    expect(payloadFieldOf("payload.web.v1.2.schema.tags.items.enum")).toBe("tags");
    expect(payloadFieldOf("payload.event_category")).toBe("event_category");
    expect(payloadFieldOf("payload.user_email.value")).toBe("user_email");
    expect(payloadFieldOf("taxonomy.area")).toBeNull();
    expect(payloadFieldOf("payload.")).toBeNull();
    expect(payloadFieldOf("payload::")).toBeNull();
  });
});

describe("ignoresOverlap", () => {
  it("silences every overlap of an event with `overlap`, one pair with `overlap.<key>`", () => {
    expect(ignoresOverlap([{ path: "overlap" }], "any::key")).toBe(true);
    expect(ignoresOverlap([{ path: "overlap.auth::login.v2" }], "auth::login.v2")).toBe(true);
    expect(ignoresOverlap([{ path: "overlap.auth::login" }], "auth::logout")).toBe(false);
    expect(ignoresOverlap([{ path: "key" }], "x")).toBe(false);
    expect(ignoresOverlap([], "x")).toBe(false);
  });
});

describe("formatWarnings", () => {
  const warning = (event: string, rule?: string, n = 0): ValidationError => ({
    event,
    path: rule === "overlap" ? "payload" : "x",
    message: `${rule ?? "other"} ${n}`,
    severity: "warning",
    ...(rule ? { rule } : {}),
  });

  it("prints other warnings first, then overlap warnings by count (then path), capped", () => {
    const warnings: ValidationError[] = [
      warning("a.yaml", "unknownCheck"),
      ...Array.from({ length: 3 }, (_, n) => warning("b.yaml", "overlap", n)),
      ...Array.from({ length: 30 }, (_, n) => warning("c.yaml", "overlap", n)),
      ...Array.from({ length: 3 }, (_, n) => warning("a.yaml", "overlap", n)),
    ];
    const text = formatWarnings(warnings);
    const lines = text.split("\n").filter((line) => line !== "");
    expect(lines[0]).toBe("[a.yaml]");
    expect(lines[1]).toBe("  ⚠ x: unknownCheck 0");
    // c.yaml (30) first; the cap of 20 leaves nothing for a.yaml and b.yaml
    expect(lines[2]).toBe("[c.yaml]");
    expect(lines.filter((line) => line.startsWith("  ⚠ payload:"))).toHaveLength(
      OVERLAP_TEXT_LIMIT,
    );
    expect(lines.at(-1)).toBe(
      "… 16 more overlap warnings (--json lists all; set checks.severity.overlap in opentp.cli.yaml)",
    );
  });

  it("prints one block per file: its other warnings, then its overlap warnings", () => {
    const warnings = [
      warning("a.yaml", "unknownCheck"),
      warning("b.yaml", "overlap"),
      warning("a.yaml", "overlap"),
      warning("c.yaml"),
    ];
    expect(formatWarnings(warnings)).toBe(
      [
        "\n[a.yaml]",
        "  ⚠ x: unknownCheck 0",
        "  ⚠ payload: overlap 0",
        "\n[c.yaml]",
        "  ⚠ x: other 0",
        "\n[b.yaml]",
        "  ⚠ payload: overlap 0",
      ].join("\n"),
    );
  });

  it("counts a summary overlap warning as the number of events it stands for", () => {
    const summary: ValidationError = {
      event: "z.yaml",
      path: "payload",
      message:
        "Overlaps with 25 other events on web (25 identical); for example 'a::b' (a/b.yaml), 'a::c' (a/c.yaml), 'a::d' (a/d.yaml)",
      severity: "warning",
      rule: "overlap",
    };
    const warnings = [
      ...Array.from({ length: 3 }, (_, n) => warning("a.yaml", "overlap", n)),
      summary,
    ];
    const lines = formatWarnings(warnings)
      .split("\n")
      .filter((line) => line !== "");
    expect(lines[0]).toBe("[z.yaml]");
    expect(lines[2]).toBe("[a.yaml]");
    expect(lines).toHaveLength(6);
  });

  it("orders events with the same count by path and prints everything under the cap", () => {
    const warnings = [warning("b.yaml", "overlap"), warning("a.yaml", "overlap")];
    expect(formatWarnings(warnings)).toBe(
      "\n[a.yaml]\n  ⚠ payload: overlap 0\n\n[b.yaml]\n  ⚠ payload: overlap 0",
    );
    expect(formatWarnings(warnings, 1)).toBe(
      "\n[a.yaml]\n  ⚠ payload: overlap 0\n… 1 more overlap warnings (--json lists all; set checks.severity.overlap in opentp.cli.yaml)",
    );
  });
});
