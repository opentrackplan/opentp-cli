import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { registerRule } from "../rules";
import {
  CheckEnvironment,
  DEFAULT_SEVERITIES,
  getBindingProblems,
  isToolRuleId,
  unknownCheckMessage,
} from "./index";
import { clearWebhookCache } from "./webhook";

const ctx = { fieldName: "name", fieldPath: "payload.web.schema.name.value", eventKey: "e" };
const id = `${process.pid}-${Date.now()}`;

beforeAll(() => {
  registerRule({
    name: `echo-${id}`,
    validate: (value, params) =>
      value === params ? { valid: true } : { valid: false, error: `got params ${String(params)}` },
  });
});

describe("CheckEnvironment.kind", () => {
  const env = new CheckEnvironment({
    specChecks: { "jira-key": { pattern: "^[A-Z]+-\\d+$" }, "starts-with": { maxLength: 3 } },
    bindings: {
      "ticket-exists": { webhook: { url: "https://checks.example.com/t" } },
      "usr-prefix": { rule: "starts-with", params: "usr_" },
      "from-plugin": { rule: "not-loaded-plugin-rule" },
    },
  });

  it("resolves portable checks, bindings, rules, the reserved id and unknown ids", () => {
    expect(env.kind("jira-key")).toBe("portable");
    // A spec.checks id that is also a rule: the plan definition wins
    expect(env.kind("starts-with")).toBe("portable");
    expect(env.kind("ticket-exists")).toBe("binding");
    expect(env.kind("usr-prefix")).toBe("binding");
    expect(env.kind("not-empty")).toBe("rule");
    expect(env.kind("webhook")).toBe("reserved");
    expect(env.kind("mytool.starts-with")).toBe("unknown");
    // A rule binding whose rule is not loaded cannot run: unknown
    expect(env.kind("from-plugin")).toBe("unknown");
    expect(env.isWebhookBinding("ticket-exists")).toBe(true);
    expect(env.isWebhookBinding("usr-prefix")).toBe(false);
  });

  it("warns once per spec.checks id that shadows a tool check", () => {
    expect(env.shadowWarnings()).toEqual([
      {
        event: "opentp.yaml",
        path: "spec.checks.starts-with",
        message: "spec.checks.starts-with shadows the tool check 'starts-with'",
        severity: "warning",
      },
    ]);
  });

  it("classifies written check entries", () => {
    const ref = (checkId: string, params: unknown) => ({ path: "x.checks", id: checkId, params });
    expect(env.classify(ref("mytool.x", true), "warning")).toEqual({
      path: "x.checks.mytool.x",
      message: unknownCheckMessage("mytool.x"),
      severity: "warning",
      rule: "unknownCheck",
    });
    expect(env.classify(ref("mytool.x", true), "error")?.severity).toBe("error");
    expect(env.classify(ref("mytool.x", true), "off")).toBeNull();
    // Disabled entries are never reported
    expect(env.classify(ref("mytool.x", false), "error")).toBeNull();
    expect(env.classify(ref("webhook", { url: "x" }), "off")).toEqual({
      path: "x.checks.webhook",
      message:
        "Webhook checks are bound in opentp.cli.yaml (checks.bindings.<id>.webhook); refer to them by id",
      severity: "error",
    });
    expect(env.classify(ref("jira-key", "yes"), "warning")).toEqual({
      path: "x.checks.jira-key",
      message: "Check 'jira-key' is defined in spec.checks: set it to true or false",
      severity: "error",
    });
    expect(env.classify(ref("jira-key", true), "error")).toBeNull();
    expect(env.classify(ref("ticket-exists", true), "error")).toBeNull();
  });
});

describe("CheckEnvironment.run", () => {
  it("applies portable checks to strings and numbers (code points), with the check id", async () => {
    const env = new CheckEnvironment({
      specChecks: {
        short: { maxLength: 2 },
        score: { minimum: 0, maximum: 10 },
        email: { format: "email" },
      },
    });
    // Two emoji are two code points
    expect(await env.run("😀😀", { short: true }, ctx)).toEqual([]);
    expect(await env.run("abc", { short: true }, ctx)).toEqual([
      {
        valid: false,
        error: "Expected length <= 2 (check 'short')",
        code: "PORTABLE_CHECK_FAILED",
      },
    ]);
    expect(await env.run(11, { score: true, short: true }, ctx)).toEqual([
      { valid: false, error: "Expected <= 10 (check 'score')", code: "PORTABLE_CHECK_FAILED" },
    ]);
    expect(await env.run("not-an-email", { email: true }, ctx)).toHaveLength(1);
    // Params other than true do not run a portable check (reported statically)
    expect(await env.run("abc", { short: { strict: true } }, ctx)).toEqual([]);
    expect(env.portableOnly({ short: true, "not-empty": true, nope: true })).toEqual({
      short: true,
    });
  });

  it("passes the binding params for true and the plan params otherwise", async () => {
    const env = new CheckEnvironment({
      bindings: { bound: { rule: `echo-${id}`, params: "default" } },
    });
    expect(await env.run("default", { bound: true }, ctx)).toEqual([]);
    expect(await env.run("custom", { bound: "custom" }, ctx)).toEqual([]);
    expect(await env.run("custom", { bound: true }, ctx)).toEqual([
      { valid: false, error: "got params default" },
    ]);
  });

  it("skips disabled, unknown and reserved checks (not-empty: false no longer enforces)", async () => {
    const env = new CheckEnvironment();
    expect(
      await env.run("", { "not-empty": false, nope: true, webhook: { url: "http://x" } }, ctx),
    ).toEqual([]);
    expect(await env.run("", { "not-empty": true }, ctx)).toHaveLength(1);
  });

  describe("webhook bindings", () => {
    let requests: unknown[] = [];
    let server: http.Server;
    let url = "";

    beforeAll(async () => {
      server = http.createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          requests.push(JSON.parse(body));
          response.statusCode = body.includes("bad") ? 422 : 200;
          response.end(JSON.stringify({ error: "rejected by the service" }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/check`;
      return () => server.close();
    });

    afterEach(() => {
      requests = [];
      clearWebhookCache();
    });

    it("sends the value and the plan params; a non-2xx response fails the check", async () => {
      const env = new CheckEnvironment({ bindings: { "ticket-exists": { webhook: { url } } } });
      expect(await env.run("good", { "ticket-exists": { project: "WEB" } }, ctx)).toEqual([]);
      expect(await env.run("bad", { "ticket-exists": true }, ctx)).toEqual([
        { valid: false, error: "rejected by the service", code: "WEBHOOK_VALIDATION_FAILED" },
      ]);
      expect(requests).toEqual([
        {
          field: "name",
          value: "good",
          params: { project: "WEB" },
          context: { eventKey: "e", fieldPath: "payload.web.schema.name.value" },
        },
        expect.objectContaining({ value: "bad", params: true }),
      ]);
    });

    it("does not run them without webhooks (drafts) and says which were skipped", async () => {
      const env = new CheckEnvironment({
        bindings: { "ticket-exists": { webhook: { url } } },
      }).withoutWebhooks();
      expect(await env.run("bad", { "ticket-exists": true }, ctx)).toEqual([]);
      expect([...env.skippedWebhooks]).toEqual(["ticket-exists"]);
      expect(requests).toEqual([]);
    });
  });
});

describe("getBindingProblems", () => {
  it("rejects reserved and colliding ids and unknown rules", () => {
    expect(
      getBindingProblems(
        {
          webhook: { webhook: { url: "x" } },
          pattern: { rule: "pattern" },
          "jira-key": { rule: "pattern" },
          hook: { rule: "webhook" },
          typo: { rule: "patern" },
          ok: { rule: "pattern", params: "^a" },
          remote: { webhook: { url: "https://x.example.com" } },
        },
        { "jira-key": { pattern: "x" } },
      ),
    ).toEqual([
      "checks.bindings.webhook: 'webhook' is reserved; give the binding another id",
      "checks.bindings.pattern: 'pattern' is already a built-in or plugin check; choose another id",
      "checks.bindings.jira-key: 'jira-key' is already defined in spec.checks (opentp.yaml)",
      "checks.bindings.hook.rule: 'webhook' is not a rule; bind it as { webhook: { url } }",
      "checks.bindings.typo.rule: unknown rule 'patern' (built-in checks, or plugins from checks.plugins or --external-rules)",
    ]);
  });

  it("accepts rule bindings to plugins that were not loaded (plugins not allowed)", () => {
    expect(
      getBindingProblems({ x: { rule: "plugin-rule" } }, undefined, { pluginsSkipped: true }),
    ).toEqual([]);
  });
});

describe("tool rules", () => {
  it("knows the configurable tool rules and their defaults", () => {
    expect(DEFAULT_SEVERITIES).toEqual({ overlap: "warning", unknownCheck: "warning" });
    expect(isToolRuleId("overlap")).toBe(true);
    expect(isToolRuleId("unknownCheck")).toBe(true);
    expect(isToolRuleId("unknown-check")).toBe(false);
  });
});
