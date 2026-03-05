import { describe, it, expect } from "vitest";
import { ACCENT_COLORS, getAccentClasses } from "./accentColors";
import type { AccentColor } from "../types/platform";

const ALL_ACCENT_COLORS: AccentColor[] = [
  "blue", "indigo", "violet", "emerald", "teal",
  "amber", "rose", "red", "orange", "cyan",
];

describe("accentColors", () => {
  it("every AccentColor has all required keys", () => {
    for (const color of ALL_ACCENT_COLORS) {
      const classes = ACCENT_COLORS[color];
      expect(classes).toBeDefined();
      expect(classes.bg).toBeDefined();
      expect(classes.hover).toBeDefined();
      expect(classes.text).toBeDefined();
      expect(classes.bgLight).toBeDefined();
      expect(classes.border).toBeDefined();
    }
  });

  it("all class values are complete static strings", () => {
    for (const color of ALL_ACCENT_COLORS) {
      const classes = ACCENT_COLORS[color];
      expect(classes.bg).toMatch(/^bg-/);
      expect(classes.hover).toMatch(/^hover:bg-/);
      expect(classes.text).toMatch(/^text-/);
      expect(classes.bgLight).toMatch(/^bg-/);
      expect(classes.border).toMatch(/^border-/);
    }
  });

  it("blue is the default", () => {
    expect(ACCENT_COLORS.blue).toBeDefined();
    expect(ACCENT_COLORS.blue.bg).toBe("bg-accent-blue");
  });

  it("getAccentClasses returns correct classes for valid color", () => {
    const classes = getAccentClasses("rose");
    expect(classes.bg).toBe("bg-accent-rose");
    expect(classes.hover).toBe("hover:bg-accent-rose/80");
    expect(classes.text).toBe("text-accent-rose");
    expect(classes.bgLight).toBe("bg-accent-rose-bg");
    expect(classes.border).toBe("border-accent-rose-border");
  });

  it("getAccentClasses falls back to blue for unknown color", () => {
    const classes = getAccentClasses("magenta" as AccentColor);
    expect(classes.bg).toBe("bg-accent-blue");
  });
});
