import { useCallback, useState } from "react";
import { getPayloadSchema } from "../../lib/payload";
import { useT } from "../../i18n";
import type { EventDraft, OpenTPConfig, ScalarType } from "../../types";
import { KeyPreview } from "./KeyPreview";
import { LifecycleForm } from "./LifecycleForm";
import { PayloadEditor } from "./PayloadEditor";
import { TaxonomyForm } from "./TaxonomyForm";
import { YamlPreview } from "./YamlPreview";

interface EventFormProps {
	draft: EventDraft;
	config: OpenTPConfig;
	dictionaries: Record<string, Array<string | number | boolean>>;
	onChange: (draft: EventDraft) => void;
	dictionaryMeta?: Record<string, { type: ScalarType; values: Array<string | number | boolean> }>;
	baseUrl?: string | null;
	onDictUpdated?: () => void;
	addToast?: (type: "success" | "error", text: string) => void;
}

export function EventForm({
	draft,
	config,
	dictionaries,
	onChange,
	dictionaryMeta,
	baseUrl,
	onDictUpdated,
	addToast,
}: EventFormProps) {
	const { t } = useT();
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [viewMode, setViewMode] = useState<"form" | "yaml">("form");
	const taxonomyDefs = config.spec.events.taxonomy;
	const template = config.spec.paths.events.template;

	const handleTaxonomyChange = useCallback(
		(key: string, value: string | number) => {
			const newTaxonomy = { ...draft.taxonomy, [key]: value };

			// Auto-generate event key from taxonomy
			const fieldNames: string[] = [];
			template.replace(/\{(\w+)\}/g, (_, name: string) => {
				fieldNames.push(name);
				return "";
			});
			const newKey = fieldNames
				.map((name) => String(newTaxonomy[name] ?? ""))
				.filter(Boolean)
				.join("::");

			onChange({
				...draft,
				taxonomy: newTaxonomy,
				key: newKey,
				isDirty: true,
			});

			// Clear error for this field
			if (errors[key]) {
				setErrors((prev) => {
					const next = { ...prev };
					delete next[key];
					return next;
				});
			}
		},
		[draft, template, onChange, errors],
	);

	const handleLifecycleChange = useCallback(
		(status: "active" | "draft" | "deprecated") => {
			onChange({
				...draft,
				lifecycle: { ...draft.lifecycle, status },
				isDirty: true,
			});
		},
		[draft, onChange],
	);

	const isNewEvent = draft.originalKey === null;
	const lifecycleStatus = draft.lifecycle?.status ?? "draft";

	const payloadSchema = getPayloadSchema(draft.payload);

	return (
		<div className="space-y-6">
			{/* View mode toggle */}
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => setViewMode("form")}
					className={`px-3 py-1 text-xs rounded-md ${
						viewMode === "form"
							? "bg-surface-tertiary text-content-primary"
							: "text-content-tertiary hover:text-content-secondary"
					}`}
				>
					{t("editor.formTab")}
				</button>
				<button
					type="button"
					onClick={() => setViewMode("yaml")}
					className={`px-3 py-1 text-xs rounded-md ${
						viewMode === "yaml"
							? "bg-surface-tertiary text-content-primary"
							: "text-content-tertiary hover:text-content-secondary"
					}`}
				>
					{t("editor.yamlTab")}
				</button>
			</div>

			{viewMode === "yaml" ? (
				<YamlPreview draft={draft} specVersion={config.opentp} />
			) : (
				<>
					{/* New event badge */}
					{isNewEvent && (
						<div className="flex items-center gap-2 px-3 py-2 bg-accent-blue-bg border border-accent-blue-border rounded-lg">
							<span className="text-xs text-accent-blue">{t("editor.newEvent")}</span>
						</div>
					)}

					{/* Key preview */}
					<KeyPreview template={template} taxonomy={draft.taxonomy} />

					{/* Taxonomy fields */}
					<TaxonomyForm
						taxonomyDefs={taxonomyDefs}
						values={draft.taxonomy}
						onChange={handleTaxonomyChange}
						errors={errors}
						dictionaries={dictionaries}
						dictionaryMeta={dictionaryMeta}
						baseUrl={baseUrl}
						onDictUpdated={onDictUpdated}
						addToast={addToast}
					/>

					{/* Lifecycle */}
					<LifecycleForm
						status={lifecycleStatus}
						onChange={handleLifecycleChange}
					/>

					{/* Payload fields editor */}
					<PayloadEditor
						schema={payloadSchema}
						onChange={(schema) => {
							onChange({
								...draft,
								payload: { ...(draft.payload as object), schema },
								isDirty: true,
							});
						}}
						dictionaries={dictionaries}
						baseSchema={config.spec.events.payload.schema}
					/>
				</>
			)}
		</div>
	);
}
