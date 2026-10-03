/**
 * The 2026-09 effective payload of an event, as generators get it (`GeneratorContext.effective` and
 * `effectivePayload` in the json and yaml exports).
 *
 * Per covered target (in `spec.events.payload.targets.all` order) and payload version (in file
 * order): the common fields of the target, then the fields the version lists (after `$ref`), each
 * merged over the catalog and the common fields with the same merge as validation
 * (core/payload.ts). Catalog fields that the event does not list are not part of it. Merge problems
 * are not reported here (`opentp validate` does).
 */

import { getDictValues } from "../core/dict";
import { isDeprecatedVersion, targetIds } from "../core/fields";
import {
  BaseFieldCache,
  type DictionaryLookup,
  effectiveFields,
  resolveEventPayload,
  UNVERSIONED_VERSION_KEY,
} from "../core/payload";
import type { Field, OpenTPConfig, ResolvedEvent } from "../types";
import { getOwn, setOwn } from "../util/objects";

/** The effective fields of one payload version on one target */
export interface EffectiveVersion {
  /** Field name -> merged definition (common fields first, then the fields the version lists) */
  fields: Record<string, Field>;
  /** The version has `meta.deprecated` (policies do not make fields present in it) */
  deprecated?: true;
}

/**
 * The effective payload of an event on one target. `fields` is always the current version (for an
 * unversioned payload: its only one); a versioned payload also has `current`, `aliases` and every
 * version under `versions` (`versions[current].fields` equals `fields`).
 */
export interface EffectiveTargetPayload {
  fields: Record<string, Field>;
  /** The current version key (versioned payloads only) */
  current?: string;
  /** Alias -> version key (versioned payloads only) */
  aliases?: Record<string, string>;
  /** Version key -> effective fields, in file order (versioned payloads only) */
  versions?: Record<string, EffectiveVersion>;
}

/** Target id -> effective payload, for the targets the event covers */
export type EffectivePayload = Record<string, EffectiveTargetPayload>;

/** Computes the effective payload of an event (a fresh copy on every call) */
export type EffectiveResolver = (event: ResolvedEvent) => EffectivePayload;

/**
 * A resolver for the events of one plan: the merged base fields of each target are computed once.
 * Payload resolution problems leave out what does not resolve.
 */
export function createEffectiveResolver(
  config: OpenTPConfig,
  dictionaries: Map<string, (string | number | boolean)[]>,
): EffectiveResolver {
  const lookup: DictionaryLookup = (dict) => getDictValues(dict, dictionaries);
  const baseFields = new BaseFieldCache(config, lookup);
  const order = targetIds(config);

  return (event) => {
    const { payload } = resolveEventPayload(event.payload, config, { dictionaryValues: lookup });
    const out: EffectivePayload = {};
    for (const target of order) {
      if (!Object.hasOwn(payload.targets, target)) continue;
      const resolved = payload.targets[target];
      const base = baseFields.forTarget(target);
      const versions: Record<string, EffectiveVersion> = {};
      for (const [key, version] of Object.entries(resolved.versions)) {
        const fields = effectiveFields(version.schema, base, lookup);
        // Version keys and target ids are names (`__proto__` too): own properties, never `[]=`
        setOwn(versions, key, {
          fields: Object.fromEntries([...fields].map(([name, entry]) => [name, entry.field])),
          ...(isDeprecatedVersion(version.meta) ? { deprecated: true as const } : {}),
        });
      }
      if (resolved.current === UNVERSIONED_VERSION_KEY) {
        setOwn<EffectiveTargetPayload>(out, target, {
          fields: getOwn(versions, UNVERSIONED_VERSION_KEY)?.fields ?? {},
        });
        continue;
      }
      // `current` names a version or an alias of one
      const currentKey = Object.hasOwn(versions, resolved.current)
        ? resolved.current
        : getOwn(resolved.aliases, resolved.current);
      setOwn<EffectiveTargetPayload>(out, target, {
        fields: (currentKey !== undefined && getOwn(versions, currentKey)?.fields) || {},
        current: currentKey ?? resolved.current,
        aliases: { ...resolved.aliases },
        versions,
      });
    }
    // Merged definitions share objects with the cached base fields: a generator gets its own copy
    return structuredClone(out);
  };
}
