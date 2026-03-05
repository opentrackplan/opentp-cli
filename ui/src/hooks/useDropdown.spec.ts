import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDropdown } from "./useDropdown";

describe("useDropdown", () => {
  it("starts closed", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("toggle opens", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3 }),
    );

    act(() => {
      result.current.toggle();
    });

    expect(result.current.isOpen).toBe(true);
  });

  it("toggle closes when open", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3 }),
    );

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("Escape closes", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3 }),
    );

    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.onKeyDown({
        key: "Escape",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.isOpen).toBe(false);
  });

  it("click outside closes", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3 }),
    );

    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);

    // Simulate click outside (neither menuRef nor buttonRef contain the target)
    act(() => {
      const event = new MouseEvent("mousedown", { bubbles: true });
      document.dispatchEvent(event);
    });

    expect(result.current.isOpen).toBe(false);
  });

  it("ArrowDown increments activeIndex", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3 }),
    );

    act(() => {
      result.current.open();
    });

    expect(result.current.activeIndex).toBe(-1);

    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.activeIndex).toBe(0);

    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.activeIndex).toBe(1);
  });

  it("ArrowDown does not exceed itemCount - 1", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 2 }),
    );

    act(() => {
      result.current.open();
    });

    // Navigate to last item
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.activeIndex).toBe(1);

    // Should not go past last item
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.activeIndex).toBe(1);
  });

  it("ArrowUp decrements activeIndex", () => {
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3 }),
    );

    act(() => {
      result.current.open();
    });

    // Navigate down to index 2
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.activeIndex).toBe(2);

    act(() => {
      result.current.onKeyDown({
        key: "ArrowUp",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.activeIndex).toBe(1);
  });

  it("Enter calls onSelect with activeIndex", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3, onSelect }),
    );

    act(() => {
      result.current.open();
    });

    // Navigate to first item
    act(() => {
      result.current.onKeyDown({
        key: "ArrowDown",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });

    // Press Enter
    act(() => {
      result.current.onKeyDown({
        key: "Enter",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });

    expect(onSelect).toHaveBeenCalledWith(0);
    expect(result.current.isOpen).toBe(false);
  });

  it("Enter does nothing when no active item", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useDropdown({ itemCount: 3, onSelect }),
    );

    act(() => {
      result.current.open();
    });

    // activeIndex is -1, Enter should not call onSelect
    act(() => {
      result.current.onKeyDown({
        key: "Enter",
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });

    expect(onSelect).not.toHaveBeenCalled();
  });
});
