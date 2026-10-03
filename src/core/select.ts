/**
 * Event selection for generator runs (`generate.run[].target` and `.events` in opentp.cli.yaml).
 */

import type { OpenTPConfig, ResolvedEvent } from "../types";
import { isYamlMapping } from "../util";
import { resolveEventPayload } from "./payload";

type Scalar = string | number | boolean;

export interface EventFilter {
  /** Only events whose payload covers this target id (a selector names it) */
  target?: string;
  /** Taxonomy field -> value or list of values; every listed field must match */
  events?: Record<string, Scalar | Scalar[]>;
}

/** Problems of a filter against the plan: an unknown target id or taxonomy field */
export function getEventFilterProblems(filter: EventFilter, config: OpenTPConfig): string[] {
  const problems: string[] = [];
  const all = config.spec.events.payload.targets.all;
  if (filter.target !== undefined && !(Array.isArray(all) && all.includes(filter.target))) {
    problems.push(
      `target: unknown target '${filter.target}' (targets: ${Array.isArray(all) ? all.join(", ") : "none"})`,
    );
  }
  const taxonomy = isYamlMapping(config.spec.events.taxonomy) ? config.spec.events.taxonomy : {};
  const fragments = new Set<string>();
  for (const field of Object.values(taxonomy)) {
    if (isYamlMapping(field) && isYamlMapping(field.fragments)) {
      for (const name of Object.keys(field.fragments)) fragments.add(name);
    }
  }
  for (const name of Object.keys(filter.events ?? {})) {
    if (!Object.hasOwn(taxonomy, name) && !fragments.has(name)) {
      problems.push(`events.${name}: '${name}' is not a taxonomy field or fragment`);
    }
  }
  return problems;
}

/** Whether a taxonomy value matches a filter value or list (same type and value) */
function matches(value: unknown, wanted: Scalar | Scalar[]): boolean {
  return Array.isArray(wanted) ? wanted.some((item) => item === value) : wanted === value;
}

/** The events that pass a filter, in their order */
export function filterEvents(
  events: ResolvedEvent[],
  config: OpenTPConfig,
  filter: EventFilter,
): ResolvedEvent[] {
  return events.filter((event) => {
    for (const [name, wanted] of Object.entries(filter.events ?? {})) {
      if (!matches(event.taxonomy[name], wanted)) return false;
    }
    if (filter.target !== undefined) {
      // Coverage comes from the selectors: a version that does not resolve is a validation error,
      // not a reason to leave the event out of a target's output
      const { covered } = resolveEventPayload(event.payload, config);
      if (!covered.includes(filter.target)) return false;
    }
    return true;
  });
}
