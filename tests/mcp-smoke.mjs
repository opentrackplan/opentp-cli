#!/usr/bin/env node
// Smoke test for `opentp mcp` over stdio, with no dependencies (the release workflow runs it against
// each compiled binary, where devDependencies are not installed).
//
// Usage: node tests/mcp-smoke.mjs <command> [args...]
//   node tests/mcp-smoke.mjs node dist/index.cjs mcp --root tests/data/coverage-valid
//   node tests/mcp-smoke.mjs ./opentp-mac mcp --root tests/data/coverage-valid
// CI and the release workflow also pass the plugins in tests/data/mcp-noisy-plugins, which print to
// stdout at import: any stdout line that is not JSON-RPC fails the test.
//
// It speaks raw JSON-RPC (newline-delimited, a 2025-era initialize handshake), checks the tool list,
// calls a few read-only tools against the coverage-valid fixture, closes stdin, and requires the
// server to exit with code 0. Any failure exits 1 with a message.

import { spawn } from "node:child_process";
import * as path from "node:path";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node tests/mcp-smoke.mjs <command> [args...]");
  process.exit(2);
}

const EXPECTED_TOOLS = [
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
const LOGIN_KEY = "auth::login_button_click::click::login_button::p2::internal-false";

// A relative path such as ./opentp.exe (release smoke on Windows) is resolved against the cwd
const executable = /[\\/]/.test(command) ? path.resolve(command) : command;
const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const onEarlyExit = (code) => fail(`server exited early with code ${code}`);
child.on("exit", onEarlyExit);

const pending = new Map();
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(`stdout is not JSON-RPC: ${line.slice(0, 200)}`);
    }
    const waiter = message.id !== undefined ? pending.get(message.id) : undefined;
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  }
});

const timer = setTimeout(() => fail("timed out after 20 s"), 20_000);

function fail(message) {
  console.error(`✗ mcp smoke: ${message}`);
  if (stderr) console.error(`--- server stderr ---\n${stderr}`);
  child.kill();
  process.exit(1);
}

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

async function callTool(name, args) {
  const response = await request("tools/call", { name, arguments: args });
  if (response.error) fail(`${name}: JSON-RPC error ${JSON.stringify(response.error)}`);
  if (response.result.isError) fail(`${name}: tool error ${JSON.stringify(response.result.content)}`);
  return response.result.structuredContent ?? JSON.parse(response.result.content[0].text);
}

const init = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "opentp-mcp-smoke", version: "1.0.0" },
});
if (init.error) fail(`initialize: ${JSON.stringify(init.error)}`);
if (init.result.serverInfo?.name !== "opentp") fail(`unexpected serverInfo ${JSON.stringify(init.result.serverInfo)}`);
notify("notifications/initialized", {});

const list = await request("tools/list", {});
const tools = (list.result?.tools ?? []).map((tool) => tool.name).sort();
if (JSON.stringify(tools) !== JSON.stringify(EXPECTED_TOOLS)) {
  fail(`tools/list returned ${JSON.stringify(tools)}`);
}
const writable = list.result.tools.filter((tool) => tool.annotations?.readOnlyHint !== true);
if (writable.length > 0) fail(`tools without readOnlyHint: ${writable.map((tool) => tool.name)}`);

const search = await callTool("search_events", { query: "login button" });
if (search.results?.[0]?.key !== LOGIN_KEY) fail(`search_events top hit: ${JSON.stringify(search.results?.[0])}`);

const event = await callTool("get_event", { key: LOGIN_KEY });
if (!Array.isArray(event.payload) || event.payload.length === 0) fail("get_event returned no payload");

const plan = await callTool("validate_plan", {});
if (plan.valid !== true || plan.eventCount !== 4) fail(`validate_plan: ${JSON.stringify(plan)}`);

child.off("exit", onEarlyExit);
child.stdin.end();
const exitCode = await new Promise((resolve) => child.on("exit", (code) => resolve(code)));
clearTimeout(timer);
if (exitCode !== 0) fail(`server exited with code ${exitCode} after stdin was closed`);
console.log(`✓ mcp smoke: ${tools.length} tools, search/get_event/validate_plan OK, clean exit`);
