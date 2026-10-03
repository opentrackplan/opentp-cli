/**
 * Builds the JSON Schema of opentp.cli.yaml from the zod schema. The result is committed as
 * `schemas/opentp.cli.schema.json` (`npm run schema`) and served at CLI_CONFIG_SCHEMA_ID.
 */

import * as z from "zod/v4";
import { cliConfigSchema } from "./schema";

export const CLI_CONFIG_SCHEMA_ID = "https://opentp.dev/schemas/cli/opentp.cli.schema.json";
export const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

/** The committed schema file, relative to the repository root */
export const CLI_CONFIG_SCHEMA_FILE = "schemas/opentp.cli.schema.json";

export function buildCliConfigJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(cliConfigSchema, {
    target: "draft-7",
    io: "input",
    override: (ctx) => {
      // The root allows `x-*` extensions and nothing else (zod's catchall plus a refinement)
      if (ctx.path.length === 0) {
        ctx.jsonSchema.patternProperties = { "^x-": {} };
        ctx.jsonSchema.additionalProperties = false;
      }
    },
  }) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = generated;
  return {
    $schema: DRAFT_07,
    $id: CLI_CONFIG_SCHEMA_ID,
    title: "opentp.cli.yaml",
    description:
      "Settings of the OpenTrackPlan reference CLI (opentp): key generation, check bindings and plugins, generator runs, MCP tools. Not part of the OpenTrackPlan format.",
    ...rest,
  };
}

/** The schema file content: indented JSON with a final newline */
export function renderCliConfigJsonSchema(): string {
  return `${JSON.stringify(buildCliConfigJsonSchema(), null, 2)}\n`;
}
