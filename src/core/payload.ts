import type {
  EventPayload,
  Field,
  OpenTPConfig,
  PayloadVersion,
  ResolvedEventPayload,
  ResolvedPayloadVersion,
  ResolvedTargetPayload,
  TargetPayload,
  VersionedTargetPayload,
} from "../types";

export interface PayloadIssue {
  path: string;
  message: string;
}

export const UNVERSIONED_VERSION_KEY = "__unversioned__";

interface NormalizedTargetPayload {
  isUnversioned: boolean;
  currentRef: string;
  aliases: Record<string, string>;
  versions: Record<string, PayloadVersion>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPayloadVersion(value: unknown): value is PayloadVersion {
  return isPlainObject(value) && isPlainObject((value as Record<string, unknown>).schema);
}

function isVersionedTargetPayload(value: unknown): value is VersionedTargetPayload {
  if (!isPlainObject(value)) return false;
  if (isPlainObject((value as Record<string, unknown>).schema)) return false; // versioned targets must not have top-level schema
  return typeof (value as Record<string, unknown>).current === "string";
}

function parseTargetPayload(
  payload: unknown,
  issues: PayloadIssue[],
  path: string,
): NormalizedTargetPayload {
  if (isPayloadVersion(payload)) {
    return {
      isUnversioned: true,
      currentRef: UNVERSIONED_VERSION_KEY,
      aliases: {},
      versions: { [UNVERSIONED_VERSION_KEY]: payload },
    };
  }

  if (!isVersionedTargetPayload(payload)) {
    issues.push({
      path,
      message: "Invalid target payload: expected {schema,...} or {current,...}",
    });
    return { isUnversioned: true, currentRef: UNVERSIONED_VERSION_KEY, aliases: {}, versions: {} };
  }

  const obj = payload as Record<string, unknown>;
  const versions: Record<string, PayloadVersion> = {};
  const aliases: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "current") continue;

    if (typeof value === "string") {
      aliases[key] = value;
      continue;
    }

    if (isPayloadVersion(value)) {
      versions[key] = value;
      continue;
    }

    issues.push({
      path: `${path}.${key}`,
      message: "Invalid version entry: expected string alias or {schema,...}",
    });
  }

  return {
    isUnversioned: false,
    currentRef: String(obj.current),
    aliases,
    versions,
  };
}

export function mergeSchemaMaps(
  base: Record<string, Field>,
  override: Record<string, Field>,
  issues?: PayloadIssue[],
  basePath?: string,
): Record<string, Field> {
  const out: Record<string, Field> = { ...base };
  for (const [name, overrideField] of Object.entries(override)) {
    const baseField = out[name];
    if (baseField) {
      if (issues && basePath) {
        checkFieldMergeConflicts(baseField, overrideField, issues, `${basePath}.schema.${name}`);
      }
      out[name] = mergeField(baseField, overrideField);
    } else {
      out[name] = overrideField;
    }
  }
  return out;
}

function checkFieldMergeConflicts(
  base: Field,
  override: Field,
  issues: PayloadIssue[],
  fieldPath: string,
): void {
  if (base.type && override.type && base.type !== override.type) {
    issues.push({
      path: fieldPath,
      message: `Field type conflict: base '${base.type}' vs override '${override.type}'`,
    });
  }

  if (base.required === true && override.required === false) {
    issues.push({
      path: fieldPath,
      message: "Cannot weaken required field (base required=true, override required=false)",
    });
  }

  if (base.valueRequired === true && override.valueRequired === false) {
    issues.push({
      path: fieldPath,
      message:
        "Cannot weaken valueRequired field (base valueRequired=true, override valueRequired=false)",
    });
  }

  if (base.valueRequired === true && override.required === false) {
    issues.push({
      path: fieldPath,
      message:
        "Cannot set required=false when base valueRequired=true (valueRequired implies required=true)",
    });
  }

  if (override.valueRequired === true && override.required === false) {
    issues.push({
      path: fieldPath,
      message:
        "Invalid field: valueRequired=true implies required=true (required=false is not allowed)",
    });
  }
}

export function mergeField(base: Field, override: Field): Field {
  const mergedPii =
    base.pii || override.pii ? { ...(base.pii ?? {}), ...(override.pii ?? {}) } : undefined;

  const baseX = base["x-opentp"];
  const overrideX = override["x-opentp"];
  const mergedX =
    baseX || overrideX
      ? {
          ...(baseX ?? {}),
          ...(overrideX ?? {}),
          checks:
            baseX?.checks || overrideX?.checks
              ? { ...(baseX?.checks ?? {}), ...(overrideX?.checks ?? {}) }
              : undefined,
        }
      : undefined;

  const merged: Field = {
    ...base,
    ...override,
    pii: mergedPii,
    "x-opentp": mergedX,
  };

  const overrideHasValue = override.value !== undefined;
  const overrideHasEnum = override.enum !== undefined;
  const overrideHasDict = override.dict !== undefined;

  if (overrideHasValue) {
    delete merged.enum;
    delete merged.dict;
  } else if (overrideHasEnum) {
    delete merged.value;
    delete merged.dict;
  } else if (overrideHasDict) {
    delete merged.value;
    delete merged.enum;
  }

  return merged;
}

function resolveAliasOrVersion(
  name: string,
  versions: Record<string, PayloadVersion>,
  aliases: Record<string, string>,
  issues: PayloadIssue[],
  path: string,
): string | null {
  const visited = new Set<string>();
  let cur = name;

  while (true) {
    if (visited.has(cur)) {
      issues.push({ path, message: `Alias cycle detected at '${cur}'` });
      return null;
    }
    visited.add(cur);

    if (versions[cur]) return cur;

    const next = aliases[cur];
    if (typeof next !== "string") {
      issues.push({ path, message: `Reference '${name}' does not resolve to a version key` });
      return null;
    }
    cur = next;
  }
}

function resolveAllAliases(
  versions: Record<string, PayloadVersion>,
  aliases: Record<string, string>,
  issues: PayloadIssue[],
  basePath: string,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [alias, ref] of Object.entries(aliases)) {
    const key = resolveAliasOrVersion(ref, versions, aliases, issues, `${basePath}.${alias}`);
    if (key) resolved[alias] = key;
  }
  return resolved;
}

function resolveRefSchema(
  versionKey: string,
  versions: Record<string, PayloadVersion>,
  resolvedAliases: Record<string, string>,
  issues: PayloadIssue[],
  stack: string[],
  cache: Map<string, Record<string, Field>>,
  basePath: string,
  resolveExternalSchema?: (ref: string, fromPath: string) => Record<string, Field> | null,
): Record<string, Field> {
  if (cache.has(versionKey)) return cache.get(versionKey)!;
  if (stack.includes(versionKey)) {
    issues.push({
      path: `${basePath}.${versionKey}.$ref`,
      message: `Cycle detected in $ref: ${stack.join(" -> ")}`,
    });
    return versions[versionKey]?.schema ?? {};
  }

  const version = versions[versionKey];
  if (!version) return {};

  stack.push(versionKey);

  let schema: Record<string, Field> = version.schema;
  const ref = version.$ref;
  if (typeof ref === "string" && ref.length > 0) {
    const refPath = `${basePath}.${versionKey}.$ref`;

    // Cross-target / cross-selector reference: <targetOrSelector>::<versionOrAlias>
    if (ref.includes("::")) {
      const externalSchema = resolveExternalSchema?.(ref, refPath);
      if (externalSchema) {
        schema = mergeSchemaMaps(externalSchema, schema, issues, `${basePath}.${versionKey}`);
      } else if (!resolveExternalSchema) {
        issues.push({ path: refPath, message: `Unknown $ref target '${ref}'` });
      }
    } else {
      const refKey = versions[ref]
        ? ref
        : resolvedAliases[ref]
          ? resolvedAliases[ref]
          : resolveAliasOrVersion(ref, versions, resolvedAliases, issues, refPath);
      if (refKey && refKey !== versionKey) {
        const baseSchema = resolveRefSchema(
          refKey,
          versions,
          resolvedAliases,
          issues,
          stack,
          cache,
          basePath,
          resolveExternalSchema,
        );
        schema = mergeSchemaMaps(baseSchema, schema, issues, `${basePath}.${versionKey}`);
      } else if (!refKey) {
        issues.push({ path: refPath, message: `Unknown $ref target '${ref}'` });
      }
    }
  } else if (ref !== undefined) {
    issues.push({ path: `${basePath}.${versionKey}.$ref`, message: "$ref must be a string" });
  }

  stack.pop();

  cache.set(versionKey, schema);
  return schema;
}

export function resolveEventPayload(
  payload: EventPayload,
  config: OpenTPConfig,
): { payload: ResolvedEventPayload; issues: PayloadIssue[] } {
  const issues: PayloadIssue[] = [];

  const targetsConfig = config.spec.events.payload.targets;
  const allTargets = targetsConfig.all ?? [];
  if (!Array.isArray(allTargets) || allTargets.length === 0) {
    issues.push({
      path: "spec.events.payload.targets.all",
      message: "Missing or empty targets.all",
    });
  }
  const allTargetSet = new Set(allTargets);

  // Normalize to selector map
  const selectorMap: Record<string, TargetPayload> = {};
  const raw = payload as unknown;

  if (isPayloadVersion(raw) || isVersionedTargetPayload(raw)) {
    selectorMap.all = raw as TargetPayload;
  } else if (isPlainObject(raw)) {
    for (const [selector, value] of Object.entries(raw)) {
      selectorMap[selector] = value as TargetPayload;
    }
  } else {
    issues.push({ path: "payload", message: "Invalid payload: expected object" });
  }

  if (isPlainObject(raw) && Object.keys(selectorMap).length === 0) {
    issues.push({
      path: "payload",
      message: "Payload is empty: expected 'schema' or target selectors",
    });
  }

  // Parse selectors
  const selectors: Array<{
    name: string;
    targets: ReadonlySet<string>;
    payload: NormalizedTargetPayload;
  }> = [];

  const selectorPayloads: Record<string, NormalizedTargetPayload> = {};

  for (const [selectorName, selectorPayload] of Object.entries(selectorMap)) {
    const parsedPayload = parseTargetPayload(selectorPayload, issues, `payload.${selectorName}`);
    selectorPayloads[selectorName] = parsedPayload;

    let selectorTargets: string[] | undefined;
    if (Array.isArray(targetsConfig[selectorName])) {
      selectorTargets = targetsConfig[selectorName];
    } else if (allTargets.includes(selectorName)) {
      selectorTargets = [selectorName];
    } else {
      issues.push({
        path: `payload.${selectorName}`,
        message: `Unknown target selector '${selectorName}'. Define it in spec.events.payload.targets or include it in targets.all.`,
      });
      continue;
    }

    selectors.push({
      name: selectorName,
      targets: new Set(selectorTargets),
      payload: parsedPayload,
    });
  }

  // Cross-target / cross-selector $ref resolution (tooling-defined syntax: <selector>::<versionOrAlias>)
  const selectorSchemaCache = new Map<string, Record<string, Field>>();

  function parseSelectorRef(
    ref: string,
    defaultSelector: string,
  ): { selector: string; name: string } | null {
    const idx = ref.indexOf("::");
    if (idx === -1) {
      return { selector: defaultSelector, name: ref };
    }

    const selector = ref.slice(0, idx).trim();
    const name = ref.slice(idx + 2).trim();
    if (selector.length === 0 || name.length === 0) return null;
    return { selector, name };
  }

  function resolveSelectorAliasOrVersion(
    selector: string,
    name: string,
    fromPath: string,
  ): { selector: string; versionKey: string } | null {
    const visited = new Set<string>();
    let cur = { selector, name };

    while (true) {
      const id = `${cur.selector}::${cur.name}`;
      if (visited.has(id)) {
        issues.push({ path: fromPath, message: `Alias cycle detected at '${id}'` });
        return null;
      }
      visited.add(id);

      const scope = selectorPayloads[cur.selector];
      if (!scope) {
        issues.push({ path: fromPath, message: `Unknown target selector '${cur.selector}'` });
        return null;
      }

      if (scope.versions[cur.name]) return { selector: cur.selector, versionKey: cur.name };

      const next = scope.aliases[cur.name];
      if (typeof next !== "string") {
        issues.push({
          path: fromPath,
          message: `Reference '${id}' does not resolve to a version key`,
        });
        return null;
      }

      const parsed = parseSelectorRef(next, cur.selector);
      if (!parsed) {
        issues.push({ path: fromPath, message: `Invalid reference '${next}'` });
        return null;
      }
      cur = parsed;
    }
  }

  function resolveSelectorSchema(
    selector: string,
    versionKey: string,
    stack: string[],
  ): Record<string, Field> {
    const cacheKey = `${selector}::${versionKey}`;
    if (selectorSchemaCache.has(cacheKey)) return selectorSchemaCache.get(cacheKey)!;

    if (stack.includes(cacheKey)) {
      issues.push({
        path: `payload.${selector}.${versionKey}.$ref`,
        message: `Cycle detected in $ref: ${stack.join(" -> ")}`,
      });
      const fallback = selectorPayloads[selector]?.versions[versionKey]?.schema ?? {};
      selectorSchemaCache.set(cacheKey, fallback);
      return fallback;
    }

    const scope = selectorPayloads[selector];
    const version = scope?.versions[versionKey];
    if (!scope || !version) {
      const empty: Record<string, Field> = {};
      selectorSchemaCache.set(cacheKey, empty);
      return empty;
    }

    stack.push(cacheKey);

    let schema: Record<string, Field> = version.schema;
    const ref = version.$ref;
    const refPath = `payload.${selector}.${versionKey}.$ref`;

    if (typeof ref === "string" && ref.length > 0) {
      const parsed = parseSelectorRef(ref, selector);
      if (!parsed) {
        issues.push({
          path: refPath,
          message: `Invalid $ref '${ref}'. Expected '<target>::<versionOrAlias>' or '<versionOrAlias>'`,
        });
      } else {
        const resolved = resolveSelectorAliasOrVersion(parsed.selector, parsed.name, refPath);
        if (resolved) {
          const resolvedKey = `${resolved.selector}::${resolved.versionKey}`;
          if (resolvedKey !== cacheKey) {
            const baseSchema = resolveSelectorSchema(resolved.selector, resolved.versionKey, stack);
            schema = mergeSchemaMaps(
              baseSchema,
              schema,
              issues,
              `payload.${selector}.${versionKey}`,
            );
          }
        }
      }
    } else if (ref !== undefined) {
      issues.push({ path: refPath, message: "$ref must be a string" });
    }

    stack.pop();

    selectorSchemaCache.set(cacheKey, schema);
    return schema;
  }

  const resolveExternalSchema = (ref: string, fromPath: string): Record<string, Field> | null => {
    const parsed = parseSelectorRef(ref, "");
    if (!parsed) {
      issues.push({
        path: fromPath,
        message: `Invalid $ref '${ref}'. Expected '<target>::<versionOrAlias>'`,
      });
      return null;
    }

    const resolved = resolveSelectorAliasOrVersion(parsed.selector, parsed.name, fromPath);
    if (!resolved) return null;

    return resolveSelectorSchema(resolved.selector, resolved.versionKey, []);
  };

  const resolvedTargets: Record<string, ResolvedTargetPayload> = {};

  // No-overlap rule: each target may be covered at most once.
  const targetToSelector = new Map<string, string>();
  for (const selector of selectors) {
    for (const target of selector.targets) {
      if (!allTargetSet.has(target)) continue;
      const prev = targetToSelector.get(target);
      if (prev) {
        issues.push({
          path: `payload.${target}`,
          message: `Target '${target}' is covered by both '${prev}' and '${selector.name}'. Each target must be covered at most once.`,
        });
        continue;
      }
      targetToSelector.set(target, selector.name);
    }
  }

  for (const target of allTargets) {
    const selectorName = targetToSelector.get(target);
    if (!selectorName) continue;

    const selected = selectorPayloads[selectorName];
    if (!selected) continue;

    // Resolve aliases and current for the selected payload key
    const basePath = `payload.${selectorName}`;
    const resolvedAliases = resolveAllAliases(
      selected.versions,
      selected.aliases,
      issues,
      `${basePath}.aliases`,
    );

    const currentKey = resolveAliasOrVersion(
      selected.currentRef,
      selected.versions,
      { ...selected.aliases, ...resolvedAliases },
      issues,
      `${basePath}.current`,
    );

    if (!currentKey) continue;

    // Resolve $ref schemas
    const cache = new Map<string, Record<string, Field>>();
    const resolvedVersions: Record<string, ResolvedPayloadVersion> = {};

    for (const [versionKey, version] of Object.entries(selected.versions)) {
      const schema = resolveRefSchema(
        versionKey,
        selected.versions,
        resolvedAliases,
        issues,
        [],
        cache,
        basePath,
        resolveExternalSchema,
      );
      resolvedVersions[versionKey] = {
        key: versionKey,
        $ref: version.$ref,
        meta: version.meta,
        schema,
      };
    }

    resolvedTargets[target] = {
      target,
      current: currentKey,
      aliases: resolvedAliases,
      versions: resolvedVersions,
    };
  }

  return { payload: { targets: resolvedTargets }, issues };
}
