import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "../../i18n";
import { DictValueManager } from "./DictValueManager";

// Mock the mutations API
vi.mock("../../api/mutations", () => ({
	updateDictionary: vi.fn(),
}));

import { updateDictionary } from "../../api/mutations";

const mockUpdateDictionary = vi.mocked(updateDictionary);

function Wrapper({ children }: { children: ReactNode }) {
	return <I18nProvider>{children}</I18nProvider>;
}

function renderManager(overrides: Partial<React.ComponentProps<typeof DictValueManager>> = {}) {
	const defaults = {
		dictKey: "taxonomy/areas",
		values: ["analytics", "auth", "billing"] as Array<string | number | boolean>,
		dictType: "string" as const,
		baseUrl: "http://localhost:3000",
		onDictUpdated: vi.fn(),
		onValueAdded: vi.fn(),
		addToast: vi.fn(),
	};
	const props = { ...defaults, ...overrides };
	return { ...render(<DictValueManager {...props} />, { wrapper: Wrapper }), props };
}

describe("DictValueManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdateDictionary.mockResolvedValue({ updated: true, key: "taxonomy/areas", filePath: "dictionaries/taxonomy/areas.yaml" });
	});

	it("renders all values", () => {
		renderManager();
		expect(screen.getByText("analytics")).toBeDefined();
		expect(screen.getByText("auth")).toBeDefined();
		expect(screen.getByText("billing")).toBeDefined();
	});

	it("renders the dictionary key header", () => {
		renderManager();
		expect(screen.getByText("taxonomy/areas")).toBeDefined();
	});

	describe("add value", () => {
		it("adds a new value on Enter", async () => {
			const { props } = renderManager();
			const input = screen.getByPlaceholderText("New value...");

			fireEvent.change(input, { target: { value: "payments" } });
			fireEvent.keyDown(input, { key: "Enter" });

			await waitFor(() => {
				expect(mockUpdateDictionary).toHaveBeenCalledWith(
					"http://localhost:3000",
					"taxonomy/areas",
					expect.objectContaining({
						values: ["analytics", "auth", "billing", "payments"],
					}),
				);
			});

			expect(props.onValueAdded).toHaveBeenCalledWith("payments");
			expect(props.onDictUpdated).toHaveBeenCalled();
			expect(props.addToast).toHaveBeenCalledWith("success", "Dictionary updated");
		});

		it("adds a new value via Add button", async () => {
			const { props } = renderManager();
			const input = screen.getByPlaceholderText("New value...");

			fireEvent.change(input, { target: { value: "newarea" } });
			fireEvent.click(screen.getByText("Add"));

			await waitFor(() => {
				expect(mockUpdateDictionary).toHaveBeenCalled();
			});

			expect(props.onValueAdded).toHaveBeenCalledWith("newarea");
		});

		it("rejects duplicate values", async () => {
			const { props } = renderManager();
			const input = screen.getByPlaceholderText("New value...");

			fireEvent.change(input, { target: { value: "analytics" } });
			fireEvent.keyDown(input, { key: "Enter" });

			// Should not call API
			expect(mockUpdateDictionary).not.toHaveBeenCalled();
			expect(props.addToast).toHaveBeenCalledWith("error", "Value already exists");
		});

		it("does not add empty values", () => {
			renderManager();
			const input = screen.getByPlaceholderText("New value...");

			fireEvent.change(input, { target: { value: "   " } });
			fireEvent.keyDown(input, { key: "Enter" });

			expect(mockUpdateDictionary).not.toHaveBeenCalled();
		});

		it("coerces numeric values for number-type dictionaries", async () => {
			renderManager({
				dictType: "number",
				values: [1, 2, 3],
			});
			const input = screen.getByPlaceholderText("New value...");

			fireEvent.change(input, { target: { value: "42" } });
			fireEvent.keyDown(input, { key: "Enter" });

			await waitFor(() => {
				expect(mockUpdateDictionary).toHaveBeenCalledWith(
					expect.any(String),
					expect.any(String),
					expect.objectContaining({
						values: [1, 2, 3, 42],
					}),
				);
			});
		});
	});

	describe("rename value", () => {
		it("enters edit mode on pencil click and saves on Enter", async () => {
			const { props } = renderManager();

			// Hover and click pencil button for "auth"
			const renameButtons = screen.getAllByTitle("Rename");
			fireEvent.click(renameButtons[1]); // "auth" is index 1

			// Should show an input with current value
			const editInput = screen.getByDisplayValue("auth");
			fireEvent.change(editInput, { target: { value: "authentication" } });
			fireEvent.keyDown(editInput, { key: "Enter" });

			await waitFor(() => {
				expect(mockUpdateDictionary).toHaveBeenCalledWith(
					"http://localhost:3000",
					"taxonomy/areas",
					expect.objectContaining({
						values: ["analytics", "authentication", "billing"],
					}),
				);
			});

			expect(props.onDictUpdated).toHaveBeenCalled();
		});

		it("cancels edit on Escape", () => {
			renderManager();

			const renameButtons = screen.getAllByTitle("Rename");
			fireEvent.click(renameButtons[0]);

			const editInput = screen.getByDisplayValue("analytics");
			fireEvent.change(editInput, { target: { value: "changed" } });
			fireEvent.keyDown(editInput, { key: "Escape" });

			// Should exit edit mode — no input with "changed" visible
			expect(screen.queryByDisplayValue("changed")).toBeNull();
			expect(mockUpdateDictionary).not.toHaveBeenCalled();
		});

		it("rejects rename to existing value", async () => {
			const { props } = renderManager();

			const renameButtons = screen.getAllByTitle("Rename");
			fireEvent.click(renameButtons[0]); // "analytics"

			const editInput = screen.getByDisplayValue("analytics");
			fireEvent.change(editInput, { target: { value: "auth" } });
			fireEvent.keyDown(editInput, { key: "Enter" });

			expect(mockUpdateDictionary).not.toHaveBeenCalled();
			expect(props.addToast).toHaveBeenCalledWith("error", "Value already exists");
		});

		it("rejects rename to empty string", async () => {
			const { props } = renderManager();

			const renameButtons = screen.getAllByTitle("Rename");
			fireEvent.click(renameButtons[0]);

			const editInput = screen.getByDisplayValue("analytics");
			fireEvent.change(editInput, { target: { value: "" } });
			fireEvent.keyDown(editInput, { key: "Enter" });

			expect(mockUpdateDictionary).not.toHaveBeenCalled();
			expect(props.addToast).toHaveBeenCalledWith("error", "Value cannot be empty");
		});
	});

	describe("delete value", () => {
		it("shows confirm dialog and deletes on confirm", async () => {
			const { props } = renderManager();

			// Click trash for "billing" (index 2)
			const deleteButtons = screen.getAllByTitle("Remove");
			fireEvent.click(deleteButtons[2]);

			// Confirm dialog should appear
			expect(screen.getByText("Remove dictionary value")).toBeDefined();

			// Click the confirm button in the dialog
			const confirmButton = screen.getByText("Remove");
			fireEvent.click(confirmButton);

			await waitFor(() => {
				expect(mockUpdateDictionary).toHaveBeenCalledWith(
					"http://localhost:3000",
					"taxonomy/areas",
					expect.objectContaining({
						values: ["analytics", "auth"],
					}),
				);
			});

			expect(props.onDictUpdated).toHaveBeenCalled();
		});

		it("cancels delete on cancel", () => {
			renderManager();

			const deleteButtons = screen.getAllByTitle("Remove");
			fireEvent.click(deleteButtons[0]);

			// Confirm dialog should appear
			expect(screen.getByText("Remove dictionary value")).toBeDefined();

			// Click cancel
			fireEvent.click(screen.getByText("Cancel"));

			// Dialog should be closed, no API call
			expect(mockUpdateDictionary).not.toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("shows error toast when API fails", async () => {
			mockUpdateDictionary.mockRejectedValueOnce(new Error("Network error"));
			const { props } = renderManager();

			const input = screen.getByPlaceholderText("New value...");
			fireEvent.change(input, { target: { value: "newval" } });
			fireEvent.keyDown(input, { key: "Enter" });

			await waitFor(() => {
				expect(props.addToast).toHaveBeenCalledWith("error", "Failed to update dictionary");
			});

			// Should not call onDictUpdated or onValueAdded on failure
			expect(props.onDictUpdated).not.toHaveBeenCalled();
			expect(props.onValueAdded).not.toHaveBeenCalled();
		});
	});
});
