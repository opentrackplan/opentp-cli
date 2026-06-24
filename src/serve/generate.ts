import * as fs from "node:fs";
import * as path from "node:path";
import JSZip from "jszip";
import {
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
} from "../core/config";
import { loadDictionaries } from "../core/dict";
import { loadEvents } from "../core/event";
import { getGenerator, getGeneratorNames } from "../generators";
import type { GeneratorContext } from "../generators/types";
import type { OpenTPConfig, ResolvedEvent } from "../types";
import { json, jsonError } from "./helpers";
import type { Router } from "./router";

// ── Internal helpers ──────────────────────────────────────

interface LoadedPlan {
  config: OpenTPConfig;
  events: ResolvedEvent[];
  eventsPath: string;
  dictsPath: string | null;
  dictionaries: Map<string, (string | number | boolean)[]>;
  configFilePath: string;
}

function loadPlan(root: string): LoadedPlan {
  const configFilePath = findConfigFile(root);
  if (!configFilePath) {
    throw new Error("opentp.yaml not found in project root");
  }

  const config = loadConfig(configFilePath);

  const dictsPath = getDictsPath(config, root);
  let dictionaries = new Map<string, (string | number | boolean)[]>();
  if (dictsPath) {
    const result = loadDictionaries(dictsPath, config.opentp);
    dictionaries = result.dictionaries;
  }

  const eventsPath = getEventsPath(config, root);
  const eventsTemplate = getEventsTemplate(config);
  if (!eventsPath || !eventsTemplate) {
    throw new Error("Events path not configured in opentp.yaml");
  }

  const events = loadEvents(eventsPath, eventsTemplate, config);

  return { config, events, eventsPath, dictsPath, dictionaries, configFilePath };
}

/** Map generator name to a default output filename */
function generatorFilename(name: string): string {
  const mapping: Record<string, string> = {
    "ts-sdk": "tracker.ts",
    "swift-sdk": "Events.swift",
    "kotlin-sdk": "Events.kt",
    json: "tracking-plan.json",
    yaml: "tracking-plan.yaml",
  };
  return mapping[name] ?? `${name}.out`;
}

/** Recursively collect all files under a directory, returning relative paths */
function collectFiles(
  dir: string,
  base?: string,
): { relativePath: string; absolutePath: string }[] {
  const result: { relativePath: string; absolutePath: string }[] = [];
  if (!fs.existsSync(dir)) return result;

  const baseDir = base ?? dir;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath, baseDir));
    } else {
      result.push({
        relativePath: path.relative(baseDir, fullPath),
        absolutePath: fullPath,
      });
    }
  }

  return result;
}

// ── Route registration ────────────────────────────────────

export function registerGenerateRoutes(router: Router, root: string): void {
  // GET /api/generators
  router.get("/api/generators", (_req, res) => {
    try {
      const plan = loadPlan(root);
      const exportConfig = plan.config.spec.export;

      let generators: Array<{ name: string; target?: string; standalone?: boolean }>;
      if (exportConfig?.generators && exportConfig.generators.length > 0) {
        generators = exportConfig.generators;
      } else {
        generators = getGeneratorNames().map((name) => ({ name }));
      }

      const bundleEnabled = exportConfig?.bundle ?? false;
      json(res, { generators, bundleEnabled });
    } catch (err) {
      jsonError(res, `Failed to list generators: ${(err as Error).message}`, 500);
    }
  });

  // GET /api/generate/:name
  router.get("/api/generate/:name", (_req, res, params) => {
    try {
      const generatorName = params.name;
      const generator = getGenerator(generatorName);
      if (!generator) {
        jsonError(res, `Generator not found: ${generatorName}`, 404);
        return;
      }

      const plan = loadPlan(root);

      // Build options from config defaults + query param overrides
      const url = new URL(_req.url ?? "/", `http://${_req.headers.host}`);
      const configEntry = plan.config.spec.export?.generators?.find(
        (g) => g.name === generatorName,
      );

      const target = url.searchParams.get("target") ?? configEntry?.target;
      const standaloneParam = url.searchParams.get("standalone");
      const standalone =
        standaloneParam !== null ? standaloneParam === "true" : configEntry?.standalone;

      const context: GeneratorContext = {
        config: plan.config,
        events: plan.events,
        dictionaries: plan.dictionaries,
        options: {
          target,
          standalone,
        },
      };

      const result = generator.generate(context);
      const content =
        typeof result === "object" && "then" in result
          ? undefined
          : (result.stdout ?? result.files?.[0]?.content ?? "");

      if (content === undefined) {
        // Handle async generators
        (result as Promise<typeof result>)
          .then((asyncResult) => {
            const output =
              ("stdout" in asyncResult ? asyncResult.stdout : asyncResult.files?.[0]?.content) ??
              "";
            const filename = generatorFilename(generatorName);
            res.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              "Content-Disposition": `attachment; filename="${filename}"`,
            });
            res.end(output);
          })
          .catch((err) => {
            jsonError(res, `Generation failed: ${(err as Error).message}`, 500);
          });
        return;
      }

      const filename = generatorFilename(generatorName);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      res.end(content);
    } catch (err) {
      jsonError(res, `Generation failed: ${(err as Error).message}`, 500);
    }
  });

  // GET /api/export/bundle
  router.get("/api/export/bundle", async (_req, res) => {
    try {
      const plan = loadPlan(root);
      const zip = new JSZip();

      // Add config file
      const configContent = fs.readFileSync(plan.configFilePath, "utf-8");
      zip.file("opentp.yaml", configContent);

      // Add event files
      if (plan.eventsPath && fs.existsSync(plan.eventsPath)) {
        const eventFiles = collectFiles(plan.eventsPath);
        for (const file of eventFiles) {
          const content = fs.readFileSync(file.absolutePath, "utf-8");
          zip.file(path.join("events", file.relativePath), content);
        }
      }

      // Add dictionary files
      if (plan.dictsPath && fs.existsSync(plan.dictsPath)) {
        const dictFiles = collectFiles(plan.dictsPath);
        for (const file of dictFiles) {
          const content = fs.readFileSync(file.absolutePath, "utf-8");
          zip.file(path.join("dictionaries", file.relativePath), content);
        }
      }

      // Generate SDKs
      const exportConfig = plan.config.spec.export;
      const generatorConfigs = exportConfig?.generators?.length
        ? exportConfig.generators
        : getGeneratorNames().map((name) => ({ name }));

      for (const genConfig of generatorConfigs) {
        const generator = getGenerator(genConfig.name);
        if (!generator) continue;

        try {
          const context: GeneratorContext = {
            config: plan.config,
            events: plan.events,
            dictionaries: plan.dictionaries,
            options: {
              target: genConfig.target,
              standalone: genConfig.standalone,
            },
          };

          const result = await generator.generate(context);
          const content = result.stdout ?? result.files?.[0]?.content;
          if (content) {
            const filename = generatorFilename(genConfig.name);
            zip.file(path.join("generated", filename), content);
          }
        } catch {
          // Skip generators that fail (e.g. missing target)
        }
      }

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="tracking-plan.zip"',
      });
      res.end(zipBuffer);
    } catch (err) {
      jsonError(res, `Bundle export failed: ${(err as Error).message}`, 500);
    }
  });
}
