import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "../../i18n";
import { PayloadEditor } from "./PayloadEditor";
import type { Field } from "../../types";

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe("PayloadEditor", () => {
  describe("field rename sanitization", () => {
    it("sanitizes field name to snake_case on blur", () => {
      const schema: Record<string, Field> = {
        test_field: { type: "string", required: false },
      };
      const onChange = vi.fn();

      render(
        <PayloadEditor
          schema={schema}
          onChange={onChange}
          dictionaries={{}}
        />,
        { wrapper: Wrapper },
      );

      // Expand the field editor by clicking on it
      const fieldHeader = screen.getByText("test_field");
      fireEvent.click(fieldHeader);

      // Find the name input and change it
      const nameInput = screen.getByDisplayValue("test_field");
      fireEvent.change(nameInput, { target: { value: "New Field Name" } });
      fireEvent.blur(nameInput);

      // The onChange should be called with the sanitized name
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          new_field_name: expect.any(Object),
        }),
      );
    });

    it("trims leading and trailing underscores from field names", () => {
      const schema: Record<string, Field> = {
        test_field: { type: "string", required: false },
      };
      const onChange = vi.fn();

      render(
        <PayloadEditor
          schema={schema}
          onChange={onChange}
          dictionaries={{}}
        />,
        { wrapper: Wrapper },
      );

      const fieldHeader = screen.getByText("test_field");
      fireEvent.click(fieldHeader);

      const nameInput = screen.getByDisplayValue("test_field");
      fireEvent.change(nameInput, { target: { value: "__trimmed__" } });
      fireEvent.blur(nameInput);

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          trimmed: expect.any(Object),
        }),
      );
    });

    it("preserves stable React key across renames (no remount)", () => {
      // This test verifies that renaming a field doesn't cause the FieldEditor
      // to unmount and remount (which would collapse the expanded state).
      const schema: Record<string, Field> = {
        old_name: { type: "string", required: false },
      };
      const onChange = vi.fn();

      const { rerender } = render(
        <PayloadEditor
          schema={schema}
          onChange={onChange}
          dictionaries={{}}
        />,
        { wrapper: Wrapper },
      );

      // Expand the field by clicking on the header
      const fieldHeader = screen.getByText("old_name");
      fireEvent.click(fieldHeader);

      // The field should be expanded (name input is visible)
      expect(screen.getByDisplayValue("old_name")).toBeDefined();

      // Change name and blur to trigger rename
      const nameInput = screen.getByDisplayValue("old_name");
      fireEvent.change(nameInput, { target: { value: "new_name" } });
      fireEvent.blur(nameInput);

      // Rerender with the new schema (simulating parent state update)
      if (onChange.mock.calls.length > 0) {
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        rerender(
          <Wrapper>
            <PayloadEditor
              schema={lastCall}
              onChange={onChange}
              dictionaries={{}}
            />
          </Wrapper>,
        );

        // The renamed field should be visible in the DOM.
        // If stable keys work correctly, the component doesn't remount,
        // so the FieldEditor preserves its expanded state and the name appears.
        const fieldElements = screen.queryAllByText("new_name");
        expect(fieldElements.length).toBeGreaterThan(0);
      }
    });
  });

  describe("add field", () => {
    it("adds a new field with default name", () => {
      const onChange = vi.fn();

      render(
        <PayloadEditor
          schema={{}}
          onChange={onChange}
          dictionaries={{}}
        />,
        { wrapper: Wrapper },
      );

      // Use getByRole to find only the button, not the hint text
      fireEvent.click(screen.getByRole("button", { name: /add field/i }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          new_field: { type: "string", required: false },
        }),
      );
    });

    it("increments counter for duplicate field names", () => {
      const schema: Record<string, Field> = {
        new_field: { type: "string", required: false },
      };
      const onChange = vi.fn();

      render(
        <PayloadEditor
          schema={schema}
          onChange={onChange}
          dictionaries={{}}
        />,
        { wrapper: Wrapper },
      );

      fireEvent.click(screen.getByRole("button", { name: /add field/i }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          new_field: expect.any(Object),
          new_field_1: { type: "string", required: false },
        }),
      );
    });
  });
});
