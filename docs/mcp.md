---
title: mcp
description: Serve your tracking plan to AI agents over the Model Context Protocol.
sidebar:
  order: 6
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
| `--cli-config <path>` | The [`opentp.cli.yaml`](/cli/config) to use (default: the one in the project root) |
| `--fail-on <rule>[,<rule>...]` | Report these tool rules as errors in the validation tools: `overlap`, `unknownCheck` |
| `--allow-plugins` | Load the plugins named in `opentp.cli.yaml` (`keygen.plugins`, `checks.plugins`) |
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
| `describe_plan` | The plan's structure (see below): taxonomy fields (and which come from the file path), the path template, key rules and whether `keygen` is configured, targets, the field catalog, the common fields of each target with their policy, `spec.checks`, the tracker binding, PII settings, counts. Agents call it first. |
| `search_events` | Events matching words or a description (`query`, at most 1000 characters; optional `limit`, default 10, at most 50): key, file, score, status and taxonomy. A query that is a whole key (or an old key from `aliases`) puts that event first. |
| `get_event` | One event by `key` (or an old key from its `aliases`): file, taxonomy, lifecycle, and the effective payload per target and version: the common fields of the target plus the fields the event lists, merged over the catalog (`schema`), with the layers each field comes from (`layers`: `catalog`, `all`, `target`, `event`). Targets with the same schema are grouped. Optional `target` and `version` (a version or alias; default: each target's current version). |
| `list_dictionaries` | Dictionary names, as used in `dict:`, with their value counts. |
| `get_dictionary` | The values of one dictionary (`name`, e.g. `taxonomy/areas`). |
| `validate_event_draft` | Validates event YAML (`yaml`, at most 1,000,000 characters) as if it were saved at `path` (relative to the events root or the project root), without writing it: the path against the path template, taxonomy, the key (including uniqueness across the plan) and the payload. Returns `errors` (they make it invalid) and `warnings`: unknown check ids, and the plan events whose payloads can match the same hits as the draft (rule `overlap`; the event at the same path is left out; more than 20 become one summary warning, see [Overlapping events](/cli/validate#overlapping-events)). Says whether the path already holds a file, and whether opentp can load it. Webhook bindings are not run for a draft (a `note` names them). |
| `validate_plan` | The errors and warnings of the whole plan, as `opentp validate` reports them (default `limit` 100; `valid` is false only with errors). With `files`: their errors and warnings, and for each file whether opentp loads it (`loaded`), cannot load it (`load-error`), skips it because it does not match the path template or is not YAML (`not-loaded`), or cannot find it (`not-found`); `filesValid` is true only when every file is loaded and has no errors. |
| `suggest_event` | For `taxonomy` values (including the ones that form the file path): the file path, the key generated by `keygen` in `opentp.cli.yaml`, a YAML skeleton that lists every field with a policy, the required common payload fields, conflicts with existing events, and the errors the skeleton still has (`skeletonErrors`). |
| `generate` | An export of the plan, like `opentp generate`, returned as text: never written to a file. Pass `generator` (`json` or `yaml`), or `run`: the index of a `generate.run` entry of `opentp.cli.yaml` (0 is the first), whose generator, `target`, `events` and template `file` are used (the `file` must be inside the directory of `opentp.cli.yaml`: an absolute path, a `.git` segment or a path that leaves it gives an error result naming `generate.run[<i>].file`); `keys` exports only some events. The export is the text of the response; its structured content holds only metadata (`generator`, `eventCount`, `bytes`, and for `run` also `run`, `entryOutput` and a `note`). Plugin generators are not loaded by `opentp mcp`. |

The server also offers two resources: `opentp://plan/summary` (the same as `describe_plan`) and `opentp://events/{key}` (the same as `get_event`; the key is URL-encoded, and an unknown key is a "resource not found" error).

The text of one tool result is at most 256 KB (UTF-8). A larger result is refused with a message that says how to narrow it: `target` and `version` for `get_event`, `keys` for `generate` (or run `opentp generate` in a terminal), a lower `limit`.

A typical session to add an event: `describe_plan` → `search_events` (does it exist already?) → `suggest_event` → the agent writes the file → `validate_event_draft` or `validate_plan`.

### Tool groups

`mcp.tools` in `opentp.cli.yaml` limits the tools the server registers, by group:

```yaml
# opentp.cli.yaml
opentp: 2026-09
mcp:
  tools: [describe, search]
```

| Group | Tools and resources |
|---|---|
| `describe` | `describe_plan`, `get_event`, `list_dictionaries`, `get_dictionary`, `suggest_event`, both resources |
| `search` | `search_events` |
| `validate` | `validate_event_draft`, `validate_plan` |
| `generate` | `generate` |

Without `mcp.tools` all four groups are served. The list needs at least one group: `tools: []` stops `opentp mcp` (and every other command) with exit code `2` (`opentp.cli.yaml: mcp.tools: List at least one tool group (describe, search, validate, generate), or leave out mcp.tools to serve all`). The instructions that the server sends to the agent when it connects, the tool descriptions and the `howTo` of `describe_plan` name only the tools of the groups it serves.

### describe_plan

| Key | Content |
|---|---|
| `title`, `version`, `description`, `opentp` | From `opentp.yaml` |
| `pinnedPlan` | Only in an application repository: `plan:` as written in `opentp.cli.yaml` |
| `eventsRoot`, `pathTemplate`, `dictionariesRoot` | Where event and dictionary files are (`pathTemplateProblems` when the template is unusable) |
| `taxonomy` | The taxonomy fields, each with `fromPath` (its value comes from the file path) |
| `key` | `constraints` (`spec.events.key`), `keygen` (whether `opentp.cli.yaml` configures it) and `keygenTemplate` |
| `targets` | `spec.events.payload.targets`: `all` and the selector groups |
| `catalog` | The field catalog (`spec.events.payload.schema`): the fields events may use |
| `commonFields` | Per target id: the fields of `spec.targets.all.schema` and `spec.targets.<id>.schema`, merged over the catalog, with their `policy` |
| `targetSettings` | The `title`, `description` and `x-*` keys of `spec.targets` entries, when there are any |
| `checks` | `spec.checks` |
| `tracker` | The resolved [tracker binding](/cli/config#the-resolved-binding) per target id, or `null` |
| `pii` | `spec.events.pii`, or `null` |
| `counts` | `events`, `dictionaries` and `loadProblems` |
| `howTo` | Short instructions for the agent (they name only the tools that the server serves) |

### suggest_event

The skeleton lists every field that has a policy on the targets the event covers, with a placeholder to replace: `value: <...>` for `fixed`, `enum: ["<...>"]` for `restricted`, `{}` for `specified` (and the value itself when `opentp.yaml` already fixes it). A `restricted` field can take a `value` (or a `dict`) instead of the enum. An array field gets `value: ["<...>"]` for both `fixed` and `restricted`, and takes only a value: `enum` and `dict` are not allowed on arrays. It is one implicit payload when every target needs the same fields, otherwise one payload per target id. For the [getting-started](/cli/getting-started) plan:

```json
{
  "file": "events/auth/logout_click.yaml",
  "key": "auth::logout_click",
  "missingTaxonomy": [],
  "problems": [],
  "existingFile": null,
  "keyUsedBy": null,
  "requiredPayloadFields": [
    {
      "name": "event_name",
      "type": "string",
      "targets": [
        "web",
        "ios",
        "android"
      ],
      "policy": "fixed"
    }
  ],
  "skeleton": "opentp: 2026-09\nevent:\n  key: auth::logout_click\n  taxonomy:\n    action: User clicks the logout button\n  payload:\n    schema:\n      event_name:\n        value: <...>\n",
  "skeletonErrors": [],
  "next": "Fill in the payload (and any missing taxonomy), write the file, then call validate_event_draft or validate_plan."
}
```

A placeholder that the field does not accept (for example in an enum) shows up in `skeletonErrors` until it is replaced.

## Search

`search_events` is a lexical search (BM25 over character trigrams) over each event's key, taxonomy values (for example a trigger description) and the payload fields the event defines: their names, titles, descriptions, fixed values and short enums. It works the same for every language, tolerates typos and word forms, and needs no setup or model. Plain words work best.

## Behavior

- `opentp mcp` needs `opentp.yaml` in the root (or a usable `plan:` in an application repository) and a usable `opentp.cli.yaml`; otherwise it exits with code `2` before serving anything. A plan that exists but cannot be loaded (for example a `2026-01` plan, which needs `opentp migrate`) does not stop the server: every tool returns the problem until it is fixed.
- Each call checks whether any file of the plan changed (modification time and size of `opentp.yaml`, `opentp.cli.yaml` and every file under the events and dictionaries roots) and reloads the plan if so. An agent that edits an event file sees the change in its next call. Plugins and the `mcp` section of `opentp.cli.yaml` are read once, when the server starts.
- Tool rules follow `checks.severity` in `opentp.cli.yaml` and `--fail-on`: an overlap raised to `error` makes a draft invalid.
- `generate` refuses a plan that cannot be loaded completely, like `opentp generate`.
- If `spec.paths.events.template` in `opentp.yaml` is unusable, `suggest_event` and `validate_event_draft` say so instead of guessing a path, and `describe_plan` lists the problems.
- Validation runs the plan's checks, including webhook bindings from `opentp.cli.yaml` for the event files on disk and the values in `opentp.yaml` (those tools are marked as reaching outside the server). A draft never runs a webhook binding. Mind what an agent writes to event files: a check that refers to a webhook binding there runs on the next `validate_plan`.
- In an application repository (`plan:` in `opentp.cli.yaml`), the server works on the pinned plan; see [Application repositories](/cli/config#application-repositories).
- stdout carries only the MCP protocol. Logs, and anything an external plugin prints, go to stderr.
- The server exits with code `0` when the client closes stdin.
