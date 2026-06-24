/**
 * Maps area names to color tokens using a deterministic hash function.
 * This ensures the same area always gets the same color across sessions.
 *
 * IMPORTANT: All Tailwind classes must be written as complete static strings
 * so the JIT compiler can detect them during source scanning.
 * Do NOT use template literal interpolation for class names.
 */

const AREA_COLORS = [
	"red",
	"orange",
	"amber",
	"green",
	"teal",
	"blue",
	"purple",
	"pink",
	"cyan",
	"indigo",
] as const;

type AreaColor = (typeof AREA_COLORS)[number];

/**
 * Static lookup maps — Tailwind can detect these complete class strings.
 */
const BADGE_CLASSES: Record<AreaColor, string> = {
	red:    "bg-accent-red-bg text-accent-red border-accent-red-border",
	orange: "bg-accent-orange-bg text-accent-orange border-accent-orange-border",
	amber:  "bg-accent-amber-bg text-accent-amber border-accent-amber-border",
	green:  "bg-accent-green-bg text-accent-green border-accent-green-border",
	teal:   "bg-accent-teal-bg text-accent-teal border-accent-teal-border",
	blue:   "bg-accent-blue-bg text-accent-blue border-accent-blue-border",
	purple: "bg-accent-purple-bg text-accent-purple border-accent-purple-border",
	pink:   "bg-accent-pink-bg text-accent-pink border-accent-pink-border",
	cyan:   "bg-accent-cyan-bg text-accent-cyan border-accent-cyan-border",
	indigo: "bg-accent-indigo-bg text-accent-indigo border-accent-indigo-border",
};

const TEXT_CLASSES: Record<AreaColor, string> = {
	red:    "text-accent-red",
	orange: "text-accent-orange",
	amber:  "text-accent-amber",
	green:  "text-accent-green",
	teal:   "text-accent-teal",
	blue:   "text-accent-blue",
	purple: "text-accent-purple",
	pink:   "text-accent-pink",
	cyan:   "text-accent-cyan",
	indigo: "text-accent-indigo",
};

/**
 * Simple string hash function (DJB2 algorithm)
 */
function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = (hash * 33) ^ str.charCodeAt(i);
	}
	return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Get color token for an area name
 */
export function getAreaColor(area: string): AreaColor {
	const hash = hashString(area.toLowerCase());
	const index = hash % AREA_COLORS.length;
	return AREA_COLORS[index];
}

/**
 * Get Tailwind classes for an area badge (with background)
 */
export function getAreaBadgeClasses(area: string): string {
	return BADGE_CLASSES[getAreaColor(area)];
}

/**
 * Get Tailwind class for area text only (no background)
 */
export function getAreaTextClass(area: string): string {
	return TEXT_CLASSES[getAreaColor(area)];
}

/**
 * Get all color classes as an object (for more control)
 */
export function getAreaColorClasses(area: string): {
	bg: string;
	text: string;
	border: string;
	textOnly: string;
} {
	const color = getAreaColor(area);
	const badge = BADGE_CLASSES[color];
	const parts = badge.split(" ");
	return {
		bg: parts[0],
		text: parts[1],
		border: parts[2],
		textOnly: TEXT_CLASSES[color],
	};
}
