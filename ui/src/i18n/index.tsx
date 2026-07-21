import {
	createContext,
	useContext,
	useState,
	useCallback,
	type ReactNode,
} from "react";
import { en, type TranslationKey } from "./en";
import { ru } from "./ru";

export type Locale = "en" | "ru";

const translations: Record<Locale, Record<TranslationKey, string>> = {
	en,
	ru,
};

interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Detect initial locale from navigator or localStorage */
function detectLocale(): Locale {
	// Check localStorage first
	try {
		const stored = localStorage.getItem("opentp-locale");
		if (stored === "en" || stored === "ru") return stored;
	} catch {
		// localStorage not available (SSR, tests)
	}

	// Fall back to browser language
	const lang =
		typeof navigator !== "undefined"
			? navigator.language?.toLowerCase() ?? "en"
			: "en";
	if (lang.startsWith("ru")) return "ru";
	return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(detectLocale);

	const setLocale = useCallback((l: Locale) => {
		setLocaleState(l);
		try {
			localStorage.setItem("opentp-locale", l);
		} catch {
			// localStorage not available
		}
	}, []);

	const t = useCallback(
		(key: TranslationKey, params?: Record<string, string | number>): string => {
			let text = translations[locale][key] ?? translations.en[key] ?? key;
			if (params) {
				for (const [k, v] of Object.entries(params)) {
					text = text.replace(`{${k}}`, String(v));
				}
			}
			return text;
		},
		[locale],
	);

	return (
		<I18nContext.Provider value={{ locale, setLocale, t }}>
			{children}
		</I18nContext.Provider>
	);
}

/** Hook to access translations */
export function useT() {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error("useT must be used within I18nProvider");
	return ctx;
}

// Re-export types
export type { TranslationKey };
