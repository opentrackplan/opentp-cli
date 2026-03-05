import { type FSWatcher, watch } from "node:fs";
import { extname, join } from "node:path";

export type FileChangeHandler = (event: {
  type: "create" | "update" | "delete";
  path: string; // relative path from root
}) => void;

export interface WatcherOptions {
  root: string; // tracking plan root directory
  onChange: FileChangeHandler;
  /** File extensions to watch (default: [".yaml", ".yml"]) */
  extensions?: string[];
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as unknown as T;
}

export function startWatcher(options: WatcherOptions): { stop: () => void } {
  const extensions = options.extensions ?? [".yaml", ".yml"];
  const watchers: FSWatcher[] = [];
  const debouncedOnChange = debounce(options.onChange, 100);

  // Watch the events and dictionaries directories
  // Don't watch the entire root (might include node_modules, .git, etc.)
  const watchDirs = ["events", "dictionaries"];

  for (const dir of watchDirs) {
    const dirPath = join(options.root, dir);

    try {
      const watcher = watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const ext = extname(filename);
        if (!extensions.includes(ext)) return;

        const relativePath = join(dir, filename);

        // fs.watch eventType is "rename" (create/delete) or "change" (update)
        debouncedOnChange({
          type: eventType === "rename" ? "create" : "update",
          path: relativePath,
        });
      });

      watchers.push(watcher);
    } catch {
      // Directory might not exist — that's ok
      console.warn(`  Warning: Could not watch ${dir}/ directory`);
    }
  }

  // Also watch opentp.yaml itself
  try {
    const configWatcher = watch(join(options.root, "opentp.yaml"), () => {
      debouncedOnChange({
        type: "update",
        path: "opentp.yaml",
      });
    });
    watchers.push(configWatcher);
  } catch {
    console.warn("  Warning: Could not watch opentp.yaml");
  }

  return {
    stop() {
      for (const w of watchers) {
        w.close();
      }
    },
  };
}
