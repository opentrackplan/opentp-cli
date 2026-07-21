import { useState, useCallback, useEffect, useRef } from "react";

interface UseDropdownOptions {
  itemCount: number;
  onSelect?: (index: number) => void;
}

export function useDropdown({ itemCount, onSelect }: UseDropdownOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const open = useCallback(() => {
    setIsOpen(true);
    setActiveIndex(-1);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) {
        setActiveIndex(-1);
        return true;
      }
      setActiveIndex(-1);
      return false;
    });
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
        return;
      }

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          close();
          buttonRef.current?.focus();
          break;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < itemCount - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < itemCount) {
            onSelect?.(activeIndex);
            close();
          }
          break;
      }
    },
    [isOpen, itemCount, activeIndex, onSelect, open, close],
  );

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      // Use composedPath() so clicks inside Shadow DOM are correctly detected
      const path = e.composedPath();
      const inMenu = menuRef.current ? path.includes(menuRef.current) : false;
      const inButton = buttonRef.current ? path.includes(buttonRef.current) : false;
      if (!inMenu && !inButton) {
        close();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, close]);

  return { isOpen, open, close, toggle, menuRef, buttonRef, activeIndex, onKeyDown };
}
