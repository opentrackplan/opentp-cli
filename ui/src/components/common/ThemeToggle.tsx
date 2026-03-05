import { useTheme } from "../../hooks/useTheme";
import { useT } from "../../i18n";

export function ThemeToggle() {
	const { theme, toggleTheme } = useTheme();
	const { t } = useT();

	return (
		<button
			onClick={toggleTheme}
			className="p-1.5 rounded-md transition-colors
				bg-surface-tertiary hover:bg-surface-hover text-content-tertiary hover:text-content-secondary"
			title={theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
		>
			{theme === "dark" ? (
				// Sun icon
				<svg
					className="w-3.5 h-3.5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
					/>
				</svg>
			) : (
				// Moon icon
				<svg
					className="w-3.5 h-3.5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
					/>
				</svg>
			)}
		</button>
	);
}
