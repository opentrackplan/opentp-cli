/**
 * The MCP server of `opentp mcp` (stdio): one factory, buildMcpServer, over a PlanStore.
 *
 * Uses @modelcontextprotocol/server v2 (MCP revision 2026-07-28; 2025-era clients are served too).
 * The same factory can later be mounted at /mcp of an HTTP server.
 */

import { Console } from "node:console";
import { Writable } from "node:stream";
import { McpServer, ResourceNotFoundError, ResourceTemplate } from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { MCP_TOOL_GROUPS, type McpToolGroup } from "../cliconfig/schema";
import { VERSION } from "../meta";
import { logger } from "../util/logger";
import { PlanError, type PlanSnapshot, type PlanStore } from "./plan";
import {
  describePlan,
  generate,
  getDictionary,
  getEvent,
  listDictionaries,
  MAX_RESPONSE_BYTES,
  searchEvents,
  suggestEvent,
  ToolError,
  validateEventDraft,
  validatePlan,
} from "./tools";

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
/** Validation runs the plan's checks, and a webhook binding (opentp.cli.yaml) calls its URL */
const VALIDATES = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

/**
 * The server instructions for the enabled tool groups: they name only tools that are registered
 * (an agent that follows them must not call a tool that does not exist)
 */
export function mcpInstructions(groups: ReadonlySet<McpToolGroup>): string {
  const describe = groups.has("describe");
  const search = groups.has("search");
  const validate = groups.has("validate");
  const lines = ["OpenTrackPlan tracking plan (read-only tools)."];
  if (describe) {
    lines.push(
      "Start with describe_plan to learn the taxonomy, targets, field catalog, common payload fields (with their policies), key rules and the tracker binding.",
    );
  }
  if (search) {
    lines.push(
      describe
        ? "Find events with search_events (plain words work best), then read one with get_event."
        : "Find events with search_events (plain words work best).",
    );
  } else if (describe) {
    lines.push("Read an event by its key with get_event.");
  }
  if (describe && validate) {
    lines.push(
      "To add or change an event: call suggest_event (file path, generated key, YAML skeleton), write the YAML file yourself, then call validate_event_draft (before writing) or validate_plan (after).",
    );
  } else if (describe) {
    lines.push(
      "To add an event: call suggest_event (file path, generated key, YAML skeleton) and write the YAML file yourself.",
    );
  } else if (validate) {
    lines.push(
      "To check an event file: call validate_event_draft (before writing it) or validate_plan (after).",
    );
  }
  if (validate) {
    lines.push(
      "Only errors make an event invalid; warnings (for example an overlap with another event) are worth a look. Validation runs the plan's checks, including webhook bindings from opentp.cli.yaml for the event files on disk (never for drafts).",
    );
  }
  if (groups.has("generate")) {
    lines.push(
      "Export the plan (or some events) as text with generate: json or yaml, or a generate.run entry of opentp.cli.yaml.",
    );
  }
  lines.push("These tools never write files.");
  return lines.join("\n");
}

export interface McpServerOptions {
  /** Tool groups to register (opentp.cli.yaml mcp.tools; default: all) */
  tools?: ReadonlySet<McpToolGroup>;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function tooLarge(bytes: number): string {
  return `The response is ${Math.ceil(bytes / 1024)} KB, more than the ${MAX_RESPONSE_BYTES / 1024} KB limit for one response: narrow the request (for example target and version for get_event, keys for generate, a lower limit)`;
}

interface Presentation {
  /** The text sent to the client (default: the result as indented JSON) */
  text?: (result: Record<string, unknown>) => string;
  /** The structured content (default: the result itself) */
  structured?: (result: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Runs a tool against the current plan. Tool errors (unknown key, bad path), a plan that cannot be
 * loaded and an oversized response are returned as error results; anything else is a bug and is
 * logged as well.
 */
async function run(
  store: PlanStore,
  tool: (plan: PlanSnapshot) => unknown | Promise<unknown>,
  presentation: Presentation = {},
): Promise<ToolResult> {
  try {
    const plan = await store.current();
    const result = (await tool(plan)) as Record<string, unknown>;
    const text = presentation.text ? presentation.text(result) : JSON.stringify(result, null, 2);
    const structured = presentation.structured ? presentation.structured(result) : result;
    // The structured copy is the same data, so the limit applies to the text alone
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_RESPONSE_BYTES) return errorResult(tooLarge(bytes));
    return { content: [{ type: "text", text }], structuredContent: structured };
  } catch (error) {
    if (error instanceof ToolError || error instanceof PlanError) {
      return errorResult(error.message);
    }
    logger.error({ error }, "MCP tool failed");
    return errorResult(`Internal error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const taxonomyValue = z.union([z.string(), z.number(), z.boolean()]);

function resourceText(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_RESPONSE_BYTES) throw new Error(tooLarge(bytes));
  return text;
}

/**
 * Builds the MCP server: cheap, so it can be called per connection (stdio) or per request (HTTP).
 * Only the enabled tool groups are registered: describe (describe_plan, get_event,
 * list_dictionaries, get_dictionary, suggest_event and both resources), search (search_events),
 * validate (validate_event_draft, validate_plan), generate (generate).
 */
export function buildMcpServer(store: PlanStore, options: McpServerOptions = {}): McpServer {
  const groups = options.tools ?? new Set(MCP_TOOL_GROUPS);
  const server = new McpServer(
    { name: "opentp", title: "OpenTrackPlan", version: VERSION },
    { instructions: mcpInstructions(groups) },
  );

  if (groups.has("describe")) registerDescribeTools(server, store, groups);
  if (groups.has("search")) registerSearchTools(server, store, groups);
  if (groups.has("validate")) registerValidateTools(server, store, groups);
  if (groups.has("generate")) registerGenerateTools(server, store);

  return server;
}

/*
 * Tool descriptions name another tool only when its group is served (`groups`), like the
 * instructions.
 */

function registerDescribeTools(
  server: McpServer,
  store: PlanStore,
  groups: ReadonlySet<McpToolGroup>,
): void {
  server.registerTool(
    "describe_plan",
    {
      title: "Describe the tracking plan",
      description:
        "The plan's structure: taxonomy fields (and which come from the file path), path template, key rules and whether keygen is configured, targets, the field catalog (fields events may use), the common fields of each target with their policy (specified, restricted, fixed: what every event must write), spec.checks, the tracker binding (where each field travels in the tracker payload, per target; tracker in opentp.cli.yaml), PII settings and counts. Call this first.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => run(store, (plan) => describePlan(plan, groups)),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get an event",
      description:
        "One event by key (or an old key from its aliases): taxonomy, lifecycle, file, and the effective payload schema per target and version (common fields merged in). Targets with the same schema are grouped.",
      inputSchema: z.object({
        key: z.string().min(1),
        target: z.string().min(1).optional().describe("Only this target id"),
        version: z
          .string()
          .min(1)
          .optional()
          .describe("A payload version or alias (default: each target's current version)"),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(store, (plan) => getEvent(plan, args)),
  );

  server.registerTool(
    "list_dictionaries",
    {
      title: "List dictionaries",
      description: "Dictionary names (as used in `dict:`) and their value counts.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => run(store, (plan) => listDictionaries(plan)),
  );

  server.registerTool(
    "get_dictionary",
    {
      title: "Get a dictionary",
      description: "The allowed values of one dictionary.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Dictionary name, e.g. taxonomy/areas"),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(store, (plan) => getDictionary(plan, args)),
  );

  server.registerTool(
    "suggest_event",
    {
      title: "Suggest a new event",
      description:
        "For taxonomy values: the file path, the key generated by keygen (opentp.cli.yaml), a YAML skeleton that lists every field with a policy (replace each <...> placeholder: a value for fixed, enum values or a value for restricted; an array field takes only a value), required common payload fields, conflicts with existing events, and what the skeleton still lacks (skeletonErrors). Writes nothing.",
      inputSchema: z.object({
        taxonomy: z
          .record(z.string(), taxonomyValue)
          .describe("Taxonomy field values, including the ones that form the file path"),
      }),
      annotations: VALIDATES,
    },
    async (args) => run(store, (plan) => suggestEvent(plan, args)),
  );

  server.registerResource(
    "plan-summary",
    "opentp://plan/summary",
    {
      title: "Tracking plan summary",
      description: "The same as describe_plan",
      mimeType: "application/json",
    },
    async (uri) => {
      const plan = await store.current();
      return { contents: [{ uri: uri.href, text: resourceText(describePlan(plan, groups)) }] };
    },
  );

  server.registerResource(
    "event",
    new ResourceTemplate("opentp://events/{key}", { list: undefined }),
    {
      title: "Event",
      description: "The same as get_event for one key",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const plan = await store.current();
      let event: ReturnType<typeof getEvent>;
      try {
        event = getEvent(plan, { key: decodeURIComponent(String(variables.key)) });
      } catch (error) {
        if (error instanceof ToolError || error instanceof URIError) {
          throw new ResourceNotFoundError(uri.href, error.message);
        }
        throw error;
      }
      return { contents: [{ uri: uri.href, text: resourceText(event) }] };
    },
  );
}

function registerSearchTools(
  server: McpServer,
  store: PlanStore,
  groups: ReadonlySet<McpToolGroup>,
): void {
  server.registerTool(
    "search_events",
    {
      title: "Search events",
      description: `Find events by words or a description of when they fire (lexical search over keys, taxonomy values, including the values that form the file path, and the payload fields each event defines). A whole key as the query puts that event first. ${groups.has("describe") ? "Returns keys for get_event." : "Returns event keys."}`,
      inputSchema: z.object({
        query: z.string().min(1).max(1000).describe("Words, a phrase or part of a key"),
        limit: z.number().int().min(1).max(50).optional().describe("Default 10"),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(store, (plan) => searchEvents(plan, args)),
  );
}

function registerValidateTools(
  server: McpServer,
  store: PlanStore,
  groups: ReadonlySet<McpToolGroup>,
): void {
  server.registerTool(
    "validate_event_draft",
    {
      title: "Validate an event draft",
      description:
        "Validates event YAML as if it were saved at `path`, without writing anything: file path vs the path template, taxonomy, key (including uniqueness across the plan) and payload. Returns errors (they make it invalid) and warnings: unknown check ids, and events of the plan whose payload can match the same hits (overlap; the event at the same path is left out). Webhook bindings are not run for drafts.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            `Where the file would be, relative to the events root or the project root${groups.has("describe") ? " (see suggest_event)" : ""}`,
          ),
        yaml: z
          .string()
          .max(1_000_000)
          .describe("The full event file content (at most 1,000,000 characters)"),
      }),
      annotations: VALIDATES,
    },
    async (args) => run(store, (plan) => validateEventDraft(plan, args)),
  );

  server.registerTool(
    "validate_plan",
    {
      title: "Validate the plan",
      description:
        "Validation errors and warnings (overlapping events, unknown check ids) of the whole plan as `opentp validate` reports them; only errors make it invalid. With `files`: their errors and warnings, and whether opentp loads each file at all (a file that does not match the path template is skipped silently by opentp).",
      inputSchema: z.object({
        files: z
          .array(z.string().min(1))
          .optional()
          .describe("Only errors of these event files (relative to the events or project root)"),
        limit: z.number().int().min(1).max(1000).optional().describe("Default 100"),
      }),
      annotations: VALIDATES,
    },
    async (args) => run(store, (plan) => validatePlan(plan, args)),
  );
}

function registerGenerateTools(server: McpServer, store: PlanStore): void {
  server.registerTool(
    "generate",
    {
      title: "Export events",
      description:
        "Exports the plan (or some events) like `opentp generate` and returns the text; it never writes a file. Pass generator (json or yaml: catalog, targets, checks and every event with its raw and effective payload), or run: the index of a generate.run entry of opentp.cli.yaml, whose generator, target, events and template file are used (its output file is not written). Exports over 256 KB are refused: pass keys.",
      inputSchema: z.object({
        generator: z.enum(["json", "yaml"]).optional().describe("A built-in export generator"),
        run: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Index of a generate.run entry in opentp.cli.yaml (0 is the first)"),
        keys: z.array(z.string().min(1)).optional().describe("Only these event keys"),
      }),
      annotations: READ_ONLY,
    },
    async (args) =>
      run(store, (plan) => generate(plan, args), {
        // The export goes once, as the text; the structured content carries only its metadata
        text: (result) => String(result.output),
        structured: ({ output: _output, ...metadata }) => metadata,
      }),
  );
}

const CONSOLE_METHODS = [
  "log",
  "info",
  "debug",
  "warn",
  "error",
  "trace",
  "dir",
  "dirxml",
  "table",
  "group",
  "groupCollapsed",
  "groupEnd",
  "time",
  "timeEnd",
  "timeLog",
  "count",
  "countReset",
  "assert",
] as const;

let protocolOutput: Writable | undefined;

/**
 * Reserves stdout for the MCP protocol and returns the stream to write it to. From the first call on,
 * every console method (Node and Bun) and every other `process.stdout.write` (for example in an
 * external plugin) go to stderr. Call it before anything that may print; later calls return the same
 * stream.
 */
export function reserveStdoutForProtocol(): Writable {
  if (protocolOutput) return protocolOutput;

  const stdout = process.stdout;
  const writeToStdout = stdout.write.bind(stdout);
  const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });
  const target = console as unknown as Record<string, unknown>;
  const source = stderrConsole as unknown as Record<string, (...args: unknown[]) => void>;
  for (const method of CONSOLE_METHODS) {
    if (typeof source[method] === "function") target[method] = source[method].bind(stderrConsole);
  }
  stdout.write = ((...args: Parameters<typeof process.stderr.write>) =>
    process.stderr.write(...args)) as typeof stdout.write;

  protocolOutput = new Writable({
    write(chunk, _encoding, callback) {
      writeToStdout(chunk, (error) => callback(error ?? undefined));
    },
  });
  // The SDK waits for 'drain' per message; many large responses in flight would warn otherwise
  protocolOutput.setMaxListeners(0);
  // A vanished client (EPIPE) is handled by the CLI's stdout 'error' handler
  protocolOutput.on("error", () => {});
  return protocolOutput;
}

/** Serves MCP over stdin/stdout until the client closes stdin */
export async function serveMcpStdio(
  store: PlanStore,
  options: McpServerOptions = {},
): Promise<void> {
  const transport = new StdioServerTransport(process.stdin, reserveStdoutForProtocol());
  const handle = serveStdio(() => buildMcpServer(store, options), {
    transport,
    onerror: (error) => logger.error({ error: error.message }, "MCP transport error"),
  });
  logger.info({ root: store.root }, "OpenTrackPlan MCP server ready on stdio");

  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
  });
  await handle.close();
}
