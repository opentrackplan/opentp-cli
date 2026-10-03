/**
 * Writes schemas/opentp.cli.schema.json from the zod schema of opentp.cli.yaml.
 * Run from the repository root: npm run schema
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CLI_CONFIG_SCHEMA_FILE, renderCliConfigJsonSchema } from "../src/cliconfig/json-schema";

const target = path.resolve(CLI_CONFIG_SCHEMA_FILE);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, renderCliConfigJsonSchema());
console.log(`Wrote ${CLI_CONFIG_SCHEMA_FILE}`);
