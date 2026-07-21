import type { TrackingEvent, TaxonomyField } from "../types";

export interface TreeNode {
	/** Display label for this node (the taxonomy field value) */
	label: string;
	/** Taxonomy field key this node represents (e.g. "area", "application") */
	taxonomyKey: string;
	/** Depth level in the tree (0 = root level) */
	depth: number;
	/** Unique path to this node, e.g. "alfa-mobile/deposits" */
	path: string;
	/** Child nodes (next taxonomy level) */
	children: TreeNode[];
	/** Leaf events (only on the deepest branch level) */
	events: TrackingEvent[];
	/** Total event count (including all descendants) */
	eventCount: number;
}

/**
 * Auto-detect which taxonomy fields make good tree levels.
 *
 * A field qualifies if:
 * - `type === "string"` (exclude numbers/booleans)
 * - `uniqueValues < totalEvents` (grouping adds value — the field actually groups)
 * - It is not the last taxonomy field (that's the leaf label)
 *
 * Returns an ordered array of field keys suitable for tree grouping.
 */
export function detectTreeLevels(
	events: TrackingEvent[],
	taxonomyDefs: Record<string, TaxonomyField>,
): string[] {
	const fieldKeys = Object.keys(taxonomyDefs);

	// Need at least 2 fields (one for grouping, one for leaf label)
	if (fieldKeys.length <= 1) return [];

	// Candidates = all fields except the last (leaf label)
	const candidates = fieldKeys.slice(0, -1);

	const totalEvents = events.length;
	if (totalEvents === 0) return [];

	return candidates.filter((key) => {
		const def = taxonomyDefs[key];
		// Only string-type fields
		if (def.type !== "string") return false;

		// Count unique values
		const uniqueValues = new Set(
			events.map((e) => String(e.taxonomy[key] ?? "Unknown")),
		).size;

		// Field must actually group (fewer unique values than events)
		return uniqueValues < totalEvents;
	});
}

/** Metadata for a candidate tree field, used by `getCandidateTreeFields`. */
export interface CandidateTreeField {
	key: string;
	title: string;
	uniqueCount: number;
	isAutoDetected: boolean;
}

/**
 * Return all string-type candidate fields with metadata.
 *
 * Useful for future UI that lets users pick which fields to group by.
 * `isAutoDetected` is true when the field would be picked by `detectTreeLevels`.
 */
export function getCandidateTreeFields(
	events: TrackingEvent[],
	taxonomyDefs: Record<string, TaxonomyField>,
): CandidateTreeField[] {
	const fieldKeys = Object.keys(taxonomyDefs);
	if (fieldKeys.length <= 1) return [];

	const candidates = fieldKeys.slice(0, -1);
	const autoDetected = new Set(detectTreeLevels(events, taxonomyDefs));

	return candidates
		.filter((key) => taxonomyDefs[key].type === "string")
		.map((key) => {
			const uniqueCount = new Set(
				events.map((e) => String(e.taxonomy[key] ?? "Unknown")),
			).size;

			return {
				key,
				title: taxonomyDefs[key].title,
				uniqueCount,
				isAutoDetected: autoDetected.has(key),
			};
		});
}

/**
 * Build a tree from flat events using taxonomy field order.
 *
 * If `overrideLevels` is provided (non-empty array), those field keys are used
 * as tree levels. Otherwise, levels are auto-detected via `detectTreeLevels`.
 *
 * Example taxonomy: { application, area, event }
 * → Auto-detect might pick: [area] (if application is unique per event)
 * → Override: ["application", "area"] forces both levels
 */
export function buildTree(
	events: TrackingEvent[],
	taxonomyDefs: Record<string, TaxonomyField>,
	overrideLevels?: string[],
): TreeNode[] {
	// Determine effective tree levels
	const treeLevels =
		overrideLevels && overrideLevels.length > 0
			? overrideLevels
			: detectTreeLevels(events, taxonomyDefs);

	if (treeLevels.length === 0) return [];

	// Build tree recursively
	return buildLevel(events, treeLevels, 0, "");
}

function buildLevel(
	events: TrackingEvent[],
	levels: string[],
	depth: number,
	parentPath: string,
): TreeNode[] {
	if (depth >= levels.length) return [];

	const currentField = levels[depth];

	// Group events by current taxonomy field value
	const groups = new Map<string, TrackingEvent[]>();
	for (const event of events) {
		const value = String(event.taxonomy[currentField] ?? "Unknown");
		if (!groups.has(value)) groups.set(value, []);
		// biome-ignore lint/style/noNonNullAssertion: checked with has()
		groups.get(value)!.push(event);
	}

	// Convert groups to tree nodes
	const nodes: TreeNode[] = [];
	for (const [label, groupEvents] of groups) {
		const path = parentPath ? `${parentPath}/${label}` : label;
		const isLastLevel = depth === levels.length - 1;

		const node: TreeNode = {
			label,
			taxonomyKey: currentField,
			depth,
			path,
			children: isLastLevel
				? []
				: buildLevel(groupEvents, levels, depth + 1, path),
			events: isLastLevel ? groupEvents : [],
			eventCount: groupEvents.length,
		};

		nodes.push(node);
	}

	// Sort alphabetically
	nodes.sort((a, b) => a.label.localeCompare(b.label));

	return nodes;
}

/**
 * Collect all events under a tree node (including all descendants).
 */
export function collectEvents(node: TreeNode): TrackingEvent[] {
	if (node.events.length > 0) return node.events;
	return node.children.flatMap(collectEvents);
}

/**
 * Find a tree node by path.
 */
export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
	for (const node of nodes) {
		if (node.path === path) return node;
		const found = findNode(node.children, path);
		if (found) return found;
	}
	return null;
}
