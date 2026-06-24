import { useT, type Locale } from "../../i18n";

const LOCALES: { value: Locale; label: string }[] = [
	{ value: "en", label: "EN" },
	{ value: "ru", label: "RU" },
];

export function LocaleSwitcher() {
	const { locale, setLocale } = useT();

	return (
		<div className="flex gap-1">
			{LOCALES.map((l) => (
				<button
					key={l.value}
					type="button"
					onClick={() => setLocale(l.value)}
					className={`px-2 py-0.5 text-[11px] rounded cursor-pointer transition-colors ${
						locale === l.value
							? "bg-surface-tertiary text-content-primary"
							: "text-content-muted hover:text-content-secondary"
					}`}
				>
					{l.label}
				</button>
			))}
		</div>
	);
}
