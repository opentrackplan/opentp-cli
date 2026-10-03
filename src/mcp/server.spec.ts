import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { PlanStore } from "./plan";
import { buildMcpServer } from "./server";

const FIXTURE = path.resolve("tests/data/coverage-valid");
const LOGIN_KEY = "auth::login_button_click::click::login_button::p2::internal-false";

const TOOLS = [
  "describe_plan",
  "generate",
  "get_dictionary",
  "get_event",
  "list_dictionaries",
  "search_events",
  "suggest_event",
  "validate_event_draft",
  "validate_plan",
];

let client: Client | undefined;

async function connect(root = FIXTURE): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildMcpServer(new PlanStore(root));
  await server.connect(serverTransport);
  client = new Client({ name: "opentp-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
});

function text(result: { content: unknown }): string {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return first?.text ?? "";
}

describe("buildMcpServer", () => {
  it("offers the read-only tool set with input schemas and instructions", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS);
    const validating = ["suggest_event", "validate_event_draft", "validate_plan"];
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      // Validation may call webhook checks configured in opentp.yaml
      expect(tool.annotations?.openWorldHint, tool.name).toBe(validating.includes(tool.name));
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.description, tool.name).toBeTruthy();
    }
    expect(mcp.getInstructions()).toContain("never write files");
    expect(mcp.getServerVersion()?.name).toBe("opentp");
  });

  it("returns tool results as JSON text and structured content", async () => {
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "search_events",
      arguments: { query: "login button" },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { results: Array<{ key: string }> };
    expect(structured.results[0]?.key).toBe(LOGIN_KEY);
    expect(JSON.parse(text(result))).toEqual(structured);
  });

  it("returns generate output as plain text", async () => {
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "generate",
      arguments: { generator: "json", keys: [LOGIN_KEY] },
    });
    expect(JSON.parse(text(result)).events[0].key).toBe(LOGIN_KEY);
    // The export is sent once: the structured content carries only its metadata
    expect(result.structuredContent).toEqual({
      generator: "json",
      eventCount: 1,
      bytes: Buffer.byteLength(text(result)),
    });
  });

  it("refuses responses over the size limit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opentp-mcp-server-"));
    try {
      fs.cpSync(FIXTURE, root, { recursive: true });
      const file = path.join(root, "events/auth/2/false/login_button_click.yaml");
      const yaml = fs.readFileSync(file, "utf8");
      fs.writeFileSync(
        file,
        yaml.replace(
          "      user_id:\n",
          `      notes:\n        type: string\n        description: "${"x".repeat(300_000)}"\n      user_id:\n`,
        ),
      );
      const mcp = await connect(root);
      const result = await mcp.callTool({ name: "get_event", arguments: { key: LOGIN_KEY } });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/more than the 256 KB limit/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports tool errors and invalid arguments as error results", async () => {
    const mcp = await connect();
    const unknown = await mcp.callTool({ name: "get_event", arguments: { key: "nope" } });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain("No event with key 'nope'");

    const invalid = await mcp.callTool({ name: "search_events", arguments: { query: "" } });
    expect(invalid.isError).toBe(true);
  });

  it("reports a plan that cannot be loaded from every tool", async () => {
    const mcp = await connect(path.resolve("tests/data/no-such-plan"));
    const result = await mcp.callTool({ name: "describe_plan", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("opentp.yaml not found");
  });

  it("serves the plan summary and events as resources", async () => {
    const mcp = await connect();
    const summary = await mcp.readResource({ uri: "opentp://plan/summary" });
    const [summaryContent] = summary.contents as Array<{ text: string }>;
    expect(JSON.parse(summaryContent?.text ?? "{}").counts.events).toBe(4);

    const event = await mcp.readResource({
      uri: `opentp://events/${encodeURIComponent(LOGIN_KEY)}`,
    });
    const [eventContent] = event.contents as Array<{ text: string }>;
    expect(JSON.parse(eventContent?.text ?? "{}").key).toBe(LOGIN_KEY);

    // An unknown key is "resource not found" (SDK v2: -32602 with the URI), not an internal error
    await expect(mcp.readResource({ uri: "opentp://events/nope" })).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining("No event with key 'nope'"),
    });
  });
});
