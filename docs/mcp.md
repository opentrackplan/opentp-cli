---
title: mcp
description: Serve your tracking plan to AI agents over the Model Context Protocol.
sidebar:
  order: 4
---

# opentp mcp

Serves your tracking plan to AI agents (Claude Code, Codex, Cursor, VS Code, Claude Desktop and other [MCP](https://modelcontextprotocol.io) clients) over stdio. The agent starts `opentp mcp` itself and can then search events, read their effective payload, and check a new or changed event against the plan.

Every tool is **read-only**: `opentp mcp` never writes a file. An agent that adds or changes an event writes the YAML file itself, guided by `suggest_event` and checked by `validate_event_draft` or `validate_plan`.

## Usage

```bash
opentp mcp [options]
```

| Option | Description |
|--------|-------------|
| `--root <path>`, `-r <path>` | Project root (default: `$OPENTP_ROOT`, otherwise the current directory) |
| `--external-rules <dir>` | Load custom checks used by the validation tools (repeatable) |
| `--external-transforms <dir>` | Load custom transform steps used by keygen (repeatable) |
| `--verbose`, `-v` | Debug logs (on stderr) |

You normally do not run it by hand: you register it in your agent, which starts it when it needs it. Run by hand, it waits for MCP messages on stdin; press Ctrl+D (or Ctrl+C) to stop it.

## Connect your agent

Commit the configuration to the plan repository, so that everyone who clones it gets the tools. The examples assume `opentp` is on the `PATH` of the agent (see the notes below).

**Claude Code, VS Code 1.140+ and GitHub Copilot CLI** read `.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "opentp": { "command": "opentp", "args": ["mcp"] }
  }
}
```

With Claude Code you can also run `claude mcp add --transport stdio --scope project opentp -- opentp mcp`, which writes the same file.

**Cursor** reads `.cursor/mcp.json`; `${workspaceFolder}` makes the root explicit:

```json
{
  "mcpServers": {
    "opentp": { "command": "opentp", "args": ["mcp", "--root", "${workspaceFolder}"] }
  }
}
```

**Codex** reads `.codex/config.toml` in trusted projects (or `~/.codex/config.toml`):

```toml
[mcp_servers.opentp]
command = "opentp"
args = ["mcp"]
```

**Older VS Code** reads `.vscode/mcp.json`:

```json
{
  "servers": {
    "opentp": { "type": "stdio", "command": "opentp", "args": ["mcp"] }
  }
}
```

**Claude Desktop** (chat) starts local servers from `claude_desktop_config.json` (Settings > Developer > Edit Config; `~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows), outside any project, so use absolute paths, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "opentp": {
      "command": "/Users/you/.opentp/bin/opentp",
      "args": ["mcp", "--root", "/path/to/plan"]
    }
  }
}
```

Notes:

- **Root:** like every command, `opentp mcp` uses `--root`, else `$OPENTP_ROOT`, else the current directory, and it must find `opentp.yaml` there. Clients do not all promise to start a server in the project folder: VS Code starts it in the workspace folder; in Cursor use `${workspaceFolder}` as above; Codex has a `cwd` setting for a server (its IDE extension has been reported to start servers in its own installation folder). If the client shows the server as failed, its stderr says `opentp.yaml not found`: set `--root`. When `opentp.yaml` is in a subfolder of the repository, a relative root such as `"args": ["mcp", "--root", "tracking-plan"]` works wherever the folder is checked out.
- **`PATH`:** apps started from a desktop launcher may not see the `PATH` of your shell, so `opentp` installed in `~/.opentp/bin` may not be found. Use the absolute path of the binary as `command` then.
- **Hosted chat apps** (claude.ai on the web and mobile, ChatGPT) call MCP servers from the vendor's cloud and cannot start `opentp mcp` on your machine. They need a server reachable from that cloud (or a vendor tunnel, such as OpenAI's Secure MCP Tunnel); `opentp mcp` alone is for agents that run on your machine.

## Tools

| Tool | What it returns |
|------|-----------------|
| `describe_plan` | The plan's structure: taxonomy fields (and which come from the file path), the path template, key rules and the keygen template, targets, common payload fields, PII settings, counts. Agents call it first. |
| `search_events` | Events matching words or a description (`query`, at most 1000 characters; optional `limit`, default 10, at most 50): key, file, score, status and taxonomy. A query that is a whole key (or an old key from `aliases`) puts that event first. |
| `get_event` | One event by `key` (or an old key from its `aliases`): file, taxonomy, lifecycle, and the effective payload schema per target and version, with the common fields merged in (`spec.events.payload.schema`, then `spec.targets.<target>.schema`, then the event). Targets with the same schema are grouped. Optional `target` and `version` (a version or alias; default: each target's current version). |
| `list_dictionaries` | Dictionary names, as used in `dict:`, with their value counts. |
| `get_dictionary` | The values of one dictionary (`name`, e.g. `taxonomy/areas`). |
| `validate_event_draft` | Validates event YAML (`yaml`, at most 1,000,000 characters) as if it were saved at `path` (relative to the events root or the project root), without writing it: the path against the path template, taxonomy, the key (including uniqueness across the plan) and the payload. Says whether the path already holds a file, and whether opentp can load it. `webhook` checks that the draft defines itself are not run. |
| `validate_plan` | The validation errors of the whole plan, as `opentp validate` reports them (default `limit` 100). With `files`: their errors, and for each file whether opentp loads it (`loaded`), cannot load it (`load-error`), skips it because it does not match the path template or is not YAML (`not-loaded`), or cannot find it (`not-found`); `filesValid` is true only when every file is loaded and has no errors. |
| `suggest_event` | For `taxonomy` values (including the ones that form the file path): the file path, the generated key, a YAML skeleton, the required common payload fields, conflicts with existing events, and the errors the skeleton still has. |
| `generate` | An export of the plan, or of some events (`keys`), with the `json` or `yaml` generator, like `opentp generate`. The export is the text of the response; its structured content holds only `generator`, `eventCount` and `bytes`. |

The server also offers two resources: `opentp://plan/summary` (the same as `describe_plan`) and `opentp://events/{key}` (the same as `get_event`; the key is URL-encoded, and an unknown key is a "resource not found" error).

The text of one tool result is at most 256 KB (UTF-8). A larger result is refused with a message that says how to narrow it: `target` and `version` for `get_event`, `keys` for `generate` (or run `opentp generate` in a terminal), a lower `limit`.

A typical session to add an event: `describe_plan` → `search_events` (does it exist already?) → `suggest_event` → the agent writes the file → `validate_event_draft` or `validate_plan`.

## Search

`search_events` is a lexical search (BM25 over character trigrams) over each event's key, taxonomy values (for example a trigger description) and the payload fields the event defines: their names, titles, descriptions, fixed values and short enums. It works the same for every language, tolerates typos and word forms, and needs no setup or model. Plain words work best.

## Behavior

- The plan is loaded when the server starts. If `opentp.yaml` is missing or cannot be loaded, `opentp mcp` exits with code `2` before serving anything, like the other commands.
- Each call checks whether any file of the plan changed (modification time and size of `opentp.yaml` and of every file under the events and dictionaries roots) and reloads the plan if so. An agent that edits an event file sees the change in its next call. If the plan becomes unloadable while the server runs, every tool returns that error until it is fixed.
- `generate` refuses a plan that cannot be loaded completely, like `opentp generate`.
- If `spec.paths.events.template` in `opentp.yaml` is unusable, `suggest_event` and `validate_event_draft` say so instead of guessing a path, and `describe_plan` lists the problems.
- Validation runs the plan's checks, including `webhook` checks from `opentp.yaml` and from the event files on disk (those tools are marked as reaching outside the server). A draft's own `webhook` checks are never run. Mind what an agent writes to event files: a webhook check there runs on the next `validate_plan`.
- stdout carries only the MCP protocol. Logs, and anything an external plugin prints, go to stderr.
- The server exits with code `0` when the client closes stdin.
