import * as fs from "node:fs";
import * as path from "node:path";
import {
  findConfigFile,
  getDictsPath,
  getEventsPath,
  getEventsTemplate,
  loadConfig,
} from "../core/config";
import { type DictionaryIssue, type DictionaryMeta, loadDictionaries } from "../core/dict";
import { loadEvents } from "../core/event";
import { resolveEventPayload } from "../core/payload";
import { validateEvents } from "../core/validator";
import { SPEC_VERSION } from "../meta";
import { createTransforms } from "../transforms";
import type { OpenTPConfig, ResolvedEvent, ValidationError } from "../types";
import { ensureDir, fileExists, filterByExtension, saveYaml, scanDirectory } from "../util/files";
import { applyPattern, getPatternVariables } from "../util/pattern";
import { json, jsonError, parseBody } from "./helpers";
import type { Router } from "./router";

/**
 * Walk all event YAML files and replace `dict: oldKey` with `dict: newKey`.
 * Uses raw text replacement scoped to `dict:` lines to avoid re-serializing
 * the entire YAML (which could alter formatting/comments).
 */
function updateDictReferencesInEvents(eventsPath: string, oldKey: string, newKey: string): void {
  const allFiles = scanDirectory(eventsPath);
  const yamlFiles = filterByExtension(allFiles, [".yaml", ".yml"]);

  for (const [, absolutePath] of yamlFiles) {
    const content = fs.readFileSync(absolutePath, "utf-8");
    // Match lines like `  dict: old/key` or `  dict: "old/key"`
    const pattern = new RegExp(
      `^(\\s+dict:\\s*)(?:["']?)${escapeRegex(oldKey)}(?:["']?)\\s*$`,
      "gm",
    );
    if (!pattern.test(content)) continue;
    const updated = content.replace(pattern, `$1${newKey}`);
    fs.writeFileSync(absolutePath, updated, "utf-8");
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Internal helpers ──────────────────────────────────────

interface TrackingPlan {
  config: OpenTPConfig;
  events: ResolvedEvent[];
  eventsPath: string;
  eventsTemplate: string;
  dictsPath: string | null;
  dictionaries: Map<string, (string | number | boolean)[]>;
  dictMeta: Map<string, DictionaryMeta>;
  dictIssues: DictionaryIssue[];
}

function loadTrackingPlan(root: string): TrackingPlan {
  const configPath = findConfigFile(root);
  if (!configPath) {
    throw new Error("opentp.yaml not found in project root");
  }

  const config = loadConfig(configPath);

  // Load dictionaries
  const dictsPath = getDictsPath(config, root);
  let dictionaries = new Map<string, (string | number | boolean)[]>();
  let dictMeta = new Map<string, DictionaryMeta>();
  let dictIssues: DictionaryIssue[] = [];
  if (dictsPath) {
    const result = loadDictionaries(dictsPath, config.opentp);
    dictionaries = result.dictionaries;
    dictMeta = result.dictMeta;
    dictIssues = result.issues;
  }

  // Load events
  const eventsPath = getEventsPath(config, root);
  const eventsTemplate = getEventsTemplate(config);
  if (!eventsPath || !eventsTemplate) {
    throw new Error("Events path not configured in opentp.yaml");
  }

  const events = loadEvents(eventsPath, eventsTemplate, config);

  return {
    config,
    events,
    eventsPath,
    eventsTemplate,
    dictsPath,
    dictionaries,
    dictMeta,
    dictIssues,
  };
}

/** Generate file path from taxonomy data using the events template */
export function taxonomyToFilePath(
  taxonomy: Record<string, unknown>,
  template: string,
  eventsPath: string,
): string {
  const varNames = getPatternVariables(template);
  const variables: Record<string, string> = {};

  for (const varName of varNames) {
    const value = taxonomy[varName];
    if (value === undefined || value === null) {
      throw new Error(`Missing taxonomy field '${varName}' required by template '${template}'`);
    }
    variables[varName] = String(value);
  }

  const relativePath = applyPattern(template, variables, {});
  return path.join(eventsPath, relativePath);
}

function buildEventYaml(input: {
  key: string;
  taxonomy: Record<string, unknown>;
  lifecycle?: Record<string, unknown>;
  aliases?: unknown[];
  payload: unknown;
}): Record<string, unknown> {
  const event: Record<string, unknown> = {
    key: input.key,
    taxonomy: input.taxonomy,
  };
  if (input.lifecycle) {
    event.lifecycle = input.lifecycle;
  }
  if (input.aliases) {
    event.aliases = input.aliases;
  }
  event.payload = input.payload;

  return { opentp: SPEC_VERSION, event };
}

interface GroupedValidation {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  events: Record<
    string,
    {
      errors: Array<{ path: string; message: string }>;
      warnings: Array<{ path: string; message: string }>;
    }
  >;
}

function groupValidationErrors(errors: ValidationError[]): GroupedValidation {
  let errorCount = 0;
  let warningCount = 0;
  const events: GroupedValidation["events"] = {};

  for (const err of errors) {
    if (!events[err.event]) {
      events[err.event] = { errors: [], warnings: [] };
    }
    const item = { path: err.path, message: err.message };
    if (err.severity === "warning") {
      events[err.event].warnings.push(item);
      warningCount++;
    } else {
      events[err.event].errors.push(item);
      errorCount++;
    }
  }

  return { valid: errorCount === 0, errorCount, warningCount, events };
}

// ── Route registration ────────────────────────────────────

export function registerApiRoutes(router: Router, root: string): void {
  // GET /api/config
  router.get("/api/config", (_req, res) => {
    try {
      const { config } = loadTrackingPlan(root);
      json(res, config);
    } catch (err) {
      jsonError(res, `Failed to load config: ${(err as Error).message}`, 500);
    }
  });

  // GET /api/events
  router.get("/api/events", (_req, res) => {
    try {
      const { events } = loadTrackingPlan(root);
      const result = events.map((e) => ({
        key: e.key,
        relativePath: e.relativePath,
        taxonomy: e.taxonomy,
        lifecycle: e.lifecycle,
        aliases: e.aliases,
        payload: e.payload,
      }));
      json(res, result);
    } catch (err) {
      jsonError(res, `Failed to load events: ${(err as Error).message}`, 500);
    }
  });

  // GET /api/events/:key
  router.get("/api/events/:key", (_req, res, params) => {
    try {
      const { events, config } = loadTrackingPlan(root);
      const event = events.find((e) => e.key === params.key);
      if (!event) {
        jsonError(res, `Event not found: ${params.key}`, 404);
        return;
      }

      const { payload: resolvedPayload, issues: payloadIssues } = resolveEventPayload(
        event.payload,
        config,
      );

      json(res, {
        key: event.key,
        relativePath: event.relativePath,
        taxonomy: event.taxonomy,
        lifecycle: event.lifecycle,
        aliases: event.aliases,
        payload: event.payload,
        resolvedPayload,
        payloadIssues,
      });
    } catch (err) {
      jsonError(res, `Failed to load event: ${(err as Error).message}`, 500);
    }
  });

  // POST /api/events
  router.post("/api/events", async (req, res) => {
    try {
      const body = await parseBody(req);
      if (!body || typeof body !== "object") {
        jsonError(res, "Request body must be a JSON object");
        return;
      }

      const input = body as Record<string, unknown>;
      if (!input.key || typeof input.key !== "string") {
        jsonError(res, "Missing required field: key");
        return;
      }
      if (!input.taxonomy || typeof input.taxonomy !== "object") {
        jsonError(res, "Missing required field: taxonomy");
        return;
      }
      if (!input.payload) {
        jsonError(res, "Missing required field: payload");
        return;
      }

      const plan = loadTrackingPlan(root);

      // Validate key format against configured pattern
      const keyPattern = plan.config.spec.events?.key?.pattern;
      if (keyPattern) {
        const regex = new RegExp(keyPattern);
        if (!regex.test(input.key as string)) {
          jsonError(res, `Invalid key format: '${input.key}' does not match pattern ${keyPattern}`);
          return;
        }
      }

      // Check for duplicate key
      const existing = plan.events.find((e) => e.key === input.key);
      if (existing) {
        jsonError(
          res,
          `Event with key '${input.key}' already exists at ${existing.relativePath}`,
          409,
        );
        return;
      }

      // Generate file path from taxonomy + template
      const filePath = taxonomyToFilePath(
        input.taxonomy as Record<string, unknown>,
        plan.eventsTemplate,
        plan.eventsPath,
      );

      // Check file doesn't already exist
      if (fileExists(filePath)) {
        jsonError(res, `File already exists at path: ${path.relative(root, filePath)}`, 409);
        return;
      }

      // Build and write YAML
      const yamlData = buildEventYaml({
        key: input.key as string,
        taxonomy: input.taxonomy as Record<string, unknown>,
        lifecycle: input.lifecycle as Record<string, unknown> | undefined,
        aliases: input.aliases as unknown[] | undefined,
        payload: input.payload,
      });

      ensureDir(path.dirname(filePath));
      saveYaml(filePath, yamlData);

      json(res, { created: true, key: input.key, filePath: path.relative(root, filePath) }, 201);
    } catch (err) {
      jsonError(res, `Failed to create event: ${(err as Error).message}`, 500);
    }
  });

  // PUT /api/events/:key
  router.put("/api/events/:key", async (req, res, params) => {
    try {
      const body = await parseBody(req);
      if (!body || typeof body !== "object") {
        jsonError(res, "Request body must be a JSON object");
        return;
      }

      const input = body as Record<string, unknown>;
      const plan = loadTrackingPlan(root);

      const event = plan.events.find((e) => e.key === params.key);
      if (!event) {
        jsonError(res, `Event not found: ${params.key}`, 404);
        return;
      }

      const mergedTaxonomy = input.taxonomy
        ? {
            ...(event.taxonomy as Record<string, unknown>),
            ...(input.taxonomy as Record<string, unknown>),
          }
        : (event.taxonomy as Record<string, unknown>);

      // Compute new file path from updated taxonomy
      const newFilePath = taxonomyToFilePath(mergedTaxonomy, plan.eventsTemplate, plan.eventsPath);
      const newRelativePath = path.relative(root, newFilePath);

      // If the path changed, check for conflicts and rename
      const pathChanged = newFilePath !== event.filePath;
      if (pathChanged) {
        if (fileExists(newFilePath)) {
          jsonError(res, `Cannot rename: file already exists at ${newRelativePath}`, 409);
          return;
        }
        ensureDir(path.dirname(newFilePath));
      }

      // Use client-provided key if available, otherwise keep the old key
      const newKey = typeof input.key === "string" && input.key ? input.key : params.key;

      // Merge provided fields over existing event data
      const yamlData = buildEventYaml({
        key: newKey,
        taxonomy: mergedTaxonomy,
        lifecycle:
          (input.lifecycle as Record<string, unknown>) ??
          (event.lifecycle as Record<string, unknown>),
        aliases: (input.aliases as unknown[]) ?? (event.aliases as unknown[]),
        payload: input.payload ?? event.payload,
      });

      saveYaml(newFilePath, yamlData);

      // Remove old file if path changed
      if (pathChanged) {
        fs.unlinkSync(event.filePath);
        // Clean up empty parent directories
        let dir = path.dirname(event.filePath);
        while (dir !== plan.eventsPath && dir.startsWith(plan.eventsPath)) {
          const entries = fs.readdirSync(dir);
          if (entries.length > 0) break;
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        }
      }

      json(res, { updated: true, key: newKey, filePath: newRelativePath });
    } catch (err) {
      jsonError(res, `Failed to update event: ${(err as Error).message}`, 500);
    }
  });

  // DELETE /api/events/:key
  router.delete("/api/events/:key", async (_req, res, params) => {
    try {
      const plan = loadTrackingPlan(root);
      const event = plan.events.find((e) => e.key === params.key);
      if (!event) {
        jsonError(res, `Event not found: ${params.key}`, 404);
        return;
      }

      fs.unlinkSync(event.filePath);

      // Clean up empty parent directories
      let dir = path.dirname(event.filePath);
      while (dir !== plan.eventsPath && dir.startsWith(plan.eventsPath)) {
        const entries = fs.readdirSync(dir);
        if (entries.length > 0) break;
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      }

      json(res, { deleted: true, key: params.key });
    } catch (err) {
      jsonError(res, `Failed to delete event: ${(err as Error).message}`, 500);
    }
  });

  // GET /api/dictionaries
  router.get("/api/dictionaries", (_req, res) => {
    try {
      const { dictMeta, dictIssues } = loadTrackingPlan(root);

      const dictObj: Record<string, { type: string; values: (string | number | boolean)[] }> = {};
      for (const [key, meta] of dictMeta) {
        dictObj[key] = { type: meta.type, values: meta.values };
      }

      json(res, { dictionaries: dictObj, issues: dictIssues });
    } catch (err) {
      jsonError(res, `Failed to load dictionaries: ${(err as Error).message}`, 500);
    }
  });

  // GET /api/dictionaries/:key
  router.get("/api/dictionaries/:key", (_req, res, params) => {
    try {
      const { dictMeta } = loadTrackingPlan(root);
      const meta = dictMeta.get(params.key);
      if (!meta) {
        jsonError(res, `Dictionary not found: ${params.key}`, 404);
        return;
      }
      json(res, { key: params.key, type: meta.type, values: meta.values });
    } catch (err) {
      jsonError(res, `Failed to load dictionary: ${(err as Error).message}`, 500);
    }
  });

  // POST /api/dictionaries
  router.post("/api/dictionaries", async (req, res) => {
    try {
      const body = await parseBody(req);
      if (!body || typeof body !== "object") {
        jsonError(res, "Request body must be a JSON object");
        return;
      }

      const input = body as Record<string, unknown>;

      if (!input.key || typeof input.key !== "string") {
        jsonError(res, "Missing required field: key");
        return;
      }
      if (!input.type || typeof input.type !== "string") {
        jsonError(res, "Missing required field: type");
        return;
      }
      if (!Array.isArray(input.values)) {
        jsonError(res, "Missing required field: values (must be an array)");
        return;
      }

      const key = input.key as string;

      if (key.includes("..") || key.startsWith("/")) {
        jsonError(res, "Invalid dictionary key: must not start with '/' or contain '..'");
        return;
      }

      const plan = loadTrackingPlan(root);
      if (!plan.dictsPath) {
        jsonError(res, "Dictionaries path not configured in opentp.yaml", 500);
        return;
      }

      if (plan.dictionaries.has(key)) {
        jsonError(res, `Dictionary with key '${key}' already exists`, 409);
        return;
      }

      const filePath = path.join(plan.dictsPath, `${key}.yaml`);

      if (fileExists(filePath)) {
        jsonError(res, `File already exists at path: ${path.relative(root, filePath)}`, 409);
        return;
      }

      const yamlData = {
        opentp: SPEC_VERSION,
        dict: {
          type: input.type,
          values: input.values,
        },
      };

      ensureDir(path.dirname(filePath));
      saveYaml(filePath, yamlData);

      json(res, { created: true, key, filePath: path.relative(root, filePath) }, 201);
    } catch (err) {
      jsonError(res, `Failed to create dictionary: ${(err as Error).message}`, 500);
    }
  });

  // PUT /api/dictionaries/:key
  router.put("/api/dictionaries/:key", async (req, res, params) => {
    try {
      const body = await parseBody(req);
      if (!body || typeof body !== "object") {
        jsonError(res, "Request body must be a JSON object");
        return;
      }

      const input = body as Record<string, unknown>;
      const plan = loadTrackingPlan(root);

      if (!plan.dictsPath) {
        jsonError(res, "Dictionaries path not configured in opentp.yaml", 500);
        return;
      }

      const oldKey = params.key;
      const existingMeta = plan.dictMeta.get(oldKey);
      if (!existingMeta) {
        jsonError(res, `Dictionary not found: ${oldKey}`, 404);
        return;
      }

      const newKey = typeof input.key === "string" && input.key ? input.key : oldKey;
      const newValues = Array.isArray(input.values) ? input.values : existingMeta.values;
      const newType = typeof input.type === "string" ? input.type : existingMeta.type;

      const isRename = newKey !== oldKey;

      if (isRename) {
        // Validate new key
        if (newKey.includes("..") || newKey.startsWith("/")) {
          jsonError(res, "Invalid dictionary key: must not start with '/' or contain '..'");
          return;
        }

        // Check for conflicts
        if (plan.dictionaries.has(newKey)) {
          jsonError(res, `Dictionary with key '${newKey}' already exists`, 409);
          return;
        }

        const newFilePath = path.join(plan.dictsPath, `${newKey}.yaml`);
        if (fileExists(newFilePath)) {
          jsonError(
            res,
            `Cannot rename: file already exists at ${path.relative(root, newFilePath)}`,
            409,
          );
          return;
        }
      }

      const oldFilePath = path.join(plan.dictsPath, `${oldKey}.yaml`);
      const newFilePath = path.join(plan.dictsPath, `${newKey}.yaml`);

      const yamlData = {
        opentp: SPEC_VERSION,
        dict: {
          type: newType,
          values: newValues,
        },
      };

      ensureDir(path.dirname(newFilePath));
      saveYaml(newFilePath, yamlData);

      if (isRename) {
        // Update dict references in all event YAML files
        updateDictReferencesInEvents(plan.eventsPath, oldKey, newKey);

        // Remove old file
        fs.unlinkSync(oldFilePath);

        // Clean up empty parent directories
        let dir = path.dirname(oldFilePath);
        while (dir !== plan.dictsPath && dir.startsWith(plan.dictsPath)) {
          const entries = fs.readdirSync(dir);
          if (entries.length > 0) break;
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        }
      }

      json(res, { updated: true, key: newKey, filePath: path.relative(root, newFilePath) });
    } catch (err) {
      jsonError(res, `Failed to update dictionary: ${(err as Error).message}`, 500);
    }
  });

  // DELETE /api/dictionaries/:key
  router.delete("/api/dictionaries/:key", async (_req, res, params) => {
    try {
      const plan = loadTrackingPlan(root);

      if (!plan.dictsPath) {
        jsonError(res, "Dictionaries path not configured in opentp.yaml", 500);
        return;
      }

      const key = params.key;
      if (!plan.dictionaries.has(key)) {
        jsonError(res, `Dictionary not found: ${key}`, 404);
        return;
      }

      const filePath = path.join(plan.dictsPath, `${key}.yaml`);
      fs.unlinkSync(filePath);

      // Clean up empty parent directories
      let dir = path.dirname(filePath);
      while (dir !== plan.dictsPath && dir.startsWith(plan.dictsPath)) {
        const entries = fs.readdirSync(dir);
        if (entries.length > 0) break;
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      }

      json(res, { deleted: true, key });
    } catch (err) {
      jsonError(res, `Failed to delete dictionary: ${(err as Error).message}`, 500);
    }
  });

  // POST /api/validate
  router.post("/api/validate", async (req, res) => {
    try {
      const plan = loadTrackingPlan(root);

      // Prepend dictionary issues as validation errors (same as cli.ts)
      const dictErrors: ValidationError[] = plan.dictIssues.map((issue) => ({
        event: `dictionaries/${issue.file}`,
        path: issue.path,
        message: issue.message,
        severity: "error" as const,
      }));

      const body = await parseBody(req);
      const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

      // Determine events to validate
      let eventsToValidate = plan.events;

      if (input.draft && typeof input.draft === "object") {
        // Validate an unsaved draft event (e.g. before first save)
        const draft = input.draft as Record<string, unknown>;
        if (!draft.key || typeof draft.key !== "string") {
          jsonError(res, "Draft must have a key");
          return;
        }

        // Coerce taxonomy values to their declared types (UI sends strings from form elements)
        const rawTaxonomy = (draft.taxonomy as Record<string, unknown>) ?? {};
        const taxonomyConfig = plan.config.spec.events.taxonomy;
        const coercedTaxonomy: Record<string, unknown> = { ...rawTaxonomy };
        for (const [fieldName, fieldConfig] of Object.entries(taxonomyConfig)) {
          const val = coercedTaxonomy[fieldName];
          if (
            typeof val === "string" &&
            (fieldConfig.type === "number" || fieldConfig.type === "integer")
          ) {
            const num = Number(val);
            if (Number.isFinite(num)) coercedTaxonomy[fieldName] = num;
          } else if (typeof val === "string" && fieldConfig.type === "boolean") {
            const lc = val.trim().toLowerCase();
            if (lc === "true") coercedTaxonomy[fieldName] = true;
            else if (lc === "false") coercedTaxonomy[fieldName] = false;
          }
        }

        // Generate expectedKey from keygen template (same as loadEvents)
        const keygen = plan.config.spec.events["x-opentp"]?.keygen;
        let expectedKey: string | null = null;
        if (keygen && typeof keygen.template === "string") {
          const keygenTransforms = createTransforms(keygen.transforms ?? {});
          const variables: Record<string, string> = {};
          for (const [k, v] of Object.entries(coercedTaxonomy)) {
            if (v !== undefined && v !== null) variables[k] = String(v);
          }
          try {
            expectedKey = applyPattern(keygen.template, variables, keygenTransforms);
          } catch {
            // If key generation fails (missing variables), leave as null
          }
        }

        const draftEvent: ResolvedEvent = {
          filePath: "",
          relativePath: `draft/${draft.key}`,
          opentp: plan.config.opentp,
          key: draft.key,
          expectedKey,
          taxonomy: coercedTaxonomy,
          lifecycle: draft.lifecycle as ResolvedEvent["lifecycle"],
          aliases: draft.aliases as ResolvedEvent["aliases"],
          ignore: [],
          payload: (draft.payload ?? {}) as ResolvedEvent["payload"],
        };
        eventsToValidate = [draftEvent];
      } else if (input.key && typeof input.key === "string") {
        // Filter to single existing event by key
        eventsToValidate = plan.events.filter((e) => e.key === input.key);
        if (eventsToValidate.length === 0) {
          jsonError(res, `Event not found: ${input.key}`, 404);
          return;
        }
      }

      const eventErrors = await validateEvents(eventsToValidate, plan.config, plan.dictionaries);

      const allErrors = [...dictErrors, ...eventErrors];
      const grouped = groupValidationErrors(allErrors);

      json(res, {
        valid: grouped.valid,
        eventCount: eventsToValidate.length,
        errorCount: grouped.errorCount,
        warningCount: grouped.warningCount,
        events: grouped.events,
      });
    } catch (err) {
      jsonError(res, `Validation failed: ${(err as Error).message}`, 500);
    }
  });
}
