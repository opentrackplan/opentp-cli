/**
 * One walk over a raw YAML document (opentp.yaml, an event file or a dictionary file) that finds:
 * - YAML merge keys (a plain `<<`, found in the YAML text by parseYaml) anywhere: YAML 1.2 has no
 *   merge, so the key would be data;
 * - keywords removed in 2026-09 (`x-opentp` on any object, `valueRequired`);
 * - field definitions that are not mappings (in payload `schema` maps), field definitions that set
 *   more than one of `value`, `enum` and `dict`, invalid `pattern` regexes of field definitions,
 *   and (in event files) `policy`;
 * - empty enums (`enum: []`);
 * - every `checks` entry, so that check ids are classified once per file (not per target);
 * - every `dict` reference, so that unknown dictionaries are reported once where they are written.
 *
 * The walk knows which maps are keyed by user-chosen names (2026-09 "Extensions"): there a key
 * such as `x-foo` or `valueRequired` is a name, not a keyword. In an event file that includes the
 * payload map form (selectors and target ids) and versioned payloads (version keys and aliases):
 * only the `schema` and `meta` of each version are read as keywords.
 */

import type { CheckRef, DictRef, DocumentIssue } from "../types";
import { isYamlMapping } from "../util";
import { mergeKeyPaths as yamlMergeKeyPaths } from "../util/yaml";

export const REMOVED_X_OPENTP =
  "x-opentp was removed in 2026-09: move checks to 'checks', keygen to opentp.cli.yaml 'keygen', delete 'role'";
export const REMOVED_VALUE_REQUIRED =
  "valueRequired was removed in 2026-09: set 'policy' on the catalog or common field";
export const FIELD_NOT_MAPPING = "Field definition must be a mapping (write {} to list the field)";
export const EMPTY_ENUM = "enum must have at least one value";
export const POLICY_IN_EVENT =
  "policy is set on catalog and common fields in opentp.yaml, not in events";
export const EXCLUSIVE_RESTRICTIONS = "Field can have only one of: enum, dict, or value";
export const MERGE_KEY_MESSAGE =
  "YAML merge keys (<<) are not supported: write the keys out or use an alias";

/**
 * The dotted paths of every YAML merge key of a parsed document (a plain `<<` mapping key): anywhere,
 * in data and in extension values too (YAML 1.2 core has no merge keys, so `<<` would silently be an
 * ordinary key). Found in the YAML text by parseYaml, so a quoted `"<<"` is not one.
 */
export function mergeKeyPaths(document: unknown): string[] {
  return yamlMergeKeyPaths(document);
}

/** Keys whose mapping is keyed by names (fields, targets, groups, taxonomy fields, fragments) */
const NAME_KEYED = new Set(["schema", "taxonomy", "fragments", "targets"]);

/** Keys whose values are data (fixed values, examples, enum members, dictionary values) */
const DATA_KEYS = new Set(["value", "example", "enum", "values"]);

export interface DocumentWalkOptions {
  /**
   * The message for a value that is not a mapping in the name-keyed `schema` map at `path`, or null
   * when such values are not checked there. Default: every `schema` map is a payload field map.
   */
  fieldMapMessage?: (path: string) => string | null;
  /** Paths of maps keyed by names whose values are definitions, not `checks` (e.g. spec.checks) */
  definitionMaps?: ReadonlySet<string>;
  /** Report `policy` on field definitions (event files: policy belongs to opentp.yaml) */
  forbidPolicy?: boolean;
  /**
   * Whether the field map at `path` holds payload fields, whose `value`, `enum` and `dict` exclude
   * each other (default: every field map)
   */
  isPayloadFieldMap?: (path: string) => boolean;
  /**
   * The path of an event payload (`event.payload`): its selector, version and alias keys are names,
   * so the walk reads only the version objects below them
   */
  payloadPath?: string;
}

export interface DocumentWalkResult {
  issues: DocumentIssue[];
  checks: CheckRef[];
  dicts: DictRef[];
}

function regexProblem(pattern: unknown): string | null {
  if (typeof pattern !== "string") return null;
  try {
    new RegExp(pattern, "u");
    return null;
  } catch (error) {
    return `Invalid regex: ${String(error)}`;
  }
}

/** Walks a parsed document; paths are dotted from the document root (`a.b[0].c`) */
export function walkDocument(
  document: unknown,
  options: DocumentWalkOptions = {},
): DocumentWalkResult {
  const issues: DocumentIssue[] = [];
  const checks: CheckRef[] = [];
  const dicts: DictRef[] = [];
  const fieldMapMessage = options.fieldMapMessage ?? (() => FIELD_NOT_MAPPING);
  const definitionMaps = options.definitionMaps ?? new Set<string>();

  const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);

  const isPayloadFieldMap = options.isPayloadFieldMap ?? (() => true);

  for (const path of mergeKeyPaths(document)) issues.push({ path, message: MERGE_KEY_MESSAGE });

  /** Problems of one field definition (or its `items`) as written */
  const checkDefinition = (
    definition: Record<string, unknown>,
    path: string,
    payload: boolean,
  ): void => {
    const restrictions = ["value", "enum", "dict"].filter((key) => definition[key] !== undefined);
    if (payload && restrictions.length > 1) {
      issues.push({ path, message: EXCLUSIVE_RESTRICTIONS });
    }
    const regex = regexProblem(definition.pattern);
    if (regex) issues.push({ path: join(path, "pattern"), message: regex });
  };

  /** A field definition (a value of a `schema` map at `mapPath`) named `name` */
  const visitField = (
    field: Record<string, unknown>,
    path: string,
    mapPath: string,
    name: string,
  ): void => {
    const payload = isPayloadFieldMap(mapPath);
    checkDefinition(field, path, payload);
    if (isYamlMapping(field.items)) checkDefinition(field.items, join(path, "items"), payload);
    if (options.forbidPolicy && field.policy !== undefined) {
      issues.push({ path: join(path, "policy"), message: POLICY_IN_EVENT });
    }
    visit(field, path, name);
  };

  /** A mapping of names: each value is a definition (or data) */
  const visitNames = (
    node: unknown,
    path: string,
    notMapping: string | null,
    field: string | undefined,
  ): void => {
    if (!isYamlMapping(node)) return;
    for (const [name, value] of Object.entries(node)) {
      const childPath = join(path, name);
      if (notMapping !== null) {
        if (!isYamlMapping(value)) {
          issues.push({ path: childPath, message: notMapping });
          continue;
        }
        visitField(value, childPath, path, name);
        continue;
      }
      visit(value, childPath, field);
    }
  };

  /** A payload version (`{ schema, meta, $ref, x-* }`): a fixed-shape object */
  const isVersion = (node: unknown): node is Record<string, unknown> =>
    isYamlMapping(node) && isYamlMapping(node.schema);

  /** Versions and aliases by name (`{ current, <version>: {...}, <alias>: "<version>" }`) */
  const isVersioned = (node: unknown): node is Record<string, unknown> =>
    isYamlMapping(node) && !isYamlMapping(node.schema) && typeof node.current === "string";

  /** One target payload: a version, or versions and aliases by name */
  const visitTargetPayload = (node: unknown, path: string): void => {
    if (isVersion(node)) {
      visit(node, path);
    } else if (isVersioned(node)) {
      for (const [key, value] of Object.entries(node)) {
        // `current` and aliases are references; other entries are versions (resolution reports
        // anything else)
        if (key === "current" || !isYamlMapping(value)) continue;
        visit(value, join(path, key));
      }
    } else {
      // Not a payload shape (reported by the payload resolution): read it as keywords
      visit(node, path);
    }
  };

  /**
   * An event payload: an implicit target payload, or target payloads by selector (the same shapes
   * as the payload resolution)
   */
  const visitPayload = (node: unknown, path: string): void => {
    if (isVersion(node) || isVersioned(node) || !isYamlMapping(node)) {
      visitTargetPayload(node, path);
      return;
    }
    for (const [selector, value] of Object.entries(node)) {
      visitTargetPayload(value, join(path, selector));
    }
  };

  /**
   * A fixed-shape object (or a list of them): keys are keywords. `field` is the payload field the
   * object belongs to, if any.
   */
  const visit = (node: unknown, path: string, field?: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        visit(item, `${path}[${index}]`, field);
      });
      return;
    }
    if (!isYamlMapping(node)) return;

    for (const [key, value] of Object.entries(node)) {
      const childPath = join(path, key);
      if (key === "x-opentp") {
        issues.push({ path: childPath, message: REMOVED_X_OPENTP });
        continue;
      }
      if (key === "valueRequired") {
        issues.push({ path: childPath, message: REMOVED_VALUE_REQUIRED });
        continue;
      }
      if (key === "enum" && Array.isArray(value) && value.length === 0) {
        issues.push({ path: childPath, message: EMPTY_ENUM });
      }
      // Extension values are opaque; data is not a definition
      if (key.startsWith("x-") || DATA_KEYS.has(key)) continue;
      const inField = field === undefined ? {} : { field };
      if (key === "dict") dicts.push({ path: childPath, dict: value, ...inField });

      if (definitionMaps.has(childPath)) {
        visitNames(value, childPath, null, field);
      } else if (key === "checks") {
        if (isYamlMapping(value)) {
          for (const [id, params] of Object.entries(value)) {
            checks.push({ path: childPath, id, params, ...inField });
          }
        }
      } else if (NAME_KEYED.has(key)) {
        visitNames(value, childPath, key === "schema" ? fieldMapMessage(childPath) : null, field);
      } else if (childPath === options.payloadPath) {
        visitPayload(value, childPath);
      } else {
        visit(value, childPath, field);
      }
    }
  };

  visit(document, "");
  return { issues, checks, dicts };
}

/**
 * The path of an event file location as reported by `opentp validate`: payload and taxonomy paths
 * drop the leading `event.` (`payload.web.schema.user_id`), other paths stay as written
 * (`event.lifecycle`).
 */
export function eventCheckPath(documentPath: string): string {
  return documentPath.replace(/^event\.(?=(?:payload|taxonomy)(?:$|[.[]))/, "");
}

/** Walks an event document and returns its issues and checks at the paths `validate` reports */
export function walkEventDocument(document: unknown): DocumentWalkResult {
  const result = walkDocument(document, { forbidPolicy: true, payloadPath: "event.payload" });
  return {
    issues: result.issues.map((issue) => ({ ...issue, path: eventCheckPath(issue.path) })),
    checks: result.checks.map((ref) => ({ ...ref, path: eventCheckPath(ref.path) })),
    dicts: result.dicts.map((ref) => ({ ...ref, path: eventCheckPath(ref.path) })),
  };
}

/** The maps of opentp.yaml whose values are not payload field definitions */
const CONFIG_DEFINITION_MAPS: ReadonlySet<string> = new Set(["spec.checks"]);

/** The map of pii meta field definitions (a field map, but not of payload fields) */
const PII_SCHEMA_PATH = "spec.events.pii.schema";

/** Walks opentp.yaml: payload field maps are spec.events.payload.schema and spec.targets.<id>.schema */
export function walkConfigDocument(config: unknown): DocumentWalkResult {
  return walkDocument(config, {
    definitionMaps: CONFIG_DEFINITION_MAPS,
    fieldMapMessage: (path) =>
      path === PII_SCHEMA_PATH ? "Field definition must be a mapping" : FIELD_NOT_MAPPING,
    isPayloadFieldMap: (path) => path !== PII_SCHEMA_PATH,
  });
}
