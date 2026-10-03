import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getGenerator, loadExternalGenerators } from "./generators";
import { getRule, loadExternalRules } from "./rules";
import { getStep, getStepProblem, loadExternalTransforms } from "./transforms";

/**
 * loadExternalRules / loadExternalTransforms / loadExternalGenerators with real plugin directories:
 * ESM and CommonJS plugins (module type from the plugin directory's package.json), absolute and
 * cwd-relative directories, and a missing directory.
 */

let tmpRoot: string;
// Registries are module-level, so plugin names are unique per run
const id = `${process.pid}-${Date.now()}`;

/** Writes `<dir>/<folder>/index.js` and a package.json that fixes the module type of `<dir>` */
function writePluginDir(dir: string, type: "module" | "commonjs", plugins: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type }));
  for (const [folder, source] of Object.entries(plugins)) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.writeFileSync(path.join(dir, folder, "index.js"), source);
  }
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-plugins-"));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("loadExternalRules", () => {
  it("loads ESM (default and named export) and CommonJS rules from absolute and relative dirs", async () => {
    const esmDir = path.join(tmpRoot, "rules-esm");
    writePluginDir(esmDir, "module", {
      "esm-default": `export default {
  name: "esm-rule-${id}",
  validate: (value) => (value === "ok" ? { valid: true } : { valid: false, error: "not ok" }),
};`,
      // No default export: the export named like the folder is used
      named: `export const named = { name: "named-rule-${id}", validate: () => ({ valid: true }) };`,
    });
    const cjsDir = path.join(tmpRoot, "rules-cjs");
    writePluginDir(cjsDir, "commonjs", {
      "cjs-rule": `module.exports = {
  name: "cjs-rule-${id}",
  validate: (value) => ({ valid: value !== "", error: "empty" }),
};`,
    });
    // A folder without index.js is not a plugin and is skipped
    fs.mkdirSync(path.join(cjsDir, "no-index"));

    await loadExternalRules(esmDir);
    await loadExternalRules(path.relative(process.cwd(), cjsDir));

    const esmRule = getRule(`esm-rule-${id}`);
    const ctx = { fieldName: "f", fieldPath: "taxonomy.f", eventKey: "e" };
    expect(await esmRule?.validate("ok", true, ctx)).toEqual({ valid: true });
    expect(await esmRule?.validate("no", true, ctx)).toEqual({ valid: false, error: "not ok" });
    expect(getRule(`named-rule-${id}`)).toBeDefined();
    expect(await getRule(`cjs-rule-${id}`)?.validate("", true, ctx)).toEqual({
      valid: false,
      error: "empty",
    });
  });

  it("logs a plugin that fails to import and keeps loading the others", async () => {
    const dir = path.join(tmpRoot, "rules-broken");
    writePluginDir(dir, "module", {
      "a-broken": "export default {",
      "b-good": `export default { name: "after-broken-${id}", validate: () => ({ valid: true }) };`,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await loadExternalRules(dir);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain(
        `Failed to load external rule from ${path.join(dir, "a-broken", "index.js")}`,
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(getRule(`after-broken-${id}`)).toBeDefined();
  });

  it("rejects a missing directory with its resolved path", async () => {
    await expect(loadExternalRules("./no-such-rules-dir")).rejects.toThrow(
      `External rules directory not found: ${path.resolve("no-such-rules-dir")}`,
    );
  });
});

describe("loadExternalTransforms", () => {
  it("loads ESM and CommonJS steps from absolute and relative dirs", async () => {
    const esmDir = path.join(tmpRoot, "transforms-esm");
    writePluginDir(esmDir, "module", {
      reverse: `export default {
  name: "reverse-${id}",
  factory: () => (value) => value.split("").reverse().join(""),
};`,
    });
    const cjsDir = path.join(tmpRoot, "transforms-cjs");
    writePluginDir(cjsDir, "commonjs", {
      wrap: `module.exports = {
  name: "wrap-${id}",
  factory: (params) => (value) => params.left + value + params.right,
};`,
    });

    // Unknown until loaded: keygen pipelines that use them are configuration errors
    expect(getStepProblem(`reverse-${id}`)).toContain("Unknown transform step");

    await loadExternalTransforms(path.relative(process.cwd(), esmDir));
    await loadExternalTransforms(cjsDir);

    expect(getStepProblem(`reverse-${id}`)).toBeNull();
    expect(getStep(`reverse-${id}`)?.factory()("abc")).toBe("cba");
    expect(getStep(`wrap-${id}`)?.factory({ left: "[", right: "]" })("x")).toBe("[x]");
  });

  it("rejects a missing directory", async () => {
    const missing = path.join(tmpRoot, "missing-transforms");
    await expect(loadExternalTransforms(missing)).rejects.toThrow(
      `External transforms directory not found: ${missing}`,
    );
  });
});

describe("loadExternalGenerators", () => {
  it("loads ESM and CommonJS generators from absolute and relative dirs", async () => {
    const esmDir = path.join(tmpRoot, "generators-esm");
    writePluginDir(esmDir, "module", {
      keys: `export default {
  name: "keys-${id}",
  generate: ({ events }) => ({ stdout: events.map((e) => e.key).join("\\n") }),
};`,
    });
    const cjsDir = path.join(tmpRoot, "generators-cjs");
    writePluginDir(cjsDir, "commonjs", {
      count: `module.exports = {
  name: "count-${id}",
  generate: async ({ events }) => ({ stdout: String(events.length) }),
};`,
    });

    await loadExternalGenerators(esmDir);
    await loadExternalGenerators(path.relative(process.cwd(), cjsDir));

    const context = {
      config: {} as never,
      events: [{ key: "a::b" }, { key: "c::d" }] as never,
      dictionaries: new Map(),
      options: {},
      effective: () => ({}),
    };
    expect(await getGenerator(`keys-${id}`)?.generate(context)).toEqual({ stdout: "a::b\nc::d" });
    expect(await getGenerator(`count-${id}`)?.generate(context)).toEqual({ stdout: "2" });
  });

  it("rejects a path that is not a directory", async () => {
    const file = path.join(tmpRoot, "not-a-dir.txt");
    fs.writeFileSync(file, "");
    await expect(loadExternalGenerators(file)).rejects.toThrow(
      `External generators directory not found: ${file}`,
    );
  });
});
