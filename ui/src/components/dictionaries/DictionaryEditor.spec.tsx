import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "../../i18n";
import { DictionaryEditor } from "./DictionaryEditor";
import type { DictionaryDraft } from "../../types";

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

function makeDraft(overrides: Partial<DictionaryDraft> = {}): DictionaryDraft {
  return {
    originalKey: "test_dict",
    key: "test_dict",
    type: "string",
    values: ["a", "b"],
    isDirty: false,
    ...overrides,
  };
}

describe("DictionaryEditor", () => {
  describe("key sanitization", () => {
    it("sanitizes key on blur: replaces spaces with underscores and lowercases", () => {
      const onChange = vi.fn();
      const draft = makeDraft({ key: "My Dict Name" });

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByDisplayValue("My Dict Name");
      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ key: "my_dict_name", isDirty: true }),
      );
    });

    it("trims leading and trailing underscores/slashes", () => {
      const onChange = vi.fn();
      const draft = makeDraft({ key: "__foo_bar__" });

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByDisplayValue("__foo_bar__");
      fireEvent.blur(input);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ key: "foo_bar" }),
      );
    });

    it("does not call onChange if key is already sanitized", () => {
      const onChange = vi.fn();
      const draft = makeDraft({ key: "clean_name" });

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      fireEvent.blur(screen.getByDisplayValue("clean_name"));

      // Should not call onChange since key is already clean
      expect(onChange).not.toHaveBeenCalled();
    });

    it("preserves forward slashes in path-based keys", () => {
      const onChange = vi.fn();
      const draft = makeDraft({ key: "taxonomy/areas" });

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      fireEvent.blur(screen.getByDisplayValue("taxonomy/areas"));

      // No change needed — key is already clean
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does not modify empty key on blur", () => {
      const onChange = vi.fn();
      const draft = makeDraft({ key: "  " });

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      // Blur the input (find by role since value is whitespace)
      const inputs = screen.getAllByRole("textbox");
      fireEvent.blur(inputs[0]);

      expect(onChange).not.toHaveBeenCalled();
    });

    it("allows editing the key (not disabled for existing dicts)", () => {
      const onChange = vi.fn();
      const draft = makeDraft({ originalKey: "existing_dict" });

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByDisplayValue("test_dict") as HTMLInputElement;
      expect(input.disabled).toBe(false);

      fireEvent.change(input, { target: { value: "renamed_dict" } });

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ key: "renamed_dict", isDirty: true }),
      );
    });
  });

  describe("validation", () => {
    it("shows error for key starting with /", () => {
      const onChange = vi.fn();
      const draft = makeDraft();

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByDisplayValue("test_dict");
      fireEvent.change(input, { target: { value: "/invalid" } });

      // Error should be shown
      expect(screen.getByText(/must not start/i)).toBeDefined();
    });

    it("shows error for key containing ..", () => {
      const onChange = vi.fn();
      const draft = makeDraft();

      render(<DictionaryEditor draft={draft} onChange={onChange} />, {
        wrapper: Wrapper,
      });

      const input = screen.getByDisplayValue("test_dict");
      fireEvent.change(input, { target: { value: "foo/../bar" } });

      expect(screen.getByText(/\.\./i)).toBeDefined();
    });
  });
});
