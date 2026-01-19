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

function parseTargetPayload(payload: unknown, issues: PayloadIssue[], path: string): NormalizedTargetPayload {
  if (isPayloadVersion(payload)) {
    return {
      isUnversioned: true,
      currentRef: UNVERSIONED_VERSION_KEY,
      aliases: {},
      versions: { [UNVERSIONED_VERSION_KEY]: payload },
    };
  }

  if (!isVersionedTargetPayload(payload)) {
    issues.push({ path, message: "Invalid target payload: expected {schema,...} or {current,...}" });
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

function mergeSchemaMaps(base: Record<string, Field>, override: Record<string, Field>): Record<string, Field> {
  const out: Record<string, Field> = { ...base };
  for (const [name, overrideField] of Object.entries(override)) {
    const baseField = out[name];
    out[name] = baseField ? mergeField(baseField, overrideField) : overrideField;
  }
  return out;
}

function mergeField(base: Field, override: Field): Field {
  const mergedChecks =
    base.checks || override.checks ? { ...(base.checks ?? {}), ...(override.checks ?? {}) } : undefined;

  const mergedPii =
    base.pii || override.pii ? { ...(base.pii ?? {}), ...(override.pii ?? {}) } : undefined;

  const merged: Field = {
    ...base,
    ...override,
    checks: mergedChecks,
    pii: mergedPii,
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

function mergePayloadVersion(base: PayloadVersion, override: PayloadVersion): PayloadVersion {
  return {
    $ref: override.$ref ?? base.$ref,
    meta: override.meta ?? base.meta,
    schema: mergeSchemaMaps(base.schema, override.schema),
  };
}

function mergeNormalizedTargetPayload(
  base: NormalizedTargetPayload,
  override: NormalizedTargetPayload,
): NormalizedTargetPayload {
  // Both unversioned: simple merge
  if (base.isUnversioned && override.isUnversioned) {
    const baseV = base.versions[UNVERSIONED_VERSION_KEY];
    const overrideV = override.versions[UNVERSIONED_VERSION_KEY];
    if (!baseV) return override;
    if (!overrideV) return base;

    return {
      isUnversioned: true,
      currentRef: UNVERSIONED_VERSION_KEY,
      aliases: {},
      versions: {
        [UNVERSIONED_VERSION_KEY]: mergePayloadVersion(baseV, overrideV),
      },
    };
  }

  // Base unversioned overlays every override version (base is broader)
  if (base.isUnversioned && !override.isUnversioned) {
    const overlay = base.versions[UNVERSIONED_VERSION_KEY];
    if (!overlay) return override;

    const mergedVersions: Record<string, PayloadVersion> = {};
    for (const [key, version] of Object.entries(override.versions)) {
      mergedVersions[key] = {
        ...version,
        schema: mergeSchemaMaps(overlay.schema, version.schema),
      };
    }

    return {
      ...override,
      versions: mergedVersions,
    };
  }

  // Override unversioned overlays every base version (override is narrower/more specific)
  if (!base.isUnversioned && override.isUnversioned) {
    const overlay = override.versions[UNVERSIONED_VERSION_KEY];
    if (!overlay) return base;

    const mergedVersions: Record<string, PayloadVersion> = {};
    for (const [key, version] of Object.entries(base.versions)) {
      mergedVersions[key] = {
        ...version,
        schema: mergeSchemaMaps(version.schema, overlay.schema),
      };
    }

    return {
      ...base,
      versions: mergedVersions,
    };
  }

  // Both versioned: merge versions and aliases; override current wins
  const mergedVersions: Record<string, PayloadVersion> = { ...base.versions };
  for (const [key, overrideVersion] of Object.entries(override.versions)) {
    const baseVersion = mergedVersions[key];
    mergedVersions[key] = baseVersion ? mergePayloadVersion(baseVersion, overrideVersion) : overrideVersion;
  }

  return {
    isUnversioned: false,
    currentRef: override.currentRef,
    aliases: { ...base.aliases, ...override.aliases },
    versions: mergedVersions,
  };
}

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
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
    issues.push({ path: `${basePath}.${versionKey}.$ref`, message: `Cycle detected in $ref: ${stack.join(" -> ")}` });
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
        schema = mergeSchemaMaps(externalSchema, schema);
      } else if (!resolveExternalSchema) {
        issues.push({ path: refPath, message: `Unknown $ref target '${ref}'` });
      }
    } else {
      const refKey =
        versions[ref] ? ref : resolvedAliases[ref] ? resolvedAliases[ref] : resolveAliasOrVersion(ref, versions, resolvedAliases, issues, refPath);
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
        schema = mergeSchemaMaps(baseSchema, schema);
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
    issues.push({ path: "spec.events.payload.targets.all", message: "Missing or empty targets.all" });
  }

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
    index: number;
    targets: ReadonlySet<string>;
    payload: NormalizedTargetPayload;
  }> = [];

  const selectorPayloads: Record<string, NormalizedTargetPayload> = {};

  let selectorIndex = 0;
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
      selectorIndex++;
      continue;
    }

    selectors.push({
      name: selectorName,
      index: selectorIndex++,
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
            schema = mergeSchemaMaps(baseSchema, schema);
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

  for (const target of allTargets) {
    const applicable = selectors.filter((s) => s.targets.has(target));
    if (applicable.length === 0) continue; // event not defined for this target

    // Ambiguity check: selectors should form a subset chain for this target
    for (let i = 0; i < applicable.length; i++) {
      for (let j = i + 1; j < applicable.length; j++) {
        const a = applicable[i];
        const b = applicable[j];
        if (!(isSubset(a.targets, b.targets) || isSubset(b.targets, a.targets))) {
          issues.push({
            path: `payload.${target}`,
            message: `Ambiguous selectors for '${target}': '${a.name}' and '${b.name}' overlap without subset relation`,
          });
        }
      }
    }

    // Sort broad -> narrow (larger target set first). Same-size tie-breaker: file order.
    applicable.sort((a, b) => {
      const bySize = b.targets.size - a.targets.size;
      if (bySize !== 0) return bySize;
      return a.index - b.index;
    });

    // Merge selector payloads
    let merged = applicable[0].payload;
    for (let i = 1; i < applicable.length; i++) {
      merged = mergeNormalizedTargetPayload(merged, applicable[i].payload);
    }

    // Resolve aliases and current
    const resolvedAliases = resolveAllAliases(merged.versions, merged.aliases, issues, `payload.${target}.aliases`);
    const currentKey = resolveAliasOrVersion(
      merged.currentRef,
      merged.versions,
      { ...merged.aliases, ...resolvedAliases },
      issues,
      `payload.${target}.current`,
    );

    if (!currentKey) continue;

    // Resolve $ref schemas
    const cache = new Map<string, Record<string, Field>>();
    const resolvedVersions: Record<string, ResolvedPayloadVersion> = {};

    for (const [versionKey, version] of Object.entries(merged.versions)) {
      const schema = resolveRefSchema(
        versionKey,
        merged.versions,
        resolvedAliases,
        issues,
        [],
        cache,
        `payload.${target}`,
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
