import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { TreeNav } from "./TreeNav";
import type { TrackingEvent, TaxonomyField } from "../../types";
import type { UseTreeStateResult } from "../../hooks/useTreeState";

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

function makeTreeState(overrides?: Partial<UseTreeStateResult>): UseTreeStateResult {
	return {
		expanded: new Set<string>(),
		toggle: () => {},
		expand: () => {},
		collapse: () => {},
		expandAll: () => {},
		collapseAll: () => {},
		selectedPath: null,
		select: () => {},
		...overrides,
	};
}

// ── Test data ────────────────────────────────────────────

const sampleTaxonomy = makeTaxonomy({
	area: { title: "Area" },
	event: { title: "Event Name" },
});

const sampleEvents: TrackingEvent[] = [
	makeEvent("page_view", { area: "acquisition", event: "page_view" }),
	makeEvent("sign_up", { area: "acquisition", event: "sign_up" }),
	makeEvent("deposit", { area: "banking", event: "deposit" }),
	makeEvent("withdrawal", { area: "banking", event: "withdrawal" }),
];

// ── Tests ────────────────────────────────────────────────

describe("TreeNav", () => {
	it("renders tree grouped by auto-detected levels", () => {
		// effectiveTreeLevels = ["area"] (auto-detected: 2 unique areas < 4 events)
		render(
			<I18nProvider>
				<TreeNav
					events={sampleEvents}
					taxonomyDefs={sampleTaxonomy}
					treeState={makeTreeState()}
					effectiveTreeLevels={["area"]}
					showDeprecated={false}
				/>
			</I18nProvider>,
		);

		// Should show both area groups
		expect(screen.getByText("acquisition")).toBeDefined();
		expect(screen.getByText("banking")).toBeDefined();
		// Should show "All events" button
		expect(screen.getByText("All events")).toBeDefined();
	});

	it("renders tree grouped by override levels when provided", () => {
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

		// Override: group by application only
		render(
			<I18nProvider>
				<TreeNav
					events={events}
					taxonomyDefs={taxonomy}
					treeState={makeTreeState()}
					effectiveTreeLevels={["application"]}
					showDeprecated={false}
				/>
			</I18nProvider>,
		);

		// Should show application groups, not area groups at top level
		expect(screen.getByText("ios")).toBeDefined();
		expect(screen.getByText("web")).toBeDefined();
	});

	it("falls back to flat list when no levels qualify", () => {
		render(
			<I18nProvider>
				<TreeNav
					events={sampleEvents}
					taxonomyDefs={sampleTaxonomy}
					treeState={makeTreeState()}
					effectiveTreeLevels={[]}
					showDeprecated={false}
				/>
			</I18nProvider>,
		);

		// No tree nodes, just event count message
		expect(screen.getByText(/4.*events/)).toBeDefined();
		// Should NOT show "All events" or area groups
		expect(screen.queryByText("All events")).toBeNull();
		expect(screen.queryByText("acquisition")).toBeNull();
	});
});
