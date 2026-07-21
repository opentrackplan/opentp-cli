import { useEffect, useState } from "react";
import type { ScalarType } from "../../types";
import { updateDictionary } from "../../api/mutations";
import { useT } from "../../i18n";
import { ConfirmDialog } from "../common/ConfirmDialog";

export interface DictValueManagerProps {
	/** Dictionary key, e.g. "taxonomy/areas" */
	dictKey: string;
	/** Current values array */
	values: Array<string | number | boolean>;
	/** Dictionary value type (for type coercion when adding) */
	dictType: ScalarType;
	/** API base URL. When null, component should not be rendered */
	baseUrl: string;
	/** Called after a successful mutation to reload data */
	onDictUpdated: () => void;
	/** Called when a value is added — parent auto-selects it in dropdown */
	onValueAdded?: (value: string | number | boolean) => void;
	/** Toast notifications */
	addToast: (type: "success" | "error", text: string) => void;
}

function coerceToType(
	raw: string,
	type: ScalarType,
): string | number | boolean {
	if ((type === "number" || type === "integer") && raw !== "") {
		const n = Number(raw);
		if (Number.isFinite(n)) return n;
	}
	if (type === "boolean") {
		const lc = raw.trim().toLowerCase();
		if (lc === "true") return true;
		if (lc === "false") return false;
	}
	return raw;
}

export function DictValueManager({
	dictKey,
	values,
	dictType,
	baseUrl,
	onDictUpdated,
	onValueAdded,
	addToast,
}: DictValueManagerProps) {
	const { t } = useT();
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editValue, setEditValue] = useState("");
	const [newValue, setNewValue] = useState("");
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState<{
		index: number;
		value: string | number | boolean;
	} | null>(null);

	// Reset active edit when values change externally (WebSocket safety)
	useEffect(() => {
		setEditingIndex(null);
		setEditValue("");
	}, [values]);

	const sendUpdate = async (
		newValues: Array<string | number | boolean>,
	): Promise<boolean> => {
		setSaving(true);
		try {
			await updateDictionary(baseUrl, dictKey, {
				originalKey: dictKey,
				key: dictKey,
				type: dictType,
				values: newValues,
				isDirty: true,
			});
			return true;
		} catch {
			addToast("error", t("dictInline.saveFailed"));
			return false;
		} finally {
			setSaving(false);
		}
	};

	const handleAdd = async () => {
		const trimmed = newValue.trim();
		if (!trimmed) return;

		const coerced = coerceToType(trimmed, dictType);
		if (values.some((v) => String(v) === String(coerced))) {
			addToast("error", t("dictInline.valueExists"));
			return;
		}

		const newValues = [...values, coerced];
		const ok = await sendUpdate(newValues);
		if (ok) {
			setNewValue("");
			onValueAdded?.(coerced);
			onDictUpdated();
			addToast("success", t("dictInline.saved"));
		}
	};

	const handleRename = async () => {
		if (editingIndex === null) return;
		const trimmed = editValue.trim();
		if (!trimmed) {
			addToast("error", t("dictInline.valueEmpty"));
			return;
		}

		const coerced = coerceToType(trimmed, dictType);
		// Allow saving if value didn't change
		if (String(coerced) !== String(values[editingIndex])) {
			if (values.some((v) => String(v) === String(coerced))) {
				addToast("error", t("dictInline.valueExists"));
				return;
			}
		}

		const newValues = values.map((v, i) =>
			i === editingIndex ? coerced : v,
		);
		const ok = await sendUpdate(newValues);
		if (ok) {
			setEditingIndex(null);
			setEditValue("");
			onDictUpdated();
			addToast("success", t("dictInline.saved"));
		}
	};

	const handleDelete = async () => {
		if (!confirmDelete) return;
		const newValues = values.filter((_, i) => i !== confirmDelete.index);
		const ok = await sendUpdate(newValues);
		if (ok) {
			setConfirmDelete(null);
			onDictUpdated();
			addToast("success", t("dictInline.saved"));
		} else {
			setConfirmDelete(null);
		}
	};

	const startEdit = (index: number) => {
		setEditingIndex(index);
		setEditValue(String(values[index]));
	};

	const cancelEdit = () => {
		setEditingIndex(null);
		setEditValue("");
	};

	return (
		<>
			<div className="mt-1.5 border border-edge-primary rounded-md bg-surface-secondary p-3">
				{/* Header */}
				<div className="text-[11px] text-content-tertiary mb-2 font-medium">
					{dictKey}
				</div>

				{/* Add new value */}
				<div className="flex gap-1.5 mb-2">
					<input
						type="text"
						value={newValue}
						onChange={(e) => setNewValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								handleAdd();
							}
						}}
						placeholder={t("dictInline.addPlaceholder")}
						disabled={saving}
						className="flex-1 px-2 py-1 bg-surface-input border border-edge-primary rounded text-xs text-content-primary placeholder:text-content-muted focus:outline-none focus:border-edge-secondary font-mono"
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={saving || !newValue.trim()}
						className="px-2 py-1 text-xs bg-accent-blue text-white rounded hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{t("dictInline.addValue")}
					</button>
				</div>

				{/* Values list */}
				<div className="max-h-48 overflow-y-auto space-y-0.5">
					{values.map((v, i) => (
						<div
							key={`${String(v)}-${i}`}
							className="flex items-center gap-1.5 group"
						>
							{editingIndex === i ? (
								/* Inline edit mode */
								<>
									<input
										type="text"
										value={editValue}
										onChange={(e) =>
											setEditValue(e.target.value)
										}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												handleRename();
											}
											if (e.key === "Escape") {
												cancelEdit();
											}
										}}
										disabled={saving}
										autoFocus
										className="flex-1 px-2 py-1 bg-surface-input border border-edge-secondary rounded text-xs text-content-primary focus:outline-none font-mono"
									/>
									<button
										type="button"
										onClick={handleRename}
										disabled={saving}
										title={t("dictInline.save")}
										className="p-1 text-accent-green hover:text-accent-green/80 disabled:opacity-50"
									>
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
												d="M5 13l4 4L19 7"
											/>
										</svg>
									</button>
									<button
										type="button"
										onClick={cancelEdit}
										title={t("dictInline.cancel")}
										className="p-1 text-content-tertiary hover:text-content-secondary"
									>
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
												d="M6 18L18 6M6 6l12 12"
											/>
										</svg>
									</button>
								</>
							) : (
								/* Display mode */
								<>
									<span className="flex-1 px-2 py-1 text-xs font-mono text-content-primary truncate">
										{String(v)}
									</span>
									<button
										type="button"
										onClick={() => startEdit(i)}
										title={t("dictInline.rename")}
										className="p-1 text-content-tertiary hover:text-content-secondary opacity-0 group-hover:opacity-100 transition-opacity"
									>
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
												d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
											/>
										</svg>
									</button>
									<button
										type="button"
										onClick={() =>
											setConfirmDelete({
												index: i,
												value: v,
											})
										}
										title={t("dictInline.delete")}
										className="p-1 text-content-tertiary hover:text-accent-red opacity-0 group-hover:opacity-100 transition-opacity"
									>
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
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/>
										</svg>
									</button>
								</>
							)}
						</div>
					))}
				</div>
			</div>

			{/* Delete confirmation dialog */}
			<ConfirmDialog
				open={confirmDelete !== null}
				title={t("dictInline.confirmDeleteTitle")}
				message={t("dictInline.confirmDeleteMessage", {
					value: confirmDelete ? String(confirmDelete.value) : "",
					dict: dictKey,
				})}
				confirmLabel={t("dictInline.delete")}
				cancelLabel={t("dictInline.cancel")}
				danger
				onConfirm={handleDelete}
				onCancel={() => setConfirmDelete(null)}
			/>
		</>
	);
}
