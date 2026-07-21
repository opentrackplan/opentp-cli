import { describe, it, expect, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { DictionaryPanel } from "./DictionaryPanel";
import type { DictionaryDraft } from "../../types";
import type { UseDictionaryMutationResult } from "../../hooks/useDictionaryMutation";

function makeMutation(
  overrides: Partial<UseDictionaryMutationResult> = {},
): UseDictionaryMutationResult {
  return {
    saving: false,
    deleting: false,
    error: null,
    save: vi.fn(async () => null),
    remove: vi.fn(async () => null),
    clearError: vi.fn(),
    ...overrides,
  };
}

describe("DictionaryPanel", () => {
  it("sends the changed key when user edits input and clicks Save (no explicit blur)", () => {
    // Reproduces the stale-closure race condition:
    // 1. Draft starts with key "old_key"
    // 2. User types "new_name" in the input (onChange → setDraft)
    // 3. User clicks Save (blur fires implicitly before click)
    // 4. Save handler must read the LATEST draft with key "new_name",
    //    not the stale closure value "old_key".
    const saveFn = vi.fn();

    function TestHarness() {
      const [draft, setDraft] = useState<DictionaryDraft>({
        originalKey: "old_key",
        key: "old_key",
        type: "string",
        values: ["a"],
        isDirty: false,
      });
      const draftRef = useRef(draft);
      draftRef.current = draft;

      const mutation = makeMutation();

      const handleSave = () => {
        // Layout's handleDictSave reads from the ref, not the closure
        saveFn(draftRef.current);
      };

      return (
        <I18nProvider>
          <DictionaryPanel
            draft={draft}
            mutation={mutation}
            onSave={handleSave}
            onDiscard={() => {}}
            onDraftChange={setDraft}
          />
        </I18nProvider>
      );
    }

    render(<TestHarness />);

    // Step 1: input shows the original key
    const input = screen.getByDisplayValue("old_key");

    // Step 2: user changes the key (simulates typing)
    fireEvent.change(input, { target: { value: "new_name" } });

    // Step 3: user clicks Save directly — no explicit blur
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // Step 4: save must receive the NEW key, not "old_key"
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "new_name" }),
    );
  });

  it("sends the sanitized key when user types unsanitized name, blurs, then saves", () => {
    // User types "My New Dict" → blur sanitizes to "my_new_dict" → save must get sanitized value.
    // In a real browser, clicking Save blurs the input first. jsdom doesn't
    // do that automatically, so we fire blur explicitly before click.
    const saveFn = vi.fn();

    function TestHarness() {
      const [draft, setDraft] = useState<DictionaryDraft>({
        originalKey: "old_key",
        key: "old_key",
        type: "string",
        values: ["a"],
        isDirty: false,
      });
      const draftRef = useRef(draft);
      draftRef.current = draft;

      const mutation = makeMutation();

      return (
        <I18nProvider>
          <DictionaryPanel
            draft={draft}
            mutation={mutation}
            onSave={() => saveFn(draftRef.current)}
            onDiscard={() => {}}
            onDraftChange={setDraft}
          />
        </I18nProvider>
      );
    }

    render(<TestHarness />);

    const input = screen.getByDisplayValue("old_key");

    // User types an unsanitized name
    fireEvent.change(input, { target: { value: "My New Dict" } });

    // In real browser, clicking Save causes the input to lose focus first.
    // jsdom doesn't simulate this, so we fire blur explicitly.
    fireEvent.blur(input);

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(saveFn).toHaveBeenCalledTimes(1);
    // Must be the sanitized value, not "old_key" or "My New Dict"
    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "my_new_dict" }),
    );
  });
});
