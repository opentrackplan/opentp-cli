import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// An unexpected error while an event file is edited (a bug in an edit)
vi.mock("./events", async (importOriginal) => {
  const original = await importOriginal<typeof import("./events")>();
  return {
    ...original,
    migrateEventFile: () => {
      throw new TypeError("Cannot read properties of null (reading 'items')");
    },
  };
});

const { migrate } = await import("./index");

const FIXTURE = path.join(process.cwd(), "tests", "data", "migrate-2026-01");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-migrate-internal-"));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("opentp migrate: internal errors", () => {
  it("become a clean error with the file, and nothing is written (exit 1)", async () => {
    const root = path.join(tmpRoot, "plan");
    fs.cpSync(FIXTURE, root, { recursive: true });
    const before = fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8");
    const result = await migrate({ root, mode: "write" });
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      {
        file: "dictionaries/data/application_id.yaml",
        path: "",
        message:
          "Internal error (Cannot read properties of null (reading 'items')); nothing was written. Please report this with the original file",
      },
    ]);
    expect(fs.readFileSync(path.join(root, "opentp.yaml"), "utf-8")).toBe(before);
    expect(fs.existsSync(path.join(root, "opentp.cli.yaml"))).toBe(false);
  });
});
