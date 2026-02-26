import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startWatcher } from "./watcher";

describe("watcher", () => {
  let testDir: string;

  beforeEach(() => {
    // Unique directory per test to avoid macOS FSEvents cross-contamination
    testDir = join(
      tmpdir(),
      `opentp-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("detects new YAML files", async () => {
    await mkdir(join(testDir, "events"), { recursive: true });

    const onChange = vi.fn();
    const watcher = startWatcher({ root: testDir, onChange });

    try {
      // Small delay to let watcher settle before writing
      await new Promise((r) => setTimeout(r, 100));

      await writeFile(join(testDir, "events", "test.yaml"), "test: true");

      // Wait for watcher to fire (debounce + OS delay)
      await new Promise((r) => setTimeout(r, 500));

      expect(onChange).toHaveBeenCalled();
      const call = onChange.mock.calls[0][0];
      expect(call.path).toContain("events");
      expect(call.path).toContain("test.yaml");
    } finally {
      watcher.stop();
    }
  });

  it("ignores non-YAML files", async () => {
    await mkdir(join(testDir, "events"), { recursive: true });

    const onChange = vi.fn();
    const watcher = startWatcher({ root: testDir, onChange });

    try {
      // Small delay to let watcher settle before writing
      await new Promise((r) => setTimeout(r, 100));

      await writeFile(join(testDir, "events", "readme.md"), "# test");

      await new Promise((r) => setTimeout(r, 500));

      expect(onChange).not.toHaveBeenCalled();
    } finally {
      watcher.stop();
    }
  });

  it("detects changes to opentp.yaml", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "opentp.yaml"), "opentp: 2026-01");

    // Small delay before starting watcher so initial write settles
    await new Promise((r) => setTimeout(r, 100));

    const onChange = vi.fn();
    const watcher = startWatcher({ root: testDir, onChange });

    try {
      await new Promise((r) => setTimeout(r, 100));

      // Modify config file
      await writeFile(join(testDir, "opentp.yaml"), "opentp: 2026-01\n# changed");

      await new Promise((r) => setTimeout(r, 500));

      expect(onChange).toHaveBeenCalled();
      const call = onChange.mock.calls[0][0];
      expect(call.path).toBe("opentp.yaml");
      expect(call.type).toBe("update");
    } finally {
      watcher.stop();
    }
  });

  it("respects custom extensions filter", async () => {
    await mkdir(join(testDir, "events"), { recursive: true });

    const onChange = vi.fn();
    const watcher = startWatcher({
      root: testDir,
      onChange,
      extensions: [".json"],
    });

    try {
      await new Promise((r) => setTimeout(r, 100));

      // YAML should be ignored with custom extensions
      await writeFile(join(testDir, "events", "test.yaml"), "test: true");
      await new Promise((r) => setTimeout(r, 500));
      expect(onChange).not.toHaveBeenCalled();

      // JSON should be detected
      await writeFile(join(testDir, "events", "test.json"), '{"test": true}');
      await new Promise((r) => setTimeout(r, 500));
      expect(onChange).toHaveBeenCalled();
    } finally {
      watcher.stop();
    }
  });
});
