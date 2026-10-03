/**
 * The shape of opentp.cli.yaml: settings of the reference CLI that are not part of the
 * OpenTrackPlan format (key generation, check bindings and plugins, generator runs, MCP tools).
 *
 * The committed JSON Schema `schemas/opentp.cli.schema.json` is generated from this file
 * (`npm run schema`; a test fails when it is stale).
 */

import * as z from "zod/v4";

/** Top-level keys that are planned but not implemented yet */
export const NOT_SUPPORTED_YET_KEYS = ["serve", "search"] as const;

const nonEmpty = z.string().min(1);
const directories = z.array(nonEmpty);
const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** A transform step: a step name or a single-key mapping `{ <step>: <params> }` */
const transformStep = z.union([z.string(), z.record(z.string(), z.unknown())]);

export const keygenSchema = z.strictObject({
  template: nonEmpty.describe("Key template, e.g. '{area | slug}::{event | slug}'"),
  transforms: z
    .record(z.string(), z.array(transformStep))
    .optional()
    .describe("Named pipelines of transform steps"),
  plugins: directories
    .optional()
    .describe("Directories with custom transform steps (loaded only with --allow-plugins)"),
});

export const webhookSchema = z.strictObject({
  url: nonEmpty.describe(
    "Webhook URL; it and the headers may read environment variables listed in OPENTP_WEBHOOK_ENV",
  ),
  method: z.enum(["GET", "POST", "PUT"]).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().int().positive().optional().describe("Request timeout in ms (default 5000)"),
  retries: z.number().int().min(0).optional(),
  cache: z.number().int().min(0).optional().describe("Cache TTL in ms (default 0: no cache)"),
});

export const bindingSchema = z.union(
  [
    z.strictObject({ webhook: webhookSchema }),
    z.strictObject({
      rule: nonEmpty.describe("A built-in or plugin rule"),
      params: z.unknown().optional().describe("Params used when the plan writes `<id>: true`"),
    }),
  ],
  { error: "Expected exactly one of { webhook: { url, ... } } or { rule: <name>, params? }" },
);

const severity = z.enum(["off", "warning", "error"]);

export const checksSchema = z.strictObject({
  plugins: directories
    .optional()
    .describe("Directories with custom checks (loaded only with --allow-plugins)"),
  bindings: z
    .record(
      z
        .string()
        .regex(
          /^[A-Za-z][A-Za-z0-9_.-]*$/,
          "Invalid check id: it must start with a letter and contain only letters, digits, '_', '.' or '-'",
        ),
      bindingSchema,
    )
    .optional()
    .describe("Check ids the plan refers to: webhooks, or rules with default params"),
  severity: z
    .partialRecord(z.enum(["overlap", "unknownCheck"]), severity)
    .optional()
    .describe("Severity of the tool rules (default: warning)"),
});

export const runEntrySchema = z.strictObject({
  generator: nonEmpty,
  output: nonEmpty.describe("Output file, relative to this file's directory"),
  file: nonEmpty.optional().describe("Template file (template generator), relative to this file"),
  pretty: z.boolean().optional(),
  target: nonEmpty.optional().describe("Only events whose payload covers this target"),
  events: z
    .record(z.string(), z.union([scalar, z.array(scalar).min(1)]))
    .optional()
    .describe("Only events whose taxonomy matches every listed field (a value or a list)"),
});

export const generateSchema = z.strictObject({
  plugins: directories
    .optional()
    .describe("Directories with custom generators (loaded only with --allow-plugins)"),
  run: z
    .array(runEntrySchema)
    .optional()
    .describe("What 'opentp generate' without a generator name runs, in order"),
});

export const MCP_TOOL_GROUPS = ["describe", "search", "validate", "generate"] as const;
export type McpToolGroup = (typeof MCP_TOOL_GROUPS)[number];

export const mcpSchema = z.strictObject({
  tools: z
    .array(z.enum(MCP_TOOL_GROUPS))
    .min(
      1,
      `List at least one tool group (${MCP_TOOL_GROUPS.join(", ")}), or leave out mcp.tools to serve all`,
    )
    .optional()
    .describe("Tool groups to serve (default: all four); at least one"),
  // Only `false` is valid until write tools exist; `true` gets a message that says so
  write: z
    .literal(false, {
      error: (issue) => (issue.input === true ? "write tools are not supported yet" : undefined),
    })
    .optional()
    .describe("Reserved for write tools, which are not supported yet: only false is accepted"),
});

// --- tracker (D3) --------------------------------------------------------------------------------
// The shape only: field names, globs, paths, aliases and Iglu URIs are checked against the plan in
// ./tracker.ts (validation errors, not shape errors).

export const TRACKER_TYPES = ["snowplow", "ga4", "amplitude", "segment", "generic"] as const;
export type TrackerType = (typeof TRACKER_TYPES)[number];

const trackerMap = z
  .record(z.string(), nonEmpty)
  .describe(
    "Field name or glob ('*') -> path in the tracker payload; a path that ends at a container gets the field name as its leaf",
  );
const trackerContexts = z
  .record(z.string(), nonEmpty)
  .describe("Context (entity) schemas by alias: iglu:<vendor>/<name>/jsonschema/<M>-<R>-<A>");
const trackerFieldList = z.array(nonEmpty);
const trackerSetBy = z
  .strictObject({
    app: trackerFieldList
      .optional()
      .describe("Fields (names or globs) set once by the application, not passed per call"),
    tracker: trackerFieldList
      .optional()
      .describe("Fields (names or globs) filled by the tracker or the collector"),
  })
  .describe("Fields that generated code does not take per call");

const trackerTypeText = `${TRACKER_TYPES.slice(0, -1).join(", ")} or ${TRACKER_TYPES[TRACKER_TYPES.length - 1]}`;

/**
 * Where each plan field travels inside a tracker payload (D3: tool configuration, not identity).
 * `event` and `contexts` belong to snowplow, but the shape accepts them for every type: on another
 * type they are validation errors against the plan (./tracker.ts), not shape errors.
 */
export const trackerSchema = z
  .strictObject({
    type: z.enum(TRACKER_TYPES, { error: `Expected type ${trackerTypeText}` }),
    event: nonEmpty.optional().describe("snowplow only: Iglu URI of the event schema"),
    contexts: trackerContexts.optional().describe("snowplow only: context schemas by alias"),
    map: trackerMap.optional(),
    setBy: trackerSetBy.optional(),
    targets: z
      .record(
        z.string(),
        z.strictObject({
          map: trackerMap.optional(),
          contexts: trackerContexts
            .optional()
            .describe("snowplow only: context schemas by alias on this target"),
        }),
      )
      .optional()
      .describe("Overrides per target id (spec.events.payload.targets.all)"),
  })
  .describe(
    "Tracker binding: where each plan field travels inside the tracker payload (used by generators)",
  );

const knownKeys = {
  opentp: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "Expected an OpenTrackPlan version YYYY-MM")
    .describe("Must equal the plan's opentp"),
  cli: nonEmpty
    .optional()
    .describe("npm semver range of opentp versions that may run this plan, e.g. '>=0.10 <0.11'"),
  plan: nonEmpty
    .optional()
    .describe(
      "Application repository mode (no opentp.yaml next to this file): the tracking plan, a directory relative to this file or a git URL with a tag or commit SHA (git+ssh://, git+https:// or git+file://, e.g. git+ssh://git@example.com/acme/tracking-plan.git#v1.0.0)",
    ),
  keygen: keygenSchema.optional(),
  checks: checksSchema.optional(),
  tracker: trackerSchema.optional(),
  generate: generateSchema.optional(),
  mcp: mcpSchema.optional(),
};

export const cliConfigSchema = z
  .object(knownKeys)
  .catchall(z.unknown())
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(knownKeys, key) || key.startsWith("x-")) continue;
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: (NOT_SUPPORTED_YET_KEYS as readonly string[]).includes(key)
          ? `'${key}' is not supported yet`
          : `Unknown key '${key}' (extensions start with 'x-')`,
      });
    }
  });

export type CliConfig = z.output<typeof cliConfigSchema>;
export type CliKeygen = z.output<typeof keygenSchema>;
export type CliRunEntry = z.output<typeof runEntrySchema>;
export type CliTracker = z.output<typeof trackerSchema>;
