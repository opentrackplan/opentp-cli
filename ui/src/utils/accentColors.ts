/**
 * Static accent color lookup for branding.
 *
 * IMPORTANT: All Tailwind classes must be written as complete static strings
 * so the JIT compiler can detect them during source scanning.
 * Do NOT use template literal interpolation for class names.
 */
import type { AccentColor } from "../types/platform";

export interface AccentColorClasses {
  /** Solid background (primary buttons) */
  bg: string;
  /** Hover for solid background */
  hover: string;
  /** Text color */
  text: string;
  /** Light background (active state) */
  bgLight: string;
  /** Border (active state) */
  border: string;
}

export const ACCENT_COLORS: Record<AccentColor, AccentColorClasses> = {
  blue: {
    bg: "bg-accent-blue",
    hover: "hover:bg-accent-blue/80",
    text: "text-accent-blue",
    bgLight: "bg-accent-blue-bg",
    border: "border-accent-blue-border",
  },
  indigo: {
    bg: "bg-accent-indigo",
    hover: "hover:bg-accent-indigo/80",
    text: "text-accent-indigo",
    bgLight: "bg-accent-indigo-bg",
    border: "border-accent-indigo-border",
  },
  violet: {
    bg: "bg-accent-violet",
    hover: "hover:bg-accent-violet/80",
    text: "text-accent-violet",
    bgLight: "bg-accent-violet-bg",
    border: "border-accent-violet-border",
  },
  emerald: {
    bg: "bg-accent-emerald",
    hover: "hover:bg-accent-emerald/80",
    text: "text-accent-emerald",
    bgLight: "bg-accent-emerald-bg",
    border: "border-accent-emerald-border",
  },
  teal: {
    bg: "bg-accent-teal",
    hover: "hover:bg-accent-teal/80",
    text: "text-accent-teal",
    bgLight: "bg-accent-teal-bg",
    border: "border-accent-teal-border",
  },
  amber: {
    bg: "bg-accent-amber",
    hover: "hover:bg-accent-amber/80",
    text: "text-accent-amber",
    bgLight: "bg-accent-amber-bg",
    border: "border-accent-amber-border",
  },
  rose: {
    bg: "bg-accent-rose",
    hover: "hover:bg-accent-rose/80",
    text: "text-accent-rose",
    bgLight: "bg-accent-rose-bg",
    border: "border-accent-rose-border",
  },
  red: {
    bg: "bg-accent-red",
    hover: "hover:bg-accent-red/80",
    text: "text-accent-red",
    bgLight: "bg-accent-red-bg",
    border: "border-accent-red-border",
  },
  orange: {
    bg: "bg-accent-orange",
    hover: "hover:bg-accent-orange/80",
    text: "text-accent-orange",
    bgLight: "bg-accent-orange-bg",
    border: "border-accent-orange-border",
  },
  cyan: {
    bg: "bg-accent-cyan",
    hover: "hover:bg-accent-cyan/80",
    text: "text-accent-cyan",
    bgLight: "bg-accent-cyan-bg",
    border: "border-accent-cyan-border",
  },
} as const;

/**
 * Get accent color classes, falling back to blue for unknown colors.
 */
export function getAccentClasses(color: AccentColor): AccentColorClasses {
  return ACCENT_COLORS[color] ?? ACCENT_COLORS.blue;
}
