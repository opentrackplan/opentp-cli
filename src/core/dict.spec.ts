import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rootToolFiles } from "./config";
import { loadDictionaries } from "./dict";

const dirs: string[] = [];

function writeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-dict-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const dict = (values: string, version = "2026-09") =>
  `opentp: ${version}\ndict:\n  type: string\n  values: [${values}]\n`;

describe("loadDictionaries", () => {
  it("reads .yaml and .yml files; both for one path is an issue (the .yaml file is used)", () => {
    const dir = writeDir({
      "areas.yml": dict("auth, settings"),
      "teams.yaml": dict("web"),
      "teams.yml": dict("mobile"),
    });
    const { dictionaries, issues } = loadDictionaries(dir, "2026-09");
    expect(Object.fromEntries(dictionaries)).toEqual({
      areas: ["auth", "settings"],
      teams: ["web"],
    });
    expect(issues).toEqual([
      {
        file: "teams.yml",
        path: "",
        message: "Both teams.yaml and teams.yml exist; keep one (teams.yaml is used)",
      },
    ]);
  });

  it("adds the migrate hint to a 2026-01 dictionary and reports x-opentp (it still loads)", () => {
    const dir = writeDir({
      "old.yaml": "opentp: 2026-01\nx-opentp: {}\ndict:\n  type: string\n  values: [a]\n",
    });
    const { dictionaries, issues } = loadDictionaries(dir, "2026-09");
    expect(dictionaries.get("old")).toEqual(["a"]);
    expect(issues).toEqual([
      {
        file: "old.yaml",
        path: "x-opentp",
        message:
          "x-opentp was removed in 2026-09: move checks to 'checks', keygen to opentp.cli.yaml 'keygen', delete 'role'",
      },
      {
        file: "old.yaml",
        path: "opentp",
        message:
          "Unsupported OpenTrackPlan schema version '2026-01'. Expected '2026-09'. Run \"opentp migrate\" to upgrade it.",
      },
    ]);
  });

  it("asks for another plan ref instead of migrate in a pinned plan (application repository)", () => {
    const dir = writeDir({ "old.yaml": dict("a", "2026-01") });
    const { issues } = loadDictionaries(dir, "2026-09", { pinnedPlan: true });
    expect(issues).toEqual([
      {
        file: "old.yaml",
        path: "opentp",
        message:
          "Unsupported OpenTrackPlan schema version '2026-01'. Expected '2026-09'. Pin a plan ref whose files are all on 2026-09.",
      },
    ]);
  });

  it("never reads the plan root's tool files as dictionaries", () => {
    const root = writeDir({
      "opentp.yaml": "opentp: 2026-09\n",
      "opentp.cli.yml": "opentp: 2026-09\n",
      "areas.yaml": dict("auth"),
    });
    const { dictionaries, issues } = loadDictionaries(root, "2026-09", {
      skipFiles: rootToolFiles(root),
    });
    expect([...dictionaries.keys()]).toEqual(["areas"]);
    expect(issues).toEqual([]);
  });
});
