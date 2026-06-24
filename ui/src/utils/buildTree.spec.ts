import { describe, it, expect } from "vitest";
import {
	detectTreeLevels,
	getCandidateTreeFields,
	buildTree,
} from "./buildTree";
import type { TrackingEvent, TaxonomyField } from "../types";

// ── Helpers ──────────────────────────────────────────────

function makeTaxonomy(
	fields: Record<string, Partial<TaxonomyField>>,
): Record<string, TaxonomyField> {
	const result: Record<string, TaxonomyField> = {};
	for (const [key, partial] of Object.entries(fields)) {
		result[key] = {
			title: partial.title ?? key,
			type: partial.type ?? "string",
			...partial,
		} as TaxonomyField;
	}
	return result;
}

function makeEvent(
	key: string,
	taxonomy: Record<string, unknown>,
): TrackingEvent {
	return {
		key,
		relativePath: `events/${key}.yaml`,
		taxonomy,
		payload: {},
	};
}

// ── Test data ────────────────────────────────────────────

// 4 events across 2 areas — "area" groups, "event" is unique per event
const sampleEvents: TrackingEvent[] = [
	makeEvent("page_view", { area: "acquisition", event: "page_view" }),
	makeEvent("sign_up", { area: "acquisition", event: "sign_up" }),
	makeEvent("deposit", { area: "banking", event: "deposit" }),
	makeEvent("withdrawal", { area: "banking", event: "withdrawal" }),
];

const sampleTaxonomy = makeTaxonomy({
	area: { title: "Area" },
	event: { title: "Event Name" },
});

// ── detectTreeLevels ─────────────────────────────────────

describe("detectTreeLevels", () => {
	it("returns only fields with uniqueValues < totalEvents and type string", () => {
		const levels = detectTreeLevels(sampleEvents, sampleTaxonomy);
		expect(levels).toEqual(["area"]);
	});

	it("excludes non-string fields (number, boolean)", () => {
		const taxonomy = makeTaxonomy({
			priority: { title: "Priority", type: "number" },
			area: { title: "Area", type: "string" },
			event: { title: "Event Name", type: "string" },
		});

		const events = [
			makeEvent("e1", { priority: 1, area: "a", event: "e1" }),
			makeEvent("e2", { priority: 1, area: "a", event: "e2" }),
			makeEvent("e3", { priority: 2, area: "b", event: "e3" }),
		];

		const levels = detectTreeLevels(events, taxonomy);
		// "priority" is number → excluded even though it groups (2 unique < 3 total)
		// "area" is string and groups (2 unique < 3 total) → included
		expect(levels).toEqual(["area"]);
	});

	it("returns [] when all fields are unique per event", () => {
		const taxonomy = makeTaxonomy({
			area: { title: "Area" },
			event: { title: "Event Name" },
		});

		// Each area value is unique — no grouping value
		const events = [
			makeEvent("e1", { area: "a", event: "e1" }),
			makeEvent("e2", { area: "b", event: "e2" }),
		];

		const levels = detectTreeLevels(events, taxonomy);
		expect(levels).toEqual([]);
	});

	it("returns [] when only 1 taxonomy field", () => {
		const taxonomy = makeTaxonomy({
			event: { title: "Event Name" },
		});

		const events = [
			makeEvent("e1", { event: "e1" }),
			makeEvent("e2", { event: "e2" }),
		];

		const levels = detectTreeLevels(events, taxonomy);
		expect(levels).toEqual([]);
	});

	it("returns [] for empty events array", () => {
		const levels = detectTreeLevels([], sampleTaxonomy);
		expect(levels).toEqual([]);
	});

	it("includes multiple fields when both group", () => {
		const taxonomy = makeTaxonomy({
			application: { title: "Application" },
			area: { title: "Area" },
			event: { title: "Event Name" },
		});

		const events = [
			makeEvent("e1", { application: "web", area: "acq", event: "e1" }),
			makeEvent("e2", { application: "web", area: "acq", event: "e2" }),
			makeEvent("e3", { application: "ios", area: "banking", event: "e3" }),
			makeEvent("e4", { application: "ios", area: "banking", event: "e4" }),
		];

		const levels = detectTreeLevels(events, taxonomy);
		expect(levels).toEqual(["application", "area"]);
	});
});

// ── getCandidateTreeFields ───────────────────────────────

describe("getCandidateTreeFields", () => {
	it("returns metadata with correct isAutoDetected flags", () => {
		const taxonomy = makeTaxonomy({
			application: { title: "Application" },
			area: { title: "Area" },
			event: { title: "Event Name" },
		});

		// application is unique per event (4 unique for 4 events), area groups
		const events = [
			makeEvent("e1", { application: "web", area: "acq", event: "e1" }),
			makeEvent("e2", { application: "ios", area: "acq", event: "e2" }),
			makeEvent("e3", { application: "android", area: "banking", event: "e3" }),
			makeEvent("e4", { application: "desktop", area: "banking", event: "e4" }),
		];

		const fields = getCandidateTreeFields(events, taxonomy);

		expect(fields).toEqual([
			{
				key: "application",
				title: "Application",
				uniqueCount: 4,
				isAutoDetected: false, // 4 unique = 4 events → not auto-detected
			},
			{
				key: "area",
				title: "Area",
				uniqueCount: 2,
				isAutoDetected: true, // 2 unique < 4 events → auto-detected
			},
		]);
	});

	it("excludes non-string fields", () => {
		const taxonomy = makeTaxonomy({
			priority: { title: "Priority", type: "number" },
			area: { title: "Area", type: "string" },
			event: { title: "Event Name", type: "string" },
		});

		const events = [
			makeEvent("e1", { priority: 1, area: "a", event: "e1" }),
			makeEvent("e2", { priority: 1, area: "a", event: "e2" }),
		];

		const fields = getCandidateTreeFields(events, taxonomy);
		expect(fields).toHaveLength(1);
		expect(fields[0].key).toBe("area");
	});

	it("returns [] when only 1 taxonomy field", () => {
		const taxonomy = makeTaxonomy({ event: { title: "Event" } });
		const events = [makeEvent("e1", { event: "e1" })];
		expect(getCandidateTreeFields(events, taxonomy)).toEqual([]);
	});
});

// ── buildTree ────────────────────────────────────────────

describe("buildTree", () => {
	it("with no override: uses auto-detected levels", () => {
		const tree = buildTree(sampleEvents, sampleTaxonomy);
		// auto-detect picks "area" (2 unique < 4 events)
		expect(tree).toHaveLength(2);
		expect(tree.map((n) => n.label).sort()).toEqual(["acquisition", "banking"]);
		expect(tree[0].taxonomyKey).toBe("area");
	});

	it("with override: uses override levels, ignores auto-detection", () => {
		const taxonomy = makeTaxonomy({
			application: { title: "Application" },
			area: { title: "Area" },
			event: { title: "Event Name" },
		});

		const events = [
			makeEvent("e1", { application: "web", area: "acq", event: "e1" }),
			makeEvent("e2", { application: "web", area: "bank", event: "e2" }),
			makeEvent("e3", { application: "ios", area: "acq", event: "e3" }),
		];

		// Force both levels even if auto-detect wouldn't pick application
		const tree = buildTree(events, taxonomy, ["application", "area"]);
		expect(tree).toHaveLength(2); // "ios", "web"
		expect(tree[0].taxonomyKey).toBe("application");
		// Verify second level
		const webNode = tree.find((n) => n.label === "web");
		expect(webNode?.children).toHaveLength(2); // "acq", "bank"
		expect(webNode?.children[0].taxonomyKey).toBe("area");
	});

	it("with empty override: falls back to auto-detection", () => {
		const tree = buildTree(sampleEvents, sampleTaxonomy, []);
		// Empty array → falls back to detectTreeLevels
		expect(tree).toHaveLength(2);
		expect(tree.map((n) => n.label).sort()).toEqual(["acquisition", "banking"]);
	});

	it("returns [] when auto-detection finds no groupable fields", () => {
		const taxonomy = makeTaxonomy({
			area: { title: "Area" },
			event: { title: "Event Name" },
		});

		// Each area is unique → no grouping
		const events = [
			makeEvent("e1", { area: "a", event: "e1" }),
			makeEvent("e2", { area: "b", event: "e2" }),
		];

		const tree = buildTree(events, taxonomy);
		expect(tree).toEqual([]);
	});

	it("override with single level produces flat groups", () => {
		const tree = buildTree(sampleEvents, sampleTaxonomy, ["area"]);
		expect(tree).toHaveLength(2);
		// Each node should have events directly (leaf level)
		for (const node of tree) {
			expect(node.events.length).toBeGreaterThan(0);
			expect(node.children).toHaveLength(0);
		}
	});
});
