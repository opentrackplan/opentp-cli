import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearch } from "./useSearch";
import type { TrackingEvent } from "../types";

// ── Helpers ──────────────────────────────────────────────

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

const sampleEvents: TrackingEvent[] = [
	makeEvent("page_view", { area: "acquisition", event: "page_view" }),
	makeEvent("sign_up", { area: "acquisition", event: "sign_up" }),
	makeEvent("deposit", { area: "banking", event: "deposit" }),
	makeEvent("withdrawal", { area: "banking", event: "withdrawal" }),
];

// ── Tests ────────────────────────────────────────────────

describe("useSearch", () => {
	it("typing a query calls onClearTreeSelection", () => {
		const onClear = vi.fn();

		const { result } = renderHook(() =>
			useSearch({
				events: sampleEvents,
				selectedTreePath: "banking",
				treeLevels: ["area"],
				onClearTreeSelection: onClear,
			}),
		);

		// Type a search query
		act(() => {
			result.current.setQuery("deposit");
		});

		expect(onClear).toHaveBeenCalledTimes(1);
	});

	it("clearing query does not re-select previously selected tree node", () => {
		const onClear = vi.fn();

		const { result } = renderHook(() =>
			useSearch({
				events: sampleEvents,
				selectedTreePath: null,
				treeLevels: ["area"],
				onClearTreeSelection: onClear,
			}),
		);

		// Type a query first
		act(() => {
			result.current.setQuery("deposit");
		});

		onClear.mockClear();

		// Clear the query — should NOT call onClearTreeSelection
		act(() => {
			result.current.setQuery("");
		});

		expect(onClear).not.toHaveBeenCalled();
	});

	it("search finds events across all groups regardless of prior tree selection", () => {
		const { result } = renderHook(() =>
			useSearch({
				events: sampleEvents,
				selectedTreePath: null,
				treeLevels: ["area"],
			}),
		);

		// Search for "deposit" — should find it regardless of tree selection
		act(() => {
			result.current.setQuery("deposit");
		});

		expect(result.current.filteredEvents).toHaveLength(1);
		expect(result.current.filteredEvents[0].key).toBe("deposit");
	});

	it("filters events by tree selection when no query", () => {
		const { result } = renderHook(() =>
			useSearch({
				events: sampleEvents,
				selectedTreePath: "banking",
				treeLevels: ["area"],
			}),
		);

		// With "banking" selected, only banking events should show
		expect(result.current.filteredEvents).toHaveLength(2);
		expect(result.current.filteredEvents.map((e) => e.key).sort()).toEqual([
			"deposit",
			"withdrawal",
		]);
	});

	it("does not call onClearTreeSelection for whitespace-only queries", () => {
		const onClear = vi.fn();

		const { result } = renderHook(() =>
			useSearch({
				events: sampleEvents,
				selectedTreePath: null,
				treeLevels: ["area"],
				onClearTreeSelection: onClear,
			}),
		);

		act(() => {
			result.current.setQuery("   ");
		});

		expect(onClear).not.toHaveBeenCalled();
	});
});
