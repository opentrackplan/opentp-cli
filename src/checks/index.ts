/**
 * Check ids (2026-09 `checks: { <id>: <params> }`) and how the CLI resolves them.
 *
 * An id names, in this order:
 * - a portable check in `spec.checks` (opentp.yaml; params `true` or `false`; it wins over a
 *   built-in or plugin rule of the same name, with a warning);
 * - a binding in opentp.cli.yaml `checks.bindings` (a webhook, or a rule with default params);
 * - a built-in rule or a plugin rule (`--external-rules`, `checks.plugins`).
 * Params `false` disable a check. `webhook` is reserved: webhooks are bound in opentp.cli.yaml.
 * Unknown ids are reported once per file by a static scan (tool rule `unknownCheck`) and skipped
 * silently at run time.
 */

import { portableCheckProblems } from "../core/constraints";
import { getRule, hasRule, type RuleContext, type RuleResult, runRule } from "../rules";
import type { CheckRef, ChecksMap, PortableCheck, ValidationError } from "../types";
import { isYamlMapping } from "../util";
import { callWebhook, type WebhookConfig } from "./webhook";

export {
  callWebhook,
  clearWebhookCache,
  getWebhookEnvAllowlist,
  type WebhookConfig,
} from "./webhook";

/** Check ids: a letter, then letters, digits, `_`, `.` or `-` (e.g. `mytool.starts-with`) */
export const CHECK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** The message for a check id that does not match CHECK_ID_PATTERN */
export function invalidCheckIdMessage(id: string): string {
  return `Invalid check id '${id}': it must start with a letter and contain only letters, digits, '_', '.' or '-'`;
}

/** The reserved check id: webhooks are bound in opentp.cli.yaml and referred to by binding id */
export const WEBHOOK_CHECK_ID = "webhook";

export const RESERVED_WEBHOOK_MESSAGE =
  "Webhook checks are bound in opentp.cli.yaml (checks.bindings.<id>.webhook); refer to them by id";

/** The configurable tool rules (severity off | warning | error) */
export const TOOL_RULES = ["overlap", "unknownCheck"] as const;
export type ToolRuleId = (typeof TOOL_RULES)[number];
export type Severity = "off" | "warning" | "error";
export type Severities = Record<ToolRuleId, Severity>;

export const DEFAULT_SEVERITIES: Readonly<Severities> = {
  overlap: "warning",
  unknownCheck: "warning",
};

export function isToolRuleId(value: unknown): value is ToolRuleId {
  return typeof value === "string" && (TOOL_RULES as readonly string[]).includes(value);
}

export function unknownCheckMessage(id: string): string {
  return `Unknown check '${id}': not in spec.checks, not a built-in or plugin check, not bound in opentp.cli.yaml`;
}

/** A check bound (checks.bindings) to a rule that was not loaded, e.g. a plugin rule without consent */
export function unloadedRuleMessage(id: string, rule: string): string {
  return `Check '${id}' is bound to rule '${rule}', which is not loaded: plugins from checks.plugins load only with --allow-plugins or OPENTP_ALLOW_PLUGINS=1`;
}

/** `checks.bindings.<id>` in opentp.cli.yaml: exactly one of a webhook or a rule */
export type CheckBinding = { webhook: WebhookConfig } | { rule: string; params?: unknown };

export type CheckKind = "portable" | "binding" | "rule" | "reserved" | "unknown";

export interface CheckEnvironmentOptions {
  /** `spec.checks` of opentp.yaml */
  specChecks?: Record<string, PortableCheck> | unknown;
  /** `checks.bindings` of opentp.cli.yaml */
  bindings?: Record<string, CheckBinding>;
  /** false: webhook bindings are not run (MCP drafts); their ids are collected in skippedWebhooks */
  runWebhooks?: boolean;
  /**
   * Application repository mode: ids of the plan repository's webhook bindings. They are not
   * bound (they never run there); as unknown checks they get a message that says why.
   */
  planWebhooks?: readonly string[];
}

/** The unknownCheck message of a check id whose webhook binding the plan repository defines */
export function planWebhookCheckMessage(id: string): string {
  return `Unknown check '${id}': its webhook binding comes from the plan repository's opentp.cli.yaml and is not run in an application repository`;
}

/** Resolves and runs check ids for one validation run */
export class CheckEnvironment {
  /** Webhook bindings that were not run because runWebhooks is false */
  readonly skippedWebhooks = new Set<string>();
  private readonly specChecks: Record<string, unknown>;
  private readonly bindings: Record<string, CheckBinding>;
  private readonly runWebhooks: boolean;
  private readonly planWebhooks: ReadonlySet<string>;

  constructor(options: CheckEnvironmentOptions = {}) {
    this.specChecks = isYamlMapping(options.specChecks) ? options.specChecks : {};
    this.bindings = options.bindings ?? {};
    this.runWebhooks = options.runWebhooks !== false;
    this.planWebhooks = new Set(options.planWebhooks ?? []);
  }

  /** A copy that does not run webhook bindings (for drafts) */
  withoutWebhooks(): CheckEnvironment {
    return new CheckEnvironment({
      specChecks: this.specChecks,
      bindings: this.bindings,
      runWebhooks: false,
      planWebhooks: [...this.planWebhooks],
    });
  }

  kind(id: string): CheckKind {
    if (id === WEBHOOK_CHECK_ID) return "reserved";
    if (Object.hasOwn(this.specChecks, id)) return "portable";
    if (Object.hasOwn(this.bindings, id)) {
      const binding = this.bindings[id];
      // A rule binding whose rule is not loaded (plugins not allowed) is unusable: unknown
      if ("rule" in binding && !hasRule(binding.rule)) return "unknown";
      return "binding";
    }
    if (hasRule(id)) return "rule";
    return "unknown";
  }

  /** Whether a binding id resolves to a webhook */
  isWebhookBinding(id: string): boolean {
    return this.kind(id) === "binding" && "webhook" in this.bindings[id];
  }

  /**
   * The problem of one written `checks` entry, if any: the reserved `webhook` id (error), params
   * of a portable check that are not true/false (error), or an unknown id (unknownCheck, with its
   * severity; null when off). Entries with params `false` are never reported.
   */
  classify(
    ref: CheckRef,
    severity: Severity,
  ): Pick<ValidationError, "path" | "message" | "severity" | "rule"> | null {
    if (ref.params === false) return null;
    const path = `${ref.path}.${ref.id}`;
    const kind = this.kind(ref.id);
    if (kind === "reserved") {
      return { path, message: RESERVED_WEBHOOK_MESSAGE, severity: "error" };
    }
    if (kind === "portable" && typeof ref.params !== "boolean") {
      return {
        path,
        message: `Check '${ref.id}' is defined in spec.checks: set it to true or false`,
        severity: "error",
      };
    }
    if (kind === "unknown" && severity !== "off") {
      const message = this.planWebhooks.has(ref.id)
        ? planWebhookCheckMessage(ref.id)
        : (this.unloadedRule(ref.id) ?? unknownCheckMessage(ref.id));
      return { path, message, severity, rule: "unknownCheck" };
    }
    return null;
  }

  /** For a binding to a rule that is not loaded: the message that says why it is unusable */
  private unloadedRule(id: string): string | null {
    if (!Object.hasOwn(this.bindings, id)) return null;
    const binding = this.bindings[id];
    if (!("rule" in binding) || hasRule(binding.rule)) return null;
    return unloadedRuleMessage(id, binding.rule);
  }

  /**
   * Runs the checks of one value in key order. Disabled (`false`), unknown and reserved ids are
   * skipped. A check that throws gives "check <id> failed: <message>".
   */
  async run(value: unknown, checks: ChecksMap, context: RuleContext): Promise<RuleResult[]> {
    const errors: RuleResult[] = [];
    for (const [id, params] of Object.entries(checks)) {
      if (params === false) continue;
      const result = await this.runOne(id, params, value, context);
      if (result && !result.valid) errors.push(result);
    }
    return errors;
  }

  /** Runs only the portable checks (`spec.checks`) of a map: for enum members */
  portableOnly(checks: ChecksMap): ChecksMap {
    return Object.fromEntries(
      Object.entries(checks).filter(([id]) => this.kind(id) === "portable"),
    );
  }

  private async runOne(
    id: string,
    params: unknown,
    value: unknown,
    context: RuleContext,
  ): Promise<RuleResult | null> {
    switch (this.kind(id)) {
      case "portable": {
        if (params !== true) return null;
        const definition = this.specChecks[id];
        if (!isYamlMapping(definition)) return null;
        const problems = portableCheckProblems(definition, value);
        if (problems.length === 0) return { valid: true };
        return {
          valid: false,
          error: problems.map((problem) => `${problem} (check '${id}')`).join("; "),
          code: "PORTABLE_CHECK_FAILED",
        };
      }
      case "binding": {
        const binding = this.bindings[id];
        if ("webhook" in binding) {
          if (!this.runWebhooks) {
            this.skippedWebhooks.add(id);
            return null;
          }
          try {
            return await callWebhook(value, binding.webhook, context, params);
          } catch (error) {
            return {
              valid: false,
              error: `check ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
              code: "CHECK_FAILED",
            };
          }
        }
        const rule = getRule(binding.rule);
        if (!rule) return null;
        // `true` means "use the binding's params"; anything else replaces them
        return runRule(id, rule, value, params === true ? binding.params : params, context);
      }
      case "rule": {
        const rule = getRule(id);
        return rule ? runRule(id, rule, value, params, context) : null;
      }
      default:
        return null;
    }
  }

  /**
   * One warning per `spec.checks` id that is also a built-in or plugin rule name: the plan
   * definition wins
   */
  shadowWarnings(): ValidationError[] {
    return Object.keys(this.specChecks)
      .filter((id) => id !== WEBHOOK_CHECK_ID && hasRule(id))
      .map((id) => ({
        event: "opentp.yaml",
        path: `spec.checks.${id}`,
        message: `spec.checks.${id} shadows the tool check '${id}'`,
        severity: "warning" as const,
      }));
  }
}

export interface BindingProblemOptions {
  /** true when checks.plugins were named but not loaded: rule bindings to them are not errors */
  pluginsSkipped?: boolean;
}

/**
 * Problems of `checks.bindings` that stop a run (exit 2): reserved or colliding ids (a built-in or
 * plugin rule, a `spec.checks` id) and rule bindings to rules that do not exist. Load plugins first.
 */
export function getBindingProblems(
  bindings: Record<string, CheckBinding>,
  specChecks: unknown,
  options: BindingProblemOptions = {},
): string[] {
  const problems: string[] = [];
  const portable = isYamlMapping(specChecks) ? specChecks : {};
  for (const [id, binding] of Object.entries(bindings)) {
    const path = `checks.bindings.${id}`;
    if (id === WEBHOOK_CHECK_ID) {
      problems.push(`${path}: 'webhook' is reserved; give the binding another id`);
      continue;
    }
    if (hasRule(id)) {
      problems.push(`${path}: '${id}' is already a built-in or plugin check; choose another id`);
    }
    if (Object.hasOwn(portable, id)) {
      problems.push(`${path}: '${id}' is already defined in spec.checks (opentp.yaml)`);
    }
    if ("rule" in binding) {
      if (binding.rule === WEBHOOK_CHECK_ID) {
        problems.push(`${path}.rule: 'webhook' is not a rule; bind it as { webhook: { url } }`);
      } else if (!hasRule(binding.rule) && !options.pluginsSkipped) {
        problems.push(
          `${path}.rule: unknown rule '${binding.rule}' (built-in checks, or plugins from checks.plugins or --external-rules)`,
        );
      }
    }
  }
  return problems;
}
