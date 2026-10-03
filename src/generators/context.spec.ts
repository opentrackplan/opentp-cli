/**
 * What `opentp generate` passes to generators: a frozen copy of opentp.cli.yaml, the tracker
 * binding and the effective payload of each event.
 */

import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_OK, main } from "../cli";
import { setLogLevel } from "../util/logger";
import { registerGenerator } from "./registry";
import type { GeneratorContext } from "./types";

const contexts: GeneratorContext[] = [];
registerGenerator({
  name: "context-probe",
  generate: (context) => {
    contexts.push(context);
    return { stdout: "" };
  },
});

describe("the generator context of opentp generate", () => {
  beforeEach(() => {
    contexts.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("info");
  });

  it("has a read-only copy of opentp.cli.yaml and the effective payload of each event", async () => {
    const root = path.resolve("tests/data/coverage-valid");
    expect(await main(["generate", "context-probe", "--root", root])).toBe(EXIT_OK);
    expect(contexts).toHaveLength(1);
    const [context] = contexts;
    expect(context.cliConfig?.keygen?.template).toContain("{area | slug}");
    expect(Object.isFrozen(context.cliConfig)).toBe(true);
    expect(Object.isFrozen(context.cliConfig?.checks?.bindings)).toBe(true);
    expect(() => {
      (context.cliConfig as Record<string, unknown>).keygen = null;
    }).toThrow(TypeError);
    // Sorted by file path
    expect(context.events.map((event) => event.relativePath)).toEqual([
      "auth/2/false/ignored_application_id_dict.yaml",
      "auth/2/false/login_button_click.yaml",
      "auth/3/false/login_experiment.yaml",
      "onboarding/1/true/onboarding_step_complete.yaml",
    ]);
    const login = context.events[1];
    expect(Object.keys(context.effective(login))).toEqual(["web", "ios", "android"]);
    expect(context.effective(login).web.fields.application_id).toMatchObject({
      policy: "fixed",
      value: "web-app",
    });
    // The raw payload stays as written
    expect(login.payload).not.toHaveProperty("web");
    expect(context.tracker).toBeNull();
  });

  it("has no opentp.cli.yaml copy without the file", async () => {
    const root = path.resolve("tests/data/overlap");
    expect(await main(["generate", "context-probe", "--root", root])).toBe(EXIT_OK);
    expect(contexts[0]?.cliConfig).toBeNull();
  });
});
